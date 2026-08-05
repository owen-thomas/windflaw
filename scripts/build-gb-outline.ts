/**
 * Build the GB mainland outline used by the flow visual.
 *
 * Fetches Natural Earth's 1:10m admin-0 countries dataset, pulls the United
 * Kingdom feature (a MultiPolygon — sovereign UK, so Northern Ireland and
 * every island are separate rings from the same feature), and keeps only
 * the largest ring by area. That ring is Great Britain: the checked area
 * split (~30 vs ~2 deg² for the next-largest, Northern Ireland) makes this
 * robust rather than a coincidence of this dataset's ring ordering.
 *
 * The ring is then simplified with Douglas-Peucker down to ~1200 points.
 * Simplification runs in a *projected* reference space (longitude scaled
 * by cos(mean latitude)) rather than raw degrees — at 54°N a degree of
 * longitude is only ~0.58 of a degree of latitude, so simplifying in raw
 * lat/lon would keep roughly 2x more detail north-south than east-west.
 * The projection is only used to pick which points survive; the output
 * keeps the original (unprojected) lat/lon of each surviving point, since
 * the runtime projection (src/flow/projection.ts) is fit to the viewport
 * at load and can't be baked in here.
 *
 * Not part of the build — this is a one-off/rerunnable data prep step.
 * Run with: npx tsx scripts/build-gb-outline.ts
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dilate, erode, scanlineFillMask } from '../src/flow/mask';

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
const OUTPUT_PATH = fileURLToPath(
  new URL('../src/flow/data/gb-mainland.json', import.meta.url),
);
const TARGET_POINTS = 1200;

// --- Spur pruning -----------------------------------------------------------
// See Flow experiment step 2.txt's follow-up finding: at typical render
// scale, a real but sub-pixel-wide peninsula (the Rhins of Galloway) sat
// almost directly south of the Scottish source cluster and coincided with
// ~35% of all simulated particle deaths there. This pass removes it
// correctly (verified: the peninsula is gone from the traced/re-simplified
// ring, confirmed visually) — but a harness before/after showed it made
// throughput *worse*, not better (>=50%-south share 8.4% -> 2.1%, interior
// coverage 41% -> 31%, both well outside this harness's <1%-point run-to-run
// noise). The death concentration didn't move to a new location either — it
// stayed at essentially the same latitude (south~43%), just a different
// exact point. That means the trap was never really about *this peninsula*
// being prunable spur geometry — south~43% is roughly the Scotland/England
// border, where GB has a genuine, legitimate narrow waist (Solway Firth to
// the west, the Northumberland coast to the east), and pruning happened to
// also smooth away *other* real detail nearby that the field's dynamics
// were, in some way not fully understood, relying on. The actual fix likely
// needs path-aware steering (lookahead, not a purely local vector field) or
// further field retuning specific to that latitude band, not coastline
// data changes — see the flow-harness comparison this const's docs point
// to. Left here, correctly implemented and tested, as a real capability
// for the *next* genuinely-prunable spur found (this one just wasn't it) —
// but defaulted off so a routine rerun of this script (e.g. against a newer
// Natural Earth release) doesn't silently regenerate a measurably worse
// coastline than the one currently committed.
const ENABLE_SPUR_PRUNING = false;
//
// The fix belongs at the data layer *when it applies*: this coastline is
// real geography, but a feature only a few miles wide renders as a needle
// a few px wide on a mid-range-laptop canvas, and a local vector field has
// no way to "see" past a dead end like that. Pruning here means every
// consumer of this polygon (mask, distance field, debug overlay) benefits
// without any runtime special-casing — when there's a genuine spur to prune.
//
// A first attempt detected spurs as ring self-proximity (two points far
// apart in ring-index but close in space, implying a narrow isthmus neck)
// and cut the ring there. It missed the Rhins entirely: that peninsula is
// a smoothly *tapering wedge*, not an isthmus-and-bulb shape — it never
// folds back close to itself, so there was no self-proximity to detect,
// at any index-gap threshold tried. A tapering wedge's problem is genuinely
// about *local width*, which is exactly what a morphological opening
// (erode then dilate) measures directly: it removes any protrusion
// narrower than 2x its radius while leaving the rest of the shape alone,
// regardless of whether that protrusion has a narrow neck or just tapers
// smoothly to a point. That requires a raster round-trip (rasterize ->
// open -> re-trace the boundary -> re-simplify), reusing the exact
// rasterize/morphology primitives mask.ts already exports.
//
// Proxy viewport for measuring "how many px wide is this feature" — must
// match the scale used elsewhere in this session's tuning (the flow
// harness's own "mid-range laptop" convention) so the threshold below means
// the same thing it did when the trap was diagnosed.
const PROXY_VIEWPORT_WIDTH = 2400;
const PROXY_VIEWPORT_HEIGHT = 1600;
// Opening radius, device px in the proxy viewport: removes any protrusion
// narrower than ~2x this. Comfortably above the runtime mask's own
// morphological closing radius (2px, mask.ts) — this is a much coarser,
// deliberately different pass (removing land, not closing seams in it).
const OPENING_RADIUS_PX = 10;

type LonLat = [number, number];

interface NEFeature {
  properties: Record<string, unknown>;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: LonLat[][][] | LonLat[][];
  };
}

interface NECollection {
  features: NEFeature[];
}

/** Shoelace formula, absolute value — good enough to compare ring sizes. */
function ringArea(ring: LonLat[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Perpendicular distance from point p to the line through a-b. */
function perpDistance(p: LonLat, a: LonLat, b: LonLat): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Douglas-Peucker over a point list (open, not ring-aware), iterative via
 * an explicit work stack rather than language recursion. The spur-pruning
 * raster boundary trace can hand this tens of thousands of points (one per
 * boundary pixel) — recursing one call frame per split blew Node's default
 * call stack on that input; an explicit stack has no such limit.
 */
function douglasPeucker(points: LonLat[], tolerance: number): LonLat[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [startIdx, endIdx] = stack.pop()!;
    if (endIdx - startIdx < 2) continue; // no interior points between them

    const first = points[startIdx];
    const last = points[endIdx];
    let maxDist = 0;
    let maxIndex = -1;
    for (let i = startIdx + 1; i < endIdx; i++) {
      const dist = perpDistance(points[i], first, last);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }
    if (maxDist > tolerance && maxIndex !== -1) {
      keep[maxIndex] = 1;
      stack.push([startIdx, maxIndex]);
      stack.push([maxIndex, endIdx]);
    }
  }

  const result: LonLat[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/** Binary-search a DP tolerance (in projected-space units) landing near targetCount points. */
function simplifyToCount(projected: LonLat[], targetCount: number): number[] {
  let lo = 0;
  let hi = 5; // degrees, generous upper bound for this ring's extent
  let bestIndices: number[] | null = null;

  // Douglas-Peucker doesn't hand back which *indices* survived, so re-run
  // it tagging each point with its original index in the third slot, cast
  // through as if it were a LonLat — cheap and avoids a second data shape.
  const tagged = projected.map((p, i) => [p[0], p[1], i] as unknown as LonLat);

  for (let iter = 0; iter < 30; iter++) {
    const tolerance = (lo + hi) / 2;
    const simplified = douglasPeucker(tagged, tolerance);
    const count = simplified.length;
    if (Math.abs(count - targetCount) <= 5 || hi - lo < 1e-7) {
      bestIndices = simplified.map((p) => (p as unknown as [number, number, number])[2]);
      break;
    }
    if (count > targetCount) {
      lo = tolerance;
    } else {
      hi = tolerance;
    }
    bestIndices = simplified.map((p) => (p as unknown as [number, number, number])[2]);
  }
  return bestIndices ?? projected.map((_, i) => i);
}

/**
 * Self-contained forward/inverse equirectangular projection, matching
 * src/flow/projection.ts's math exactly (duplicated rather than imported —
 * this script is deliberately self-contained/one-off, and the runtime
 * Projection type has no inverse; adding one there for a build-time-only
 * need isn't worth widening that API).
 */
function buildProxyProjection(ring: [number, number][], width: number, height: number) {
  const padding = 0.06;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lat, lon] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  const spanX = (maxLon - minLon) * lonScale;
  const spanY = maxLat - minLat;
  const padPx = padding * Math.min(width, height);
  const availW = width - 2 * padPx;
  const availH = height - 2 * padPx;
  const scale = Math.min(availW / spanX, availH / spanY);
  const drawW = spanX * scale;
  const drawH = spanY * scale;
  const offsetX = (width - drawW) / 2;
  const offsetY = (height - drawH) / 2;

  return {
    project([lat, lon]: [number, number]): [number, number] {
      const x = (lon * lonScale - minLon * lonScale) * scale + offsetX;
      const y = (maxLat - lat) * scale + offsetY;
      return [x, y];
    },
    unproject(x: number, y: number): [number, number] {
      const lon = ((x - offsetX) / scale + minLon * lonScale) / lonScale;
      const lat = maxLat - (y - offsetY) / scale;
      return [lat, lon];
    },
  };
}

/** 4-connected flood-fill labelling. Returns each pixel's component label (0 = background) and each label's pixel count. */
function labelConnectedComponents(
  data: Uint8Array,
  width: number,
  height: number,
): { label: Int32Array; sizes: Map<number, number> } {
  const label = new Int32Array(width * height);
  const sizes = new Map<number, number>();
  const queue = new Int32Array(width * height);
  let nextLabel = 1;

  for (let start = 0; start < data.length; start++) {
    if (data[start] !== 1 || label[start] !== 0) continue;
    let qHead = 0;
    let qTail = 0;
    queue[qTail++] = start;
    label[start] = nextLabel;
    let size = 0;
    while (qHead < qTail) {
      const idx = queue[qHead++];
      size++;
      const x = idx % width;
      const y = (idx / width) | 0;
      const neighbours: [number, number][] = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (data[nIdx] === 1 && label[nIdx] === 0) {
          label[nIdx] = nextLabel;
          queue[qTail++] = nIdx;
        }
      }
    }
    sizes.set(nextLabel, size);
    nextLabel++;
  }
  return { label, sizes };
}

// Clockwise from North, for Moore-neighbour boundary tracing.
const TRACE_DIRS: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/**
 * Moore-neighbour boundary tracing: walks the outer contour of a single
 * connected foreground region, returning pixel-centre points in order.
 * Starts at the topmost, then leftmost foreground pixel (guaranteed to be
 * on the boundary, since everything above and to its left is background),
 * then repeatedly looks clockwise from just past its entry direction for
 * the next foreground neighbour.
 *
 * Stops on simply revisiting the start pixel (not on matching the start's
 * *entry direction*, the textbook Jacob's criterion): an earlier version
 * compared against an arbitrarily-assumed initial entry direction, but a
 * real trace legitimately returns to the start pixel via whatever
 * direction the boundary's own geometry produces there — which generally
 * isn't the artificial one assumed before tracing began — so that
 * comparison could never succeed and the trace ran to its safety cap
 * every time (caught by testing on a plain filled square first). A shape
 * that has already been through a morphological opening shouldn't have
 * self-touching pinch points for the boundary to legitimately cross twice
 * before closing, so the simpler criterion is safe here.
 */
function traceBoundary(data: Uint8Array, width: number, height: number): [number, number][] {
  const isInside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] === 1;

  let startX = -1;
  let startY = -1;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isInside(x, y)) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  if (startX === -1) throw new Error('traceBoundary: no foreground pixels found');

  const boundary: [number, number][] = [[startX, startY]];
  let cx = startX;
  let cy = startY;
  // Scanned top-to-bottom, left-to-right to find start, so West (and
  // North) of it must be background — enter the clockwise search just
  // past West.
  let backtrackDir = 6;
  const maxSteps = width * height; // generous safety cap, never expected to bind

  for (let step = 0; step < maxSteps; step++) {
    let foundDir = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (backtrackDir + k) % 8;
      const [dx, dy] = TRACE_DIRS[d];
      if (isInside(cx + dx, cy + dy)) {
        foundDir = d;
        break;
      }
    }
    if (foundDir === -1) break; // isolated single pixel — nothing to trace around

    backtrackDir = (foundDir + 4) % 8;
    cx += TRACE_DIRS[foundDir][0];
    cy += TRACE_DIRS[foundDir][1];

    if (cx === startX && cy === startY) break;
    boundary.push([cx, cy]);
  }

  return boundary;
}

