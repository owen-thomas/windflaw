import { downsampleMaskToCoarseGrid } from './distanceField';
import type { RasterMask } from './mask';

/**
 * Coarse occupancy grid — 2g of `Flow experiment fan-out.txt`, "how
 * they're placed relative to each other" made mechanical. Unlike
 * distanceField.ts/geodesicField.ts/divergentField.ts (static per-world
 * geometry, rebuilt only on load/resize), this is *dynamic* simulation
 * state: particles deposit into it every frame and it decays
 * exponentially, so it tracks where flow is crowded *right now*, not
 * where the coastline is. It's owned by ParticleSystem (particles.ts),
 * not World — World is purely geometry.
 *
 * Cell size is deliberately coarser than distanceField's 6px: a "how
 * crowded is it here" signal needs enough particles per cell to mean
 * anything, and a handful of thousand particles spread across GB would
 * mostly read as noise at 6px resolution.
 */
export interface DensityField {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  /** Decayed deposit total per cell, in deposit-rate x seconds units (arbitrary but consistent). */
  occupancy: Float32Array;
  /** Unit gradient pointing toward *decreasing* occupancy — "downhill", away from the crowd. Zero outside the interior. */
  gradX: Float32Array;
  gradY: Float32Array;
  isInteriorCell: Uint8Array;
  interiorCellCount: number;
  /** Mean occupancy over interior cells, recomputed each `decayAndUpdateGradient` call. The reference the steering term and the recycle check both compare local density against, so both scale automatically with particle count/deposit rate rather than needing an absolute constant re-tuned every time those change. */
  meanInteriorDensity: number;
  /** Add `amount` to the cell containing (x, y). Called once per particle per frame, after that particle's own move. */
  deposit(x: number, y: number, amount: number): void;
  /**
   * Decay every cell by `decayFactor` (a per-frame multiplier, i.e.
   * already `exp(-rate * dt)`), then recompute `meanInteriorDensity` and
   * the gradient from the result. Called once per frame, not per
   * particle — sampling the field particles already do (below) is then
   * just one more array lookup, matching the spec's "one field lookup
   * per particle" performance target even though the source field is now
   * itself updated every frame.
   */
  decayAndUpdateGradient(decayFactor: number): void;
  /** Sample at a device-pixel canvas point (nearest-cell, floor toward the cell it's inside). */
  sample(x: number, y: number): { density: number; gx: number; gy: number };
}

/**
 * Device px per cell. Coarser than DEFAULT_CELL_SIZE (distanceField.ts's
 * 6px) — see module docs. 24px is roughly the spacing you'd want between
 * individual comet trails for them to read as "placed" rather than
 * "piled", which is the effect this field exists to create.
 */
export const DEFAULT_DENSITY_CELL_SIZE = 24;

export function buildDensityField(
  mask: RasterMask,
  cellSize: number = DEFAULT_DENSITY_CELL_SIZE,
): DensityField {
  const { gridWidth, gridHeight, coarseInside } = downsampleMaskToCoarseGrid(mask, cellSize);
  const n = gridWidth * gridHeight;
  const idx = (x: number, y: number) => y * gridWidth + x;

  let interiorCellCount = 0;
  for (let i = 0; i < n; i++) if (coarseInside[i]) interiorCellCount++;

  const cellOf = (x: number, y: number): number => {
    const gx = Math.min(gridWidth - 1, Math.max(0, Math.floor(x / cellSize)));
    const gy = Math.min(gridHeight - 1, Math.max(0, Math.floor(y / cellSize)));
    return idx(gx, gy);
  };

  // Self-referencing object literal: methods close over `field` (assigned
  // before any of them can be called) so `meanInteriorDensity` and the
  // typed arrays stay live, mutable state rather than a value frozen at
  // construction time.
  const field: DensityField = {
    gridWidth,
    gridHeight,
    cellSize,
    occupancy: new Float32Array(n),
    gradX: new Float32Array(n),
    gradY: new Float32Array(n),
    isInteriorCell: coarseInside,
    interiorCellCount,
    meanInteriorDensity: 0,

    deposit(x, y, amount) {
      field.occupancy[cellOf(x, y)] += amount;
    },

    decayAndUpdateGradient(decayFactor) {
      const { occupancy, gradX, gradY, isInteriorCell } = field;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        occupancy[i] *= decayFactor;
        if (isInteriorCell[i]) sum += occupancy[i];
      }
      field.meanInteriorDensity = field.interiorCellCount > 0 ? sum / field.interiorCellCount : 0;

      // Gradient by central differences, pointing toward *decreasing*
      // occupancy (negate the natural increasing-value central
      // difference) — the same "point toward what we actually want to
      // steer toward" convention geodesicField.ts uses for its goal.
      // Non-interior neighbours (off-island) are permanently zero
      // occupancy, not "actually calm" — treated as "no information" by
      // substituting the centre cell's own value, same as
      // divergentField.ts/geodesicField.ts do for their Infinity
      // neighbours. Without this, a coastal interior cell's downhill
      // direction pointed off-island along the entire coastline (every
      // exterior neighbour reads as emptier than any interior one), which
      // shoved density-driven spacing outward into the rescue/conform
      // bands instead of letting it operate along the coast.
      for (let gy = 0; gy < gridHeight; gy++) {
        for (let gx = 0; gx < gridWidth; gx++) {
          const i = idx(gx, gy);
          if (!isInteriorCell[i]) {
            gradX[i] = 0;
            gradY[i] = 0;
            continue;
          }
          const center = occupancy[i];
          const substitute = (ni: number) => (isInteriorCell[ni] ? occupancy[ni] : center);
          const l = substitute(idx(Math.max(0, gx - 1), gy));
          const r = substitute(idx(Math.min(gridWidth - 1, gx + 1), gy));
          const u = substitute(idx(gx, Math.max(0, gy - 1)));
          const d = substitute(idx(gx, Math.min(gridHeight - 1, gy + 1)));
          let dx = -(r - l);
          let dy = -(d - u);
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
    },

    sample(x, y) {
      const i = cellOf(x, y);
      return { density: field.occupancy[i], gx: field.gradX[i], gy: field.gradY[i] };
    },
  };

  return field;
}
