import { DEFAULT_CELL_SIZE, downsampleMaskToCoarseGrid } from './distanceField';
import type { RasterMask } from './mask';
import type { Vec2 } from './types';

/**
 * Divergent "away from sources" field — 2f of `Flow experiment fan-out.txt`.
 * Same technique as geodesicField.ts (a one-time multi-source integration
 * field over the interior mask, gradient followed at runtime instead of
 * per-particle pathfinding), seeded and pointed the opposite way:
 *
 *  - geodesicField.ts: seeds from a southern GOAL band, gradient points
 *    toward DECREASING distance (toward the goal). All shortest paths to a
 *    shared goal merge — that's what makes it convergent, and why the
 *    step-2 field funnelled through GB's narrow waists no matter how the
 *    other terms were tuned (see the fan-out doc's diagnosis).
 *  - divergentField.ts (here): seeds from the seven SOURCE cells, gradient
 *    points toward INCREASING distance (away from every source). All
 *    shortest paths *from* a shared set of sources spread apart as they
 *    move away from them — divergent by the same construction that made
 *    the goal-seeking field convergent. Narrowest exactly at the sources,
 *    widest at the far edges of what's reachable — the fan-out doc's "fan
 *    out to fill the space available", including into peninsulas the old
 *    field's south-goal gradient never routed flow toward at all.
 *
 * The BFS here is cost-weighted (a Dijkstra, not a plain unweighted BFS):
 * a step with a northward component costs `northwardCostMultiplier` times
 * a flat/southward step. Every source sits in the northern half of GB, so
 * "away from sources" is already broadly southward over most of the
 * interior's area; the anisotropic cost is what keeps it that way even
 * for the interior that happens to sit *north* of a source (the Highlands,
 * north of six of the seven), rather than fanning equally in every
 * direction and erasing "overall direction of travel" entirely. Owen,
 * 2026-08-05: decided to let the Highlands fill only weakly (a thin,
 * slow drift off Edinbane and Seagreen) rather than tune them out
 * entirely — some ink there is what makes the island's whole shape read
 * from the motion, per the spec's acceptance criteria, and the
 * anisotropic cost is the knob that sets exactly how weak "weakly" is.
 */
export interface DivergentField {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  /** Cost-weighted geodesic distance from the nearest source, in cost units (not px). Infinity for cells outside the mask or unreached. */
  distance: Float32Array;
  /** Unit gradient pointing toward *increasing* distance — away from the nearest source. Zero where distance is Infinity. */
  gradX: Float32Array;
  gradY: Float32Array;
  /** Sample at a device-pixel canvas point (nearest-cell). */
  sample(x: number, y: number): { dist: number; gx: number; gy: number };
}

/**
 * How much more a northward (decreasing-y) BFS step costs than a flat or
 * southward one. Higher = the fan reaches further north before it's worth
 * routing through the interior that way = a stronger pear-shape toward the
 * south. Tuned in 2j's system-wide retune; this is a reasonable starting
 * point (see the module doc's Highlands note).
 */
export const DEFAULT_NORTHWARD_COST_MULTIPLIER = 2.5;

/** 8-connected neighbour offsets, ordered arbitrarily (order doesn't affect the result). */
const NEIGHBOR_OFFSETS: readonly [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Minimal binary min-heap of (priority, cellIndex) pairs — the priority
 * queue Dijkstra needs once BFS's edge costs stop being uniform (see the
 * anisotropic northward cost above; an unweighted BFS, as geodesicField.ts
 * uses, only works because every edge there costs exactly 1). Plain-array
 * backed: this only ever runs once per world build (load + resize), so
 * simplicity wins over the fixed-capacity typed-array version.
 */
class MinHeap {
  private dist: number[] = [];
  private idx: number[] = [];

  get isEmpty(): boolean {
    return this.dist.length === 0;
  }

