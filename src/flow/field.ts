import type { World } from './world';
import type { Vec2 } from './types';

/**
 * V1-skeleton flow field: southward base drift, weakening south, plus
 * boundary steering near the coast. This is deliberately the crude subset
 * of the spec's full field (section "The flow field") — curl noise and
 * source outflow are step 2/3 work; adding them now would make it
 * impossible to judge whether containment steering alone is working.
 *
 * Every weight is a named, independently tunable field on FieldParams so
 * later steps add terms without restructuring this function.
 */
export interface FieldParams {
  /** Southward drift speed (device px/sec) at the northernmost extent. */
  driftStrength: number;
  /** 0..1 — how much weaker the drift gets by the southernmost extent. */
  driftFalloff: number;
  /** Distance from coast (device px) at which boundary steering starts. */
  steerThreshold: number;
  /** Blend weight of the tangential (coast-hugging) component, 0..1. */
  steerWeight: number;
  /** Blend weight of the inward push component, 0..1. */
  pushWeight: number;
}

export const DEFAULT_FIELD_PARAMS: FieldParams = {
  driftStrength: 70,
  driftFalloff: 0.6,
  // GB is narrow — no point on the mainland is more than ~130 device px
  // from a coast in this projection (matching the real "no point in
  // Britain is more than 70 miles from the sea" fact). A steerThreshold
  // anywhere near that figure means steering is active almost everywhere,
  // fighting the drift constantly instead of only correcting near a real
  // coastline. Kept well under the interior max so most of the interior
  // sees pure drift.
  steerThreshold: 45,
  steerWeight: 0.7,
  pushWeight: 0.55,
};

/** 0 at the polygon's northernmost canvas y, 1 at its southernmost. */
function southness(y: number, world: World): number {
  const { top, bottom } = world.projection.bounds;
  if (bottom <= top) return 0;
  return Math.min(1, Math.max(0, (y - top) / (bottom - top)));
}

/**
 * Sample the field's desired velocity direction (unit-ish vector, not yet
 * scaled by a particle's own speed) at a canvas point, given the
 * particle's current heading (used to pick a steering tangent that doesn't
 * flip direction frame to frame).
 */
export function sampleField(
  pos: Vec2,
  heading: Vec2,
  world: World,
  params: FieldParams,
): Vec2 {
  const [x, y] = pos;
  const s = southness(y, world);
  const driftScale = 1 - s * params.driftFalloff;

  let vx = 0;
  let vy = params.driftStrength * driftScale;

  const { dist, gx, gy } = world.distanceField.sample(x, y);

  if (dist < params.steerThreshold) {
    // Gradient points from coast toward interior (inward). Tangent is
    // perpendicular; two candidates, pick whichever keeps the current
    // heading rather than reversing it.
    const t1x = -gy;
    const t1y = gx;
    const t2x = gy;
    const t2y = -gx;
    const [hx, hy] = heading;
    const dot1 = t1x * hx + t1y * hy;
    const dot2 = t2x * hx + t2y * hy;
    const [tx, ty] = dot1 >= dot2 ? [t1x, t1y] : [t2x, t2y];

    // Stronger the closer to (or past) the coast; a particle that's
    // already outside (dist < 0) gets an extra push, not just a blend.
    const proximity = Math.min(1, Math.max(0, 1 - dist / params.steerThreshold));
    const tangentSpeed = params.driftStrength; // comparable magnitude to drift
    vx += tx * tangentSpeed * params.steerWeight * proximity;
    vy += ty * tangentSpeed * params.steerWeight * proximity;

    const pushStrength = dist < 0 ? params.driftStrength * 1.5 : params.driftStrength * 0.5;
    vx += gx * pushStrength * params.pushWeight * proximity;
    vy += gy * pushStrength * params.pushWeight * proximity;
  }

  return [vx, vy];
}
