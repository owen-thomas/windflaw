import { DEFAULT_CELL_SIZE, downsampleMaskToCoarseGrid } from './distanceField';
import type { RasterMask } from './mask';

/**
 * Path-aware "which way is actually south" field — the fix tried after
 * both field-parameter retuning and coastline-data pruning failed to move
 * a death hotspot at the Scotland/England border (Flow experiment step
 * 2.txt's follow-up findings). That border sits at a genuine narrow waist
 * in GB (Solway Firth to the west, Northumberland coast to the east); a
 * particle steered by pure "south is (0,1)" drift plus *local* coast
 * steering has no way to know it's approaching a re-entrant bay rather
 * than open coastline, and can get stuck cycling near it indefinitely —
 * confirmed independent of drift/steer/center/noise weight and of coastal
 * geometry detail (both were tried and ruled out empirically).
 *
 * This is the standard "integration field" / "flow-field pathfinding"
 * technique (as used for large-crowd pathfinding in games): a multi-source
 * BFS across the interior mask from a southern goal band gives every
 * interior cell its geodesic (path-following, not straight-line) distance
 * to "the south", and the gradient of that field — computed once at world
 * build time, just like the coastal distance field — points every
 * particle the way a real path south actually goes, automatically
 * bending around bays and necks instead of assuming a straight line
 * through them. No per-particle lookahead or runtime pathfinding is
 * needed; the "lookahead" is baked into the precomputed field, so the
 * per-frame cost is the same single grid sample the rest of the field
 * already pays.
 */
export interface GeodesicField {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  /** Geodesic distance to the southern goal band, in device px. Infinity for cells outside the mask or unreachable from it (see docs below). */
  distance: Float32Array;
  /** Unit gradient pointing toward *decreasing* distance — the way south, following the mask's actual shape. Zero where distance is Infinity. */
  gradX: Float32Array;
  gradY: Float32Array;
  /** Sample at a device-pixel canvas point (nearest-cell). */
  sample(x: number, y: number): { dist: number; gx: number; gy: number };
}

/** How many coarse rows above the mask's southernmost interior row count as "reached the south". A single row is a thin sliver that could itself sit in a bay; a small band is a more representative goal region. */
const GOAL_BAND_ROWS = 3;

export function buildGeodesicField(
  mask: RasterMask,
  cellSize: number = DEFAULT_CELL_SIZE,
): GeodesicField {
  const { gridWidth, gridHeight, coarseInside } = downsampleMaskToCoarseGrid(mask, cellSize);
  const n = gridWidth * gridHeight;
  const idx = (x: number, y: number) => y * gridWidth + x;

  const distance = new Float32Array(n).fill(Infinity);
  const gradX = new Float32Array(n);
  const gradY = new Float32Array(n);

  // Find the southernmost coarse row that has any interior cell at all —
  // the projection's padding means the last few grid rows are often
  // entirely outside the polygon.
  let maxInsideGy = -1;
  for (let gy = gridHeight - 1; gy >= 0; gy--) {
    let any = false;
    for (let gx = 0; gx < gridWidth; gx++) {
      if (coarseInside[idx(gx, gy)]) {
        any = true;
        break;
      }
    }
    if (any) {
      maxInsideGy = gy;
      break;
    }
  }

  function sample(x: number, y: number) {
    const gx = Math.min(gridWidth - 1, Math.max(0, Math.round(x / cellSize)));
    const gy = Math.min(gridHeight - 1, Math.max(0, Math.round(y / cellSize)));
    const i = idx(gx, gy);
    return { dist: distance[i], gx: gradX[i], gy: gradY[i] };
  }

  if (maxInsideGy === -1) {
    // Degenerate — no interior cells at all. Shouldn't happen for a real
    // mask; return an all-"no information" field so sampleField's fallback
    // (plain southward drift) takes over rather than this throwing.
    return { gridWidth, gridHeight, cellSize, distance, gradX, gradY, sample };
  }

  // Multi-source BFS from the goal band, 8-connected. Unweighted (every
  // step costs 1 regardless of diagonal vs orthogonal) rather than true
  // Euclidean — only the resulting *gradient direction* is used for
  // steering, not the distance value itself, and an unweighted BFS's
  // gradient is the standard, good-enough approximation for this
  // (the same simplification flow-field-pathfinding "integration fields"
  // make in games).
  const queue = new Int32Array(n);
  let qHead = 0;
  let qTail = 0;
  const goalTop = Math.max(0, maxInsideGy - GOAL_BAND_ROWS + 1);
  for (let gy = goalTop; gy <= maxInsideGy; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const i = idx(gx, gy);
      if (coarseInside[i] && distance[i] === Infinity) {
        distance[i] = 0;
        queue[qTail++] = i;
      }
    }
  }

  while (qHead < qTail) {
    const i = queue[qHead++];
    const gx0 = i % gridWidth;
    const gy0 = (i / gridWidth) | 0;
    const d0 = distance[i];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = gx0 + dx;
        const ny = gy0 + dy;
        if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
        const nIdx = idx(nx, ny);
        if (!coarseInside[nIdx] || distance[nIdx] !== Infinity) continue;
        distance[nIdx] = d0 + 1;
        queue[qTail++] = nIdx;
      }
    }
  }

  // Gradient by central differences over grid indices, pointing toward
  // *decreasing* distance (south). Infinity neighbours (outside the mask,
  // or an unreached interior pocket — see module docs on coarse-grid
  // disconnection risk) are treated as "no information" by substituting
  // the centre cell's own value, so a coastal or disconnected edge doesn't
  // inject a bogus huge gradient.
  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const i = idx(gx, gy);
      if (distance[i] === Infinity) continue; // leave zero gradient
      const center = distance[i];
      const substitute = (v: number) => (v === Infinity ? center : v);
      const l = substitute(distance[idx(Math.max(0, gx - 1), gy)]);
      const r = substitute(distance[idx(Math.min(gridWidth - 1, gx + 1), gy)]);
      const u = substitute(distance[idx(gx, Math.max(0, gy - 1))]);
      const d = substitute(distance[idx(gx, Math.min(gridHeight - 1, gy + 1))]);
      // Distance increases away from the goal; negate to point toward it.
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

  return { gridWidth, gridHeight, cellSize, distance, gradX, gradY, sample };
}
