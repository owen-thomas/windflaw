import type { Projection } from './projection';
import type { Vec2 } from './types';

/**
 * Raster mask: "is this point inside GB?" as a constant-time array lookup.
 * Built once per projection (load + resize) by filling the projected
 * polygon on an offscreen canvas and reading the pixel buffer back.
 *
 * Deliberately built at the *device*-pixel resolution the renderer draws
 * at (width/height already include devicePixelRatio), not CSS pixels —
 * every consumer (particle containment, the mechanical verification check)
 * must agree on what a "pixel" is, or rounding at the coast produces false
 * escapes at high DPR.
 */
export interface RasterMask {
  width: number;
  height: number;
  data: Uint8Array; // 1 = inside GB, 0 = outside. Row-major, length width*height.
  isInside(x: number, y: number): boolean;
}

/** (2r+1)x(2r+1) dilate: a pixel becomes 1 if it or any neighbour within radius r is 1. */
/**
 * Exported alongside `erode` and `scanlineFillMask` for reuse by
 * scripts/build-gb-outline.ts's spur-pruning pass, which needs the exact
 * same rasterize/morphology primitives the runtime uses (so "narrow" means
 * the same thing in both places), not a reimplementation of them.
 */
export function dilate(data: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let dy = -r; dy <= r && !v; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (data[ny * width + nx] === 1) {
            v = 1;
            break;
          }
        }
      }
      out[y * width + x] = v;
    }
  }
  return out;
}

/** (2r+1)x(2r+1) erode: a pixel stays 1 only if it and every neighbour within radius r is 1. */
export function erode(data: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 1;
      for (let dy = -r; dy <= r && v; dy++) {
        const ny = y + dy;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          // Out-of-canvas neighbours count as outside, so land at the
          // canvas edge erodes rather than reading past the buffer —
          // harmless in practice since the projection pads the polygon
          // well inside the canvas.
          if (ny < 0 || ny >= height || nx < 0 || nx >= width || data[ny * width + nx] === 0) {
            v = 0;
            break;
          }
        }
      }
      out[y * width + x] = v;
    }
  }
  return out;
}

function morphologicalClose(data: Uint8Array, width: number, height: number): Uint8Array {
  // Radius 2: covers the ~1-1.5px seams the DP-simplified coastline
  // produces at its narrowest pinch points. Tried radius 3: it reduces
  // escapes at the Solway/Clyde pinch points further but reshapes real
  // detail near Skye enough to open a *new* thin notch there — net worse.
  // Diminishing/negative returns past this point; the residual is small,
  // documented, and left for step 2's coast steering to close properly
  // (see Flow_Experiment_Spec.md build order) rather than chased with a
  // bigger blur.
  const r = 2;
  return erode(dilate(data, width, height, r), width, height, r);
}

/**
 * Pure-JS nonzero-rule scanline polygon fill — no Canvas 2D context
 * required. Used when neither `OffscreenCanvas` nor `document` exists (a
 * plain Node process: the step 2 instrumentation harness, see
 * `scripts/flow-harness.ts`), so world-building and therefore the whole
 * particle simulation can run headless without a browser or a canvas
 * polyfill dependency.
 *
 * Produces the same nonzero-winding fill as `ctx.fill('nonzero')` for a
 * single non-self-intersecting ring (GB's coastline is exactly that), just
 * without anti-aliased partial-coverage edge pixels — irrelevant for
 * containment logic and aggregate statistics, which is all the headless
 * path is for.
 */
export function scanlineFillMask(points: Vec2[], width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height);
  const n = points.length;

  for (let y = 0; y < height; y++) {
    const yc = y + 0.5; // sample at pixel centres, matching isInside's pixel model
    const crossings: { x: number; dir: number }[] = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % n];
      if (y1 === y2) continue; // horizontal edges never cross a scanline
      const ymin = Math.min(y1, y2);
      const ymax = Math.max(y1, y2);
      // Half-open so a scanline through a shared vertex counts it once,
      // not twice (the standard fix for the vertex double-count artefact).
      if (yc < ymin || yc >= ymax) continue;
      const t = (yc - y1) / (y2 - y1);
      crossings.push({ x: x1 + t * (x2 - x1), dir: y2 > y1 ? 1 : -1 });
    }
    if (crossings.length === 0) continue;
    crossings.sort((a, b) => a.x - b.x);

    let winding = 0;
    const rowBase = y * width;
    for (let i = 0; i < crossings.length; i++) {
      winding += crossings[i].dir;
      if (winding !== 0 && i + 1 < crossings.length) {
        const ixStart = Math.max(0, Math.ceil(crossings[i].x - 0.5));
        const ixEnd = Math.min(width - 1, Math.floor(crossings[i + 1].x - 0.5));
        for (let ix = ixStart; ix <= ixEnd; ix++) data[rowBase + ix] = 1;
      }
    }
  }
  return data;
}

export function buildRasterMask(
  ring: [number, number][],
  projection: Projection,
  width: number,
  height: number,
): RasterMask {
  const points: Vec2[] = ring.map(projection.project);

  let data: Uint8Array;
  if (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined') {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('Could not get 2D context for mask rasterisation');

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.closePath();
    ctx.fill('nonzero');

    const imageData = ctx.getImageData(0, 0, width, height);
    data = new Uint8Array(width * height);
    // Alpha channel is the fill coverage; >0 means inside. Using alpha rather
    // than a colour channel makes this robust to anti-aliased edge pixels
    // being partially covered — treat any coverage as inside, matching how
    // the shape reads visually.
    for (let i = 0; i < data.length; i++) {
      data[i] = imageData.data[i * 4 + 3] > 0 ? 1 : 0;
    }
  } else {
    // Headless Node: no canvas API available at all.
    data = scanlineFillMask(points, width, height);
  }

  // Morphological closing (dilate then erode), 1px radius. The DP-simplified
  // coastline has spots (e.g. narrow inlets near the Solway) where two edges
  // sit under a pixel apart; the fill rasteriser can leave a 1px-wide seam
  // of zero coverage running through what is otherwise solid land there.
  // Left alone, a particle's rendered segment can clip that seam even
  // though both its endpoints are safely inside — closing removes gaps
  // that thin without visibly altering the coastline at this scale.
  data = morphologicalClose(data, width, height);

  return {
    width,
    height,
    data,
    isInside(x: number, y: number): boolean {
      const xi = x | 0;
      const yi = y | 0;
      if (xi < 0 || yi < 0 || xi >= width || yi >= height) return false;
      return data[yi * width + xi] === 1;
    },
  };
}