/**
 * Remove thin spurs/peninsulas — see the module docs above. Rasterizes the
 * (already DP-simplified) ring at proxy-viewport resolution, applies a
 * morphological opening (erode then dilate) at OPENING_RADIUS_PX, keeps
 * only the largest connected component (an opening can disconnect a spur
 * from the mainland entirely, leaving it a separate — and separately
 * discarded — island), traces its boundary back into a polygon, and
 * simplifies that back down to TARGET_POINTS via the same Douglas-Peucker
 * used on the original Natural Earth data.
 */
function pruneThinSpurs(ring: [number, number][]): {
  pruned: [number, number][];
  rasterBoundaryPoints: number;
} {
  const width = PROXY_VIEWPORT_WIDTH;
  const height = PROXY_VIEWPORT_HEIGHT;
  const projection = buildProxyProjection(ring, width, height);
  const projectedPoints = ring.map((p) => projection.project(p));

  console.log(`  [prune] rasterizing ${width}x${height}...`);
  let mask = scanlineFillMask(projectedPoints, width, height);
  console.log('  [prune] eroding...');
  mask = erode(mask, width, height, OPENING_RADIUS_PX);
  console.log('  [prune] dilating...');
  mask = dilate(mask, width, height, OPENING_RADIUS_PX);

  console.log('  [prune] labelling connected components...');
  const { label, sizes } = labelConnectedComponents(mask, width, height);
  let largestLabel = 0;
  let largestSize = 0;
  for (const [lbl, size] of sizes) {
    if (size > largestSize) {
      largestSize = size;
      largestLabel = lbl;
    }
  }
  console.log(`  [prune] ${sizes.size} component(s), largest has ${largestSize} px.`);
  const largestOnly = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    largestOnly[i] = label[i] === largestLabel ? 1 : 0;
  }

  console.log('  [prune] tracing boundary...');
  const boundary = traceBoundary(largestOnly, width, height);
  console.log(`  [prune] traced ${boundary.length} boundary points.`);
  const latLonRing: [number, number][] = boundary.map(([x, y]) => projection.unproject(x, y));
  latLonRing.push(latLonRing[0]); // close

  // Re-simplify: tracing emits one point per boundary pixel, far more than
  // TARGET_POINTS. Same lonScale-corrected DP pass as the original
  // simplification, operating on [lon, lat] to match douglasPeucker's
  // expected point shape.
  const asLonLat: LonLat[] = latLonRing.map(([lat, lon]) => [lon, lat]);
  // Plain loop, not Math.min(...lats) — spreading tens of thousands of
  // boundary points as call arguments overflows V8's argument-list limit,
  // a different failure mode from (but as fatal as) the recursion depth
  // limit douglasPeucker hit above.
  let minLatSeen = Infinity;
  let maxLatSeen = -Infinity;
  for (const [lat] of latLonRing) {
    if (lat < minLatSeen) minLatSeen = lat;
    if (lat > maxLatSeen) maxLatSeen = lat;
  }
  const meanLat = (minLatSeen + maxLatSeen) / 2;
  const lonScale = Math.cos((meanLat * Math.PI) / 180);
  const projectedForSimplify: LonLat[] = asLonLat.map(([lon, lat]) => [lon * lonScale, lat]);
  console.log('  [prune] re-simplifying...');
  const keepIndices = simplifyToCount(projectedForSimplify, TARGET_POINTS);
  const pruned = keepIndices.map((i) => latLonRing[i]);

  return { pruned, rasterBoundaryPoints: boundary.length };
}

