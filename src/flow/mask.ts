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
function dilate(data: Uint8Array, width: number, height: number, r: number): Uint8Array {
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
function erode(data: Uint8Array, width: number, height: number, r: number): Uint8Array {
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

export function buildRasterMask(
  ring: [number, number][],
  projection: Projection,
  width: number,
  height: number,
): RasterMask {
  const points: Vec2[] = ring.map(projection.project);

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
  let data: Uint8Array = new Uint8Array(width * height);
  // Alpha channel is the fill coverage; >0 means inside. Using alpha rather
  // than a colour channel makes this robust to anti-aliased edge pixels
  // being partially covered — treat any coverage as inside, matching how
  // the shape reads visually.
  for (let i = 0; i < data.length; i++) {
    data[i] = imageData.data[i * 4 + 3] > 0 ? 1 : 0;
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
