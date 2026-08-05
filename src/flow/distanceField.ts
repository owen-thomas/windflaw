import { INF, squaredDistanceTransform } from './edt';
import type { RasterMask } from './mask';

/**
 * Signed distance field + gradient on a coarse grid: distance to the
 * nearest coast (positive inside GB, negative outside) and the direction
 * of that gradient. Used to steer particles along the boundary as they
 * approach it. Computed once per raster mask (load + resize) via an exact
 * 2D Euclidean distance transform, not brute-force nearest-segment —
 * linear-time instead of O(points x grid cells).
 */
export interface DistanceField {
  gridWidth: number;
  gridHeight: number;
  cellSize: number; // device pixels per grid cell
  /** Signed distance in device pixels. Positive inside, negative outside. */
  distance: Float32Array;
  /** Unit gradient of signed distance, x component. Points from coast toward interior. */
  gradX: Float32Array;
  /** Unit gradient of signed distance, y component. */
  gradY: Float32Array;
  /** Sample signed distance + gradient at a device-pixel canvas point (nearest-cell). */
  sample(x: number, y: number): { dist: number; gx: number; gy: number };
}

export const DEFAULT_CELL_SIZE = 6; // device px; spec suggests 4-8px grid spacing

/**
 * Downsample a fine raster mask to a coarse grid (nearest-pixel sampling).
 * Shared by `buildDistanceField` below and `buildGeodesicField`
 * (geodesicField.ts), which both need the same "is this coarse cell
 * inside GB" grid at the same resolution — factored out rather than
 * duplicated so the two fields can never quietly drift onto different
 * grids of the same mask.
 */
export function downsampleMaskToCoarseGrid(
  mask: RasterMask,
  cellSize: number,
): { gridWidth: number; gridHeight: number; coarseInside: Uint8Array } {
  const gridWidth = Math.ceil(mask.width / cellSize);
  const gridHeight = Math.ceil(mask.height / cellSize);
  const coarseInside = new Uint8Array(gridWidth * gridHeight);
  for (let gy = 0; gy < gridHeight; gy++) {
    const py = Math.min(mask.height - 1, gy * cellSize);
    for (let gx = 0; gx < gridWidth; gx++) {
      const px = Math.min(mask.width - 1, gx * cellSize);
      coarseInside[gy * gridWidth + gx] = mask.data[py * mask.width + px];
    }
  }
  return { gridWidth, gridHeight, coarseInside };
}

export function buildDistanceField(
  mask: RasterMask,
  cellSize: number = DEFAULT_CELL_SIZE,
): DistanceField {
  const { gridWidth, gridHeight, coarseInside } = downsampleMaskToCoarseGrid(mask, cellSize);
  const n = gridWidth * gridHeight;

  // Boundary cells (source cells for the EDT): coarse cells whose 4-neighbourhood
  // contains both inside and outside cells.
  const sources = new Float64Array(n).fill(INF);
  const idx = (x: number, y: number) => y * gridWidth + x;
  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const here = coarseInside[idx(gx, gy)];
      let isBoundary = false;
      const neighbours: [number, number][] = [
        [gx - 1, gy],
        [gx + 1, gy],
        [gx, gy - 1],
        [gx, gy + 1],
      ];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) {
          // Grid edge: treat as a boundary only if the polygon reaches the
          // viewport edge, which it shouldn't given the projection padding.
          // Skip rather than manufacture a false coastline.
          continue;
        }
        if (coarseInside[idx(nx, ny)] !== here) {
          isBoundary = true;
          break;
        }
      }
      if (isBoundary) sources[idx(gx, gy)] = 0;
    }
  }

  const squared = squaredDistanceTransform(sources, gridWidth, gridHeight);

  const distance = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const unsigned = Math.sqrt(squared[i]) * cellSize;
    distance[i] = coarseInside[i] ? unsigned : -unsigned;
  }

  // Gradient by central differences over grid indices, normalised. Points
  // from low signed-distance (coast) toward high (interior) — i.e. inward.
  const gradX = new Float32Array(n);
  const gradY = new Float32Array(n);
  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const i = idx(gx, gy);
      const xL = distance[idx(Math.max(0, gx - 1), gy)];
      const xR = distance[idx(Math.min(gridWidth - 1, gx + 1), gy)];
      const yU = distance[idx(gx, Math.max(0, gy - 1))];
      const yD = distance[idx(gx, Math.min(gridHeight - 1, gy + 1))];
      let dx = xR - xL;
      let dy = yD - yU;
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) {
        dx /= len;
        dy /= len;
      } else {
        dx = 0;
        dy = 0;
      }
      gradX[i] = dx;
      gradY[i] = dy;
    }
  }

  function sample(x: number, y: number) {
    const gx = Math.min(gridWidth - 1, Math.max(0, Math.round(x / cellSize)));
    const gy = Math.min(gridHeight - 1, Math.max(0, Math.round(y / cellSize)));
    const i = idx(gx, gy);
    return { dist: distance[i], gx: gradX[i], gy: gradY[i] };
  }

  return { gridWidth, gridHeight, cellSize, distance, gradX, gradY, sample };
}