async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as NECollection;

  const uk = data.features.find(
    (f) => f.properties.ADMIN === 'United Kingdom' || f.properties.ISO_A3 === 'GBR',
  );
  if (!uk) throw new Error('United Kingdom feature not found in Natural Earth data');
  if (uk.geometry.type !== 'MultiPolygon') {
    throw new Error(`Expected MultiPolygon, got ${uk.geometry.type}`);
  }

  const polygons = uk.geometry.coordinates as LonLat[][][];
  const outerRings = polygons.map((poly) => poly[0]);
  const areas = outerRings.map(ringArea);
  const bestIdx = areas.indexOf(Math.max(...areas));
  const sortedAreas = [...areas].sort((a, b) => b - a);
  console.log(
    `Picked ring ${bestIdx} (area ${sortedAreas[0].toFixed(2)}) over next-largest ` +
      `(area ${sortedAreas[1].toFixed(2)}) — ${(sortedAreas[0] / sortedAreas[1]).toFixed(1)}x margin.`,
  );

  const raw = outerRings[bestIdx]; // [lon, lat][], closed ring (first === last)
  const lats = raw.map((p) => p[1]);
  const meanLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lonScale = Math.cos((meanLat * Math.PI) / 180);

  // Project (lon scaled, lat untouched) purely to pick simplification
  // tolerance isotropically; output stays in real lat/lon.
  const projected: LonLat[] = raw.map(([lon, lat]) => [lon * lonScale, lat]);
  const keepIndices = simplifyToCount(projected, TARGET_POINTS);
  const simplified = keepIndices.map((i) => raw[i]);

  // Store as [lat, lon] to match the Source type's [lat, lon] convention
  // used throughout this page (spec's Source.latLon order).
  const outLatLon = simplified.map(([lon, lat]) => [lat, lon] as [number, number]);

  console.log(`Simplified ${raw.length} -> ${outLatLon.length} points.`);

  // See ENABLE_SPUR_PRUNING's docs: measurably not a net improvement for
  // the one case tested, so off by default — a routine rerun of this
  // script should reproduce the currently-committed coastline, not
  // silently regress it.
  let finalRing = outLatLon;
  if (ENABLE_SPUR_PRUNING) {
    const { pruned, rasterBoundaryPoints } = pruneThinSpurs(outLatLon);
    console.log(
      `Opened at ${OPENING_RADIUS_PX}px radius, traced boundary (${rasterBoundaryPoints} raster ` +
        `points), re-simplified: ${outLatLon.length} -> ${pruned.length} points.`,
    );
    finalRing = pruned;
  } else {
    console.log('Spur pruning disabled (ENABLE_SPUR_PRUNING = false) — writing unpruned ring.');
  }

  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        name: 'GB mainland',
        source: 'Natural Earth 1:10m admin-0 countries, United Kingdom feature, largest ring',
        pointCount: finalRing.length,
        // Closed ring: first === last.
        ring: finalRing,
      },
      null,
      0,
    ),
  );
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
