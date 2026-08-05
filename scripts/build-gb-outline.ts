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

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
const OUTPUT_PATH = fileURLToPath(
  new URL('../src/flow/data/gb-mainland.json', import.meta.url),
);
const TARGET_POINTS = 1200;

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

/** Classic recursive Douglas-Peucker over a point list (open, not ring-aware). */
function douglasPeucker(points: LonLat[], tolerance: number): LonLat[] {
  if (points.length < 3) return points;
  let maxDist = 0;
  let maxIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
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
  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        name: 'GB mainland',
        source: 'Natural Earth 1:10m admin-0 countries, United Kingdom feature, largest ring',
        pointCount: outLatLon.length,
        // Closed ring: first === last.
        ring: outLatLon,
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