  push(dist: number, idx: number): void {
    this.dist.push(dist);
    this.idx.push(idx);
    let i = this.dist.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.dist[parent] <= this.dist[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): { dist: number; idx: number } | null {
    if (this.dist.length === 0) return null;
    const topDist = this.dist[0];
    const topIdx = this.idx[0];
    const lastDist = this.dist.pop()!;
    const lastIdx = this.idx.pop()!;
    if (this.dist.length > 0) {
      this.dist[0] = lastDist;
      this.idx[0] = lastIdx;
      let i = 0;
      const n = this.dist.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        let smallest = i;
        if (l < n && this.dist[l] < this.dist[smallest]) smallest = l;
        if (r < n && this.dist[r] < this.dist[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return { dist: topDist, idx: topIdx };
  }

  private swap(a: number, b: number): void {
    const d = this.dist[a];
    this.dist[a] = this.dist[b];
    this.dist[b] = d;
    const ix = this.idx[a];
    this.idx[a] = this.idx[b];
    this.idx[b] = ix;
  }
}

/**
 * Ring search outward from a coarse cell for the nearest interior coarse
 * cell — the coarse-grid equivalent of the same edge case `world.ts`'s
 * `snapInside` handles on the fine mask: a source's exact coarse cell
 * (nearest-pixel downsample of the fine mask) can land just outside even
 * when the fine-resolution source position itself is safely inside.
 */
function findNearestInsideCoarse(
  gx: number,
  gy: number,
  gridWidth: number,
  gridHeight: number,
  coarseInside: Uint8Array,
  maxRadius = 20,
): [number, number] | null {
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
        if (coarseInside[ny * gridWidth + nx]) return [nx, ny];
      }
    }
  }
  return null;
}

export function buildDivergentField(
  mask: RasterMask,
  sourcePositions: Vec2[],
  cellSize: number = DEFAULT_CELL_SIZE,
  northwardCostMultiplier: number = DEFAULT_NORTHWARD_COST_MULTIPLIER,
): DivergentField {
  const { gridWidth, gridHeight, coarseInside } = downsampleMaskToCoarseGrid(mask, cellSize);
  const n = gridWidth * gridHeight;
  const idx = (x: number, y: number) => y * gridWidth + x;

  const distance = new Float32Array(n).fill(Infinity);
  const gradX = new Float32Array(n);
  const gradY = new Float32Array(n);

  function sample(x: number, y: number) {
    const gx = Math.min(gridWidth - 1, Math.max(0, Math.round(x / cellSize)));
    const gy = Math.min(gridHeight - 1, Math.max(0, Math.round(y / cellSize)));
    const i = idx(gx, gy);
    return { dist: distance[i], gx: gradX[i], gy: gradY[i] };
  }

  const seedCells: number[] = [];
  for (const [sx, sy] of sourcePositions) {
    let gx = Math.min(gridWidth - 1, Math.max(0, Math.round(sx / cellSize)));
    let gy = Math.min(gridHeight - 1, Math.max(0, Math.round(sy / cellSize)));
    if (!coarseInside[idx(gx, gy)]) {
      const found = findNearestInsideCoarse(gx, gy, gridWidth, gridHeight, coarseInside);
      if (found) [gx, gy] = found;
    }
    seedCells.push(idx(gx, gy));
  }

  if (seedCells.length === 0) {
    // Degenerate — no sources resolved at all. Return an all-"no
    // information" field so sampleField's blend (pathWeight) contributes
    // nothing rather than this throwing.
    return { gridWidth, gridHeight, cellSize, distance, gradX, gradY, sample };
  }

  // Multi-source Dijkstra, 8-connected, anisotropic edge cost (see module
  // docs). Lazy deletion: a cell can be pushed more than once as shorter
  // paths are found; stale heap entries are skipped by comparing the
  // popped priority against the cell's current best distance.
  const heap = new MinHeap();
  for (const i of seedCells) {
    if (distance[i] > 0) {
      distance[i] = 0;
      heap.push(0, i);
    }
  }

  while (!heap.isEmpty) {
    const top = heap.pop()!;
    if (top.dist > distance[top.idx]) continue; // stale entry
    const gx0 = top.idx % gridWidth;
    const gy0 = (top.idx / gridWidth) | 0;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = gx0 + dx;
      const ny = gy0 + dy;
      if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
      const nIdx = idx(nx, ny);
      if (!coarseInside[nIdx]) continue;
      const stepCost = dy < 0 ? northwardCostMultiplier : 1;
      const nd = top.dist + stepCost;
      if (nd < distance[nIdx]) {
        distance[nIdx] = nd;
        heap.push(nd, nIdx);
      }
    }
  }

  // Gradient by central differences over grid indices, pointing toward
  // *increasing* distance (away from sources) — the mirror image of
  // geodesicField's convention, which negates to point toward decreasing
  // distance (toward its goal). Infinity neighbours (outside the mask, or
  // an unreached interior pocket) are treated as "no information" by
  // substituting the centre cell's own value, same as geodesicField.
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
      let dx = r - l;
      let dy = d - u;
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
