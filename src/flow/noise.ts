/**
 * Seedable, dependency-free 3D Perlin noise (Ken Perlin's 2002 "improved
 * noise" algorithm — a public-domain technique, reimplemented here rather
 * than pulled in as a package, matching the spec's "no rendering libraries"
 * / vanilla-TS constraint. This is a generic noise primitive, not part of
 * any rendering pipeline).
 *
 * Used as the scalar potential for curl noise (see `curl2D` below), which
 * is step 2d of Flow experiment step 2.txt: divergence-free noise for the
 * organic swirl/eddy character in `Art Pin.gif` / `Digital Art.jpg`.
 * Re-seedable so the control panel's "random seed" knob (spec section
 * "Control panel") can reshuffle the swirl pattern, not just particle
 * spawn jitter.
 */

/** Small seeded PRNG (mulberry32) — deterministic across runs for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Noise3 = (x: number, y: number, z: number) => number;

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

/** Perlin's 2002 gradient function: 16 directions via bit tricks, no lookup table. */
function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}

/** Build a noise3(x, y, z) function with its own seeded permutation table. */
export function buildPerlin3(seed: number): Noise3 {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates, seeded — deterministic shuffle for a given seed.
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  return function noise3(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);

    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;

    return lerp(
      w,
      lerp(
        v,
        lerp(u, grad(perm[AA], xf, yf, zf), grad(perm[BA], xf - 1, yf, zf)),
        lerp(u, grad(perm[AB], xf, yf - 1, zf), grad(perm[BB], xf - 1, yf - 1, zf)),
      ),
      lerp(
        v,
        lerp(u, grad(perm[AA + 1], xf, yf, zf - 1), grad(perm[BA + 1], xf - 1, yf, zf - 1)),
        lerp(
          u,
          grad(perm[AB + 1], xf, yf - 1, zf - 1),
          grad(perm[BB + 1], xf - 1, yf - 1, zf - 1),
        ),
      ),
    );
  };
}

/**
 * Divergence-free 2D velocity from the curl of a 3D scalar noise field,
 * sampled at (x, y, t): velocity = (dN/dy, -dN/dx). Being the curl of a
 * potential, this has zero divergence everywhere by construction — it adds
 * swirl but no sources or sinks to the flow field (Flow_Experiment_Spec.md,
 * "The flow field", point 2). `eps` is the finite-difference step, in the
 * same units as x/y (device px) — independent of noise wavelength.
 */
export function curl2D(
  noise3: Noise3,
  x: number,
  y: number,
  t: number,
  eps: number,
): [number, number] {
  const dNdy = (noise3(x, y + eps, t) - noise3(x, y - eps, t)) / (2 * eps);
  const dNdx = (noise3(x + eps, y, t) - noise3(x - eps, y, t)) / (2 * eps);
  return [dNdy, -dNdx];
}
