/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher, 2004).
 * Two passes of a 1D lower-envelope algorithm — linear in the number of
 * cells — turn a 0/INF "source" grid into squared distance to the nearest
 * source cell everywhere. Used to build the coastal distance field: source
 * cells are the coastline, and this is dramatically cheaper than the
 * brute-force nearest-segment scan the spec suggests, while producing the
 * same exact-distance result.
 */

const INF = 1e20;

/** 1D squared distance transform of f (source cells hold 0, others INF). */
function dt1d(f: Float64Array): Float64Array {
  const n = f.length;
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;

  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
  return d;
}

/**
 * 2D squared EDT, in place-ish (returns a new Float64Array). `sources` is
 * a width*height grid: 0 marks a source cell, any large/INF value marks a
 * non-source cell. Result is squared distance (in grid-cell units) to the
 * nearest source cell, for every cell.
 */
export function squaredDistanceTransform(
  sources: Float64Array,
  width: number,
  height: number,
): Float64Array {
  const grid = Float64Array.from(sources);

  // Columns first.
  const col = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) col[y] = grid[y * width + x];
    const d = dt1d(col);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }

  // Then rows.
  const row = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) row[x] = grid[y * width + x];
    const d = dt1d(row);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x];
  }

  return grid;
}

export { INF };
