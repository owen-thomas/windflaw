import type { DensityField } from './densityField';
import { buildPerlin3, curl2D, type Noise3 } from './noise';
import type { World } from './world';
import type { Vec2 } from './types';

/**
 * The flow field: southward base drift (fanning out across England),
 * curl noise for organic swirl, whole-interior centering, and coast-hugging
 * boundary steering. This is the "Motion" step (step 2) build-out of the
 * spec's "The flow field" section — step 1 shipped only drift + boundary
 * steering; step 2 (see `Flow experiment step 2.txt`) adds the rest and
 * retunes the two step-1 terms now that they're not doing rescue duty
 * alone.
 *
 * Every weight is a named, independently tunable field on FieldParams so
 * later steps (control panel) add sliders without restructuring this
 * function.
 */
export interface FieldParams {
  /** Southward drift speed (device px/sec) at the northernmost extent. */
  driftStrength: number;
  /** 0..1 — how much weaker the drift gets by the southernmost extent. */
  driftFalloff: number;
  /**
   * East-west fan strength in England, 0..1-ish — the spec's "drift
   * spread". Zero at the horizontal centre line, growing with distance
   * from it and with southness, so Scotland (narrow, north) keeps a tight
   * drift while England (wide, south) visibly fans out rather than running
   * down a single spine.
   */
  driftSpread: number;
  /** Distance from coast (device px) at which boundary-steering rescue starts. */
  steerThreshold: number;
  /** Blend weight of the tangential (coast-hugging) rescue component, 0..1. */
  steerWeight: number;
  /** Blend weight of the inward push rescue component, 0..1. */
  pushWeight: number;
  /**
   * Whole-interior centering pull, 0..1-ish (step 2b). Unlike steering
   * above (a rescue that only fires within steerThreshold of the coast),
   * this applies everywhere, holding flow near the medial axis in narrow
   * Scotland so it drifts off the coast before the rescue ever has to
   * fire. Scaled by proximity-to-coast (relative to this world's actual
   * measured max interior distance) and by southness, so it fades toward
   * zero in wide, southern England — see `centerSouthFalloffExponent`.
   */
  centerWeight: number;
  /** How aggressively the centering term above dies out toward the south. Higher = dies out faster. */
  centerSouthFalloffExponent: number;
  /**
   * Coarse curl-noise octave's wavelength, expressed as cycles across GB's
   * width — resolution-independent, unlike a raw pixel frequency, so the
   * swirl feature count doesn't change with viewport size. ~3 cycles
   * across the width (GB being ~2.4x taller than wide) gives roughly 6-10
   * coherent swirl features across the whole frame, matching both
   * `Art Pin.gif` and `Digital Art.jpg` (step2 plan, point 2d).
   */
  noiseScale: number;
  /** How fast the noise field evolves over time. */
  noiseSpeed: number;
  /** Overall curl-noise strength, as a fraction of driftStrength. */
  noiseWeight: number;
  /**
   * How much the base direction follows `baseFieldMode`'s world field
   * instead of assuming a straight line south, 0..1. At 0, behaves like a
   * purely local field (naive "south is (0,1)"); at 1, the base direction
   * always follows that field's gradient. Added specifically for the
   * Scotland/England border trap (a genuine narrow waist a local field has
   * no way to route around) — see world.ts's `geodesicField` docs.
   */
  pathWeight: number;
  /**
   * Which precomputed world field `pathWeight` blends toward — 2f of
   * `Flow experiment fan-out.txt`.
   *
   * - 'divergent' (default): world.divergentField — a multi-source field
   *   seeded at the seven sources, gradient followed toward *increasing*
   *   distance. Divergent by construction: narrowest at the sources,
   *   spreading to fill every reachable cell. This is what kills the
   *   funnel (see the fan-out doc's diagnosis) — 'south' below is the
   *   funnel's direct cause, kept only for comparison.
   * - 'south': world.geodesicField — the step-2 field, a single southern
   *   goal band that every path converges toward. All shortest paths to a
   *   shared goal merge, which is what "shortest" means; that's the
   *   funnel. Kept behind this flag purely so the two can be A/B'd against
   *   each other (browser: 'f' key toggles it; harness: --baseFieldMode).
   */
  baseFieldMode: 'divergent' | 'south';
  /**
   * Master toggle for 2g's density-aware spacing mechanism (the steering
   * term below, plus particles.ts's coverage-recycling death cause). Off
   * skips the per-frame occupancy decay/gradient recompute entirely, not
   * just the steering term — a clean, zero-cost A/B (browser: 'g' key;
   * harness: --noDensity).
   */
  densityEnabled: boolean;
  /**
   * Density steering strength, as a fraction of driftStrength per unit of
   * "local density over target" (see densityTargetMultiplier). This is
   * what "how they're placed relative to each other" means mechanically:
   * a capped push down the local occupancy gradient (densityField.ts),
   * away from wherever flow has recently been crowded, applied only where
   * it's actually crowded — not a blanket repulsion that would just widen
   * every trail uniformly.
   */
  densityWeight: number;
  /** Density steering only fires where local density exceeds this multiple of the grid's current mean interior density — "target spacing". Scales with particle count/deposit rate automatically since it's relative, not an absolute occupancy constant. */
  densityTargetMultiplier: number;
  /** Absolute cap on the density steering term's contribution, device px/sec — the "capped" in "capped steering term", so a freshly-crowded cell (many particles spawning at once) can't overpower the rest of the field. */
  densityMaxPush: number;
  /** Per-second exponential decay rate of the occupancy grid — how quickly "recently crowded" forgets itself. */
  densityDecayRate: number;
  /** Occupancy added per second at a particle's current cell (before decay). */
  densityDepositRate: number;
  /**
   * Recycling for coverage: a particle sitting somewhere this many times
   * the grid's mean interior density, sustained for DENSITY_RECYCLE_DURATION
   * seconds (particles.ts), is respawned early at a fresh source rather
   * than left to keep contributing to an already-crowded cell. Makes
   * coverage something the system actively seeks, not just a side effect
   * of the steering term above.
   */
  densityRecycleThreshold: number;
  /**
   * Which mechanism carries the coarse/fine noise octaves — 2h of
   * `Flow experiment fan-out.txt`.
   * - 'transverse' (default): the noise *potential* (not its curl)
   *   displaces flow sideways, projected onto the perpendicular of the
   *   base direction accumulated so far. A perpendicular offset can never
   *   flip the sign of the along-flow component, so the flow can undulate
   *   — ebb and flow — but never be turned around by its own texture.
   * - 'isotropicCurl': the step-2 mechanism this replaces as default —
   *   divergence-free curl of the same scalar field, added directly, with
   *   no relationship to the base direction. Genuinely isotropic, which
   *   is exactly why it could (and did, at the sources) overpower and
   *   reverse the base direction — see noiseWeight's own history below.
   *   Kept behind this flag purely for A/B (browser: 'n' key; harness:
   *   --noiseMode).
   */
  noiseMode: 'transverse' | 'isotropicCurl';
  /**
   * 0..1-ish: how much the same coarse noise octave that drives
   * transverse wave motion also modulates 2g's density target, so bands
   * of gathered (higher target, tighter spacing tolerated before the
   * steering term fires) and loosened (lower target, more push) travel
   * through the flow as the noise evolves — Digital Art.jpg's wave
   * sensation, made of spacing rather than of path wiggles. 0 (2g's
   * landing value) leaves the target flat.
   */
  spacingWaveAmplitude: number;
  /**
   * Device px from the coast at which the gentle coast-conform band (2i of
   * `Flow experiment fan-out.txt`) starts. Wider than steerThreshold (the
   * tight rescue) on purpose — the spec's "near coasts it turns to run
   * alongside them" should read well before a particle is close enough to
   * need rescuing, not only as an accident of the rescue firing. The two
   * bands are gated not to overlap: conform is [steerThreshold,
   * conformThreshold), rescue is everything inside steerThreshold.
   */
  conformThreshold: number;
  /**
   * Max strength of the coast-conform rotation, 0..1, reached right at the
   * boundary where the tight rescue takes over (steerThreshold) and
   * ramping to 0 at conformThreshold. Unlike the rescue below (which
   * pushes/blends velocity additively), this rotates the base direction
   * toward the coast tangent while preserving its magnitude — a conform,
   * not a push: it bends the journey rather than adding energy to it.
   */
  conformWeight: number;
}

export const DEFAULT_FIELD_PARAMS: FieldParams = {
  driftStrength: 70,
  // Raised from step 1's 0.6: with the age-budget clamp and single-river
  // funnel both being fixed elsewhere (particles.ts, this file's steering
  // tie-break), drift needs to actually approach a stall in the far south
  // for the spec's third death condition ("slowing to a stop") to mean
  // anything — see particles.ts's driftScale-coupled speed.
  driftFalloff: 0.85,
  driftSpread: 0.5,
  // GB is narrow — no point on the mainland is more than ~130 device px
  // from a coast in this projection (matching the real "no point in
  // Britain is more than 70 miles from the sea" fact). Brought down from
  // step 1's 45, and further still after a live check in the browser: two
  // of the seven sources are snapped-to-coast (world.ts's SNAP_BUFFER_PX
  // is only 24px), and at 32 they were spawning already inside the
  // rescue's threshold — every particle from those sources was grabbed by
  // coast steering before it ever got a chance to establish a stable,
  // drift-dominated heading, which read as a tangled clump hugging the
  // spawn point rather than a journey south. Below the snap buffer so a
  // freshly spawned particle starts in free-drift territory.
  steerThreshold: 18,
  steerWeight: 0.55,
  pushWeight: 0.55,
  // A first harness pass at 0.35, then 0.12, still showed a live check
  // producing a tight clump near the (coast-adjacent) sources rather than
  // a journey south — the medial axis a centering pull gathers flow
  // toward is, in a narrow country, itself close to a single line, and
  // Scotland's central belt sits close to coastlines on both sides, so
  // even a "weak" centering term was fighting the drift immediately at
  // spawn. Down again to something that's genuinely a light touch.
  centerWeight: 0.06,
  centerSouthFalloffExponent: 2.5,
  noiseScale: 3,
  noiseSpeed: 0.05,
  // Root cause of the near-source trapping problem (the dominant failure
  // mode left after the border-region path-aware fix — median lifespan
  // was still ~4.9s, ~94% "trapped", essentially unchanged from before
  // that fix): decomposing the field at all seven sources showed curl
  // noise's own magnitude (60-127 px/s there) *consistently exceeding*
  // base drift's (47-60 px/s) — see Flow experiment step 2.txt's
  // follow-up. Curl noise is isotropic by construction; once it's the
  // *larger* term, the net direction stops being reliably southward at
  // all, right where predictability matters most (freshly spawned
  // particles, before they've gone anywhere). An earlier sweep (0.35 vs
  // 0.8 vs 1.3) had found 1.3 best, but that was before the geodesic
  // path-aware field existed — noise was doing double duty as the *only*
  // path-diversifying mechanism then. With the geodesic field now doing
  // that job correctly, re-sweeping on the current full system flipped
  // the result entirely: 0.1-0.2 measured dramatically better on every
  // metric than 1.3 (p50 lifespan 14s vs 4.9s, "trapped" share ~50% vs
  // ~94%, share reaching 80% south ~29% vs ~0%, *and* better — lower —
  // concentration despite less path diversification, since noise turns
  // out to have been actively hurting concentration too, not helping it).
  // 0.15 keeps enough real swirl for organic texture (the spec's "not a
  // uniform particle system") without letting it swamp the drift.
  // Bumped 0.15 -> 0.4 landing 2h: that whole ceiling was about the
  // *isotropic* mechanism specifically (it could reverse the base
  // direction once it was the larger term, which is what capped it so
  // low) — 2h's transverse projection can't reverse anything by
  // construction, so the same failure mode doesn't apply. 0.4 is a first
  // interim bump to where the coarse octave's 6-10 wave features actually
  // read (they were nearly invisible at 0.15); final figure is 2j's, once
  // this is judged against Digital Art.jpg's transverse-wave rhythm
  // directly rather than inferred from harness numbers alone.
  noiseWeight: 0.4,
  // Retuned 0.9 -> 0.6 landing 2f, specifically because of how it
  // interacts with baseFieldMode='divergent'. At 0.9 the divergent field
  // was diagnosed (harness sweep during that session) to dominate right
  // where it's least reliable: exactly at a source cell the "away from
  // source" gradient is a true point-source singularity (every direction
  // is equally "away"), and with five of the seven sources sitting within
  // ~80px of each other near the west coast, their basins' Voronoi-like
  // ridges sit right where particles spawn — at 0.9, particles spent most
  // of their short lives tangled in that near-source ambiguity,
  // oscillating against coast steering ("trapped" deaths 94%, p50 lifespan
  // 4.87s) rather than actually fanning out. 0.6 keeps the divergent field
  // dominant (it's still the majority term) while blending back enough
  // naive-straight-south to carry particles clear of the near-source ridge
  // before it has much say — measured markedly better on the metrics 2f is
  // actually for: interior coverage 46.8% -> 77.2%, top-5%-cell
  // concentration 76.8% -> 50.9% (1500 particles, 40s). Below ~0.5 the
  // divergent field stops being able to route around real coastal traps at
  // all and both numbers collapse (step 1's original "no path-awareness"
  // failure mode reappearing) — 0.6 is comfortably above that cliff. Final
  // figure, like every other weight here, is still subject to 2j's
  // whole-system retune.
  pathWeight: 0.6,
  // 2f: divergent-from-sources is the fix for the funnel (see this field's
  // own docs above); 'south' — the step-2 field this replaces as default —
  // stays wired up behind the flag purely for A/B comparison.
  baseFieldMode: 'divergent',
  // 2g: on by default — see field's own docs for what each knob does. A
  // harness sweep (1400 particles, 45s) found the mechanism's headline
  // metrics move a lot from merely being on (interior coverage 76.7% ->
  // ~85%, top-5%-cell concentration 51.9% -> ~38-39%) but are fairly flat
  // across a wide range of individual knob values — densityWeight 0.4-2.5
  // and densityTargetMultiplier 1-2 all land within a percentage point or
  // two of each other. The one knob that *does* move things is
  // densityRecycleThreshold, which trades density-cause death share
  // against how much the recycling mechanism itself contributes (2 ->
  // 60% of deaths but barely better coverage than 999 -> 0%, i.e.
  // recycling turned off outright) — 4 sits in the middle, meaningfully
  // active without dominating the death-cause mix. Values below are that
  // sweep's picks; final calibration, like every weight here, is still
  // 2j's.
  densityEnabled: true,
  densityWeight: 0.9,
  densityTargetMultiplier: 1.4,
  densityMaxPush: 55,
  densityDecayRate: 0.8,
  densityDepositRate: 1,
  densityRecycleThreshold: 4,
  // 2h: transverse is the fix for the reversal problem (see noiseMode's
  // own docs above); 'isotropicCurl' — the step-2 mechanism this replaces
  // as default — stays wired up behind the flag purely for A/B.
  noiseMode: 'transverse',
  // On by default at a modest amplitude — see spacingWaveAmplitude's own
  // docs. Kept well under 1 so the target can loosen substantially in a
  // trough but never so far it goes negative (the density block clamps
  // that regardless, but this keeps normal operation away from the clamp).
  spacingWaveAmplitude: 0.5,
  // 2i: comfortably wider than steerThreshold's 18px, so the conform band
  // has room to actually turn a particle before the tight rescue would
  // otherwise have to. See conformWeight's own docs for why it rotates
  // rather than pushes.
  conformThreshold: 55,
  conformWeight: 0.55,
};

/**
 * Fixed-at-spawn per-particle personality (step 2c). The cheapest attack on
 * "one attractor channel": even a fully deterministic field fans out under
 * per-particle constants. Assigned once at respawn, persists for that
 * particle's whole life — not resampled per frame.
 */
export interface ParticleTraits {
  /**
   * Small additive bias on the coast tie-break's (dot1 - dot2) in
   * `sampleField` below. Breaks near-ties — the exact mechanism behind the
   * single-river funnel on a south-facing coast (step2 plan, point 2) —
   * without overriding coasts where the current heading clearly favours
   * one tangent. A hard per-particle override would cause wrong-way turns
   * on coasts approached obliquely; additive keeps that safe.
   */
  chirality: number;
  /**
   * Small constant world-space lateral drift, device px/sec. Persistent
   * per particle, independent of heading — fans particles from the same
   * source apart over their lifetime.
   */
  lateralBias: number;
  /**
   * Phase offset (seconds) into the fine curl-noise octave's time axis.
   * The coarse octave is shared, unshifted, by every particle — it has to
   * be, to read as one coherent field rather than each particle inventing
   * its own weather. The fine octave carries this offset so a particle's
   * texture/wobble decorrelates from its neighbours without disturbing the
   * coarse structure everyone agrees on.
   */
  noisePhase: number;
}

export const DEFAULT_TRAITS: ParticleTraits = { chirality: 0, lateralBias: 0, noisePhase: 0 };

const DEFAULT_NOISE_SEED = 1337;
let defaultNoise3: Noise3 = buildPerlin3(DEFAULT_NOISE_SEED);

/** Reseed the shared default curl-noise field — the control panel's "random seed" knob. */
export function reseedNoise(seed: number): void {
  defaultNoise3 = buildPerlin3(seed);
}

export interface FieldSample {
  vx: number;
  vy: number;
  /**
   * 0..1, this point's southward drift fraction (1 = full northern
   * strength, 0 = fully decayed). Exposed so particles.ts can couple
   * advection speed to it directly, rather than the field's total
   * magnitude — total magnitude also rises near coasts from steering, and
   * a "slowing down" cue has to come from the drift term specifically, not
   * from the rescue getting louder.
   */
  driftScale: number;
}

/** 0 at the polygon's northernmost canvas y, 1 at its southernmost. */
export function southness(y: number, world: World): number {
  const { top, bottom } = world.projection.bounds;
  if (bottom <= top) return 0;
  return Math.min(1, Math.max(0, (y - top) / (bottom - top)));
}

/**
 * Sample the field's desired velocity (unit-ish direction plus a
 * driftScale readout) at a canvas point, given the particle's current
 * heading (to pick a steering tangent that doesn't flip frame to frame)
 * and its persistent traits (chirality, lateral bias, noise phase).
 *
 * One `distanceField.sample` call is reused for both the centering term
 * and the boundary-steering rescue — the spec's "one field lookup per
 * particle" performance target holds even though this function now does
 * more with that one lookup. Curl noise adds 8 raw noise evaluations
 * (2 octaves x central-difference in x and y); at the spec's target
 * particle counts (3-8k) that's direct-compute territory, not a case for
 * an extra precomputed grid layer — see Flow_Experiment_Spec.md's
 * "Performance target".
 */
export function sampleField(
  pos: Vec2,
  heading: Vec2,
  world: World,
  params: FieldParams,
  time = 0,
  traits: ParticleTraits = DEFAULT_TRAITS,
  noise3: Noise3 = defaultNoise3,
  /**
   * 2g's occupancy grid — owned by particles.ts's ParticleSystem (dynamic
   * simulation state, not world geometry), passed in rather than looked
   * up from `world` for that reason. Null when densityEnabled is false or
   * the caller has no particle system yet (e.g. a future headless field
   * visualiser); the density term below simply doesn't apply then.
   */
  densityField: DensityField | null = null,
): FieldSample {
  const [x, y] = pos;
  const { bounds } = world.projection;
  const s = southness(y, world);
  const driftScale = 1 - s * params.driftFalloff;

  let vx = 0;
  let vy = params.driftStrength * driftScale;

  // --- Path-aware base direction: blend the naive straight-south
  // direction with a precomputed world field — world.divergentField (2f
  // default: away from the sources, divergent by construction) or
  // world.geodesicField (the step-2 field this replaces: toward a southern
  // goal band, convergent by construction — see baseFieldMode's docs). At
  // pathWeight=1 this fully replaces (0,1) with that field's direction; at
  // 0 it's pure straight-line south. Everything below (fan, centering,
  // noise, steering) still layers on top of this base direction exactly as
  // before — only what it follows has changed.
  if (params.pathWeight > 0) {
    const path =
      params.baseFieldMode === 'south'
        ? world.geodesicField.sample(x, y)
        : world.divergentField.sample(x, y);
    if (path.dist !== Infinity && (path.gx !== 0 || path.gy !== 0)) {
      const pathVx = path.gx * params.driftStrength * driftScale;
      const pathVy = path.gy * params.driftStrength * driftScale;
      vx = vx * (1 - params.pathWeight) + pathVx * params.pathWeight;
      vy = vy * (1 - params.pathWeight) + pathVy * params.pathWeight;
    }
  }

  // --- East-west fan (2e): spread flow across England instead of running
  // down a single spine. Zero at the horizontal centre, growing with
  // distance from it and with southness, so Scotland stays a tight drift
  // and England's flow visibly fans out.
  const halfWidth = (bounds.right - bounds.left) / 2 || 1;
  const centerX = (bounds.left + bounds.right) / 2;
  const lateralPos = Math.min(1, Math.max(-1, (x - centerX) / halfWidth));
  vx += params.driftSpread * s * lateralPos * params.driftStrength;

  const { dist, gx, gy } = world.distanceField.sample(x, y);

  // --- Whole-interior centering (2b): holds flow near the medial axis
  // where GB is narrow (most of Scotland), fading toward zero in the wide
  // south so it doesn't recreate a single-spine funnel down England.
  // Applied everywhere (not gated by steerThreshold) so it keeps flow off
  // the coast *before* the rescue below has to fire.
  if (world.maxInteriorDist > 1e-3 && params.centerWeight > 0) {
    const proximityToCoast = Math.min(1, Math.max(0, 1 - dist / world.maxInteriorDist));
    const southFalloff = Math.pow(Math.max(0, 1 - s), params.centerSouthFalloffExponent);
    const centerStrength = params.centerWeight * proximityToCoast * southFalloff * params.driftStrength;
    vx += gx * centerStrength;
    vy += gy * centerStrength;
  }

  // --- Wave noise (2d, mechanism replaced by 2h): coarse octave shared by
  // every particle at a wavelength ~1/3 of GB's width, giving 6-10
  // coherent features across the frame; fine octave carries the
  // particle's own noisePhase for per-particle texture. See noiseMode's
  // docs for why 'transverse' is the default and what 'isotropicCurl'
  // (the mechanism this replaced) got wrong.
  const FINE_FREQ_RATIO = 3.5;
  const FINE_WEIGHT_RATIO = 0.35;
  if (params.noiseWeight > 0) {
    const width = bounds.right - bounds.left || 1;
    const coarseFreq = params.noiseScale / width;
    const t = time * params.noiseSpeed;

    if (params.noiseMode === 'transverse') {
      // The noise *potential* itself (not its curl) displaces flow
      // sideways, projected onto the perpendicular of the base direction
      // accumulated so far (vx, vy) — rotate 90°. A perpendicular offset
      // is orthogonal to the along-flow component by construction, so it
      // can never flip its sign: the flow undulates but can't be turned
      // around by its own texture, however large noiseWeight gets.
      const baseLen = Math.hypot(vx, vy) || 1;
      const bx = vx / baseLen;
      const by = vy / baseLen;
      const px = -by;
      const py = bx;

      const coarseAmp = noise3(x * coarseFreq, y * coarseFreq, t); // ~[-1, 1]
      vx += px * coarseAmp * params.noiseWeight * params.driftStrength;
      vy += py * coarseAmp * params.noiseWeight * params.driftStrength;

      const fineAmp = noise3(
        x * coarseFreq * FINE_FREQ_RATIO,
        y * coarseFreq * FINE_FREQ_RATIO,
        t * 1.6 + traits.noisePhase,
      );
      vx += px * fineAmp * params.noiseWeight * FINE_WEIGHT_RATIO * params.driftStrength;
      vy += py * fineAmp * params.noiseWeight * FINE_WEIGHT_RATIO * params.driftStrength;
    } else {
      const NOISE_EPS = 1e-3; // finite-difference step, in noise-space (post-frequency-scale) units
      const [ncx, ncy] = curl2D(noise3, x * coarseFreq, y * coarseFreq, t, NOISE_EPS);
      vx += ncx * params.noiseWeight * params.driftStrength;
      vy += ncy * params.noiseWeight * params.driftStrength;

      const [nfx, nfy] = curl2D(
        noise3,
        x * coarseFreq * FINE_FREQ_RATIO,
        y * coarseFreq * FINE_FREQ_RATIO,
        t * 1.6 + traits.noisePhase,
        NOISE_EPS,
      );
      vx += nfx * params.noiseWeight * FINE_WEIGHT_RATIO * params.driftStrength;
      vy += nfy * params.noiseWeight * FINE_WEIGHT_RATIO * params.driftStrength;
    }
  }

  // --- Per-particle lateral bias (2c): fixed-at-spawn personality, so even
  // a fully deterministic field fans out under per-particle constants.
  vx += traits.lateralBias;

  // --- Density-aware spacing (2g): a capped push down the local occupancy
  // gradient, but only where it's actually crowded (local density over a
  // target multiple of the grid's current mean) — this is what makes it
  // spacing rather than a blanket repulsion. Applied everywhere, like
  // centering above, so it's part of the base journey, not a coast rescue.
  if (params.densityEnabled && params.densityWeight > 0 && densityField) {
    const { density, gx: dgx, gy: dgy } = densityField.sample(x, y);
    let targetMultiplier = params.densityTargetMultiplier;
    if (params.spacingWaveAmplitude > 0) {
      // 2h, second half: modulate the target with the SAME coarse noise
      // octave the transverse wave noise above rides on (same frequency,
      // same time axis — recomputed here rather than threaded through as
      // an extra return value, since sampleField's other terms are each
      // self-contained blocks by convention) so bands of gathered (wave
      // high -> higher target, tighter spacing tolerated) and loosened
      // (wave low -> lower target, more push) travel through the flow at
      // the same pace as the visible undulation — Digital Art.jpg's wave
      // sensation, made of spacing rather than of path wiggles.
      const width = bounds.right - bounds.left || 1;
      const coarseFreq = params.noiseScale / width;
      const t = time * params.noiseSpeed;
      const wave = noise3(x * coarseFreq, y * coarseFreq, t); // ~[-1, 1]
      targetMultiplier *= 1 + wave * params.spacingWaveAmplitude;
    }
    // Floored well above zero: a target of 0 (or negative) would make the
    // steering term fire everywhere, including where the field is calm —
    // exactly the blanket repulsion this mechanism is meant not to be.
    const target = densityField.meanInteriorDensity * Math.max(0.1, targetMultiplier);
    const over = density - target;
    if (over > 0) {
      const push = Math.min(params.densityMaxPush, over * params.densityWeight * params.driftStrength);
      vx += dgx * push;
      vy += dgy * push;
    }
  }

  // --- Coast conformance (2i): a wide, gentle band that rotates the base
  // direction (everything computed above — drift, path, fan, centering,
  // noise, lateral bias, density) toward the coast tangent well before the
  // tight rescue below has to fire. 2f and 2g push lines outward into
  // coastal cells; this is what turns them to run along the coast once
  // they arrive, which is what actually makes the silhouette legible —
  // "fan-out delivers ink to the edge, conformance makes the edge
  // legible" (the fan-out doc). Gated to stay outside the tight rescue's
  // radius so the two bands don't double up.
  if (dist < params.conformThreshold && dist >= params.steerThreshold && params.conformWeight > 0) {
    const proximity = Math.min(
      1,
      Math.max(
        0,
        (params.conformThreshold - dist) / Math.max(1e-3, params.conformThreshold - params.steerThreshold),
      ),
    );
    const blend = params.conformWeight * proximity;
    const baseLen = Math.hypot(vx, vy) || 1;
    const bx = vx / baseLen;
    const by = vy / baseLen;
    // Tangent candidates, pick whichever keeps the field's own emerging
    // direction (bx, by) rather than reversing it — same tie-break shape
    // as the tight rescue below, but against the base direction computed
    // so far, not the particle's persisted heading (that's eased toward
    // this result afterwards, in particles.ts).
    const t1x = -gy;
    const t1y = gx;
    const t2x = gy;
    const t2y = -gx;
    const dot1 = t1x * bx + t1y * by;
    const dot2 = t2x * bx + t2y * by;
    const [tanX, tanY] = dot1 >= dot2 ? [t1x, t1y] : [t2x, t2y];
    // Rotate toward the tangent, preserving magnitude — a conform, not a
    // push (see conformWeight's own docs).
    const newBx = bx * (1 - blend) + tanX * blend;
    const newBy = by * (1 - blend) + tanY * blend;
    const newLen = Math.hypot(newBx, newBy) || 1;
    vx = (newBx / newLen) * baseLen;
    vy = (newBy / newLen) * baseLen;
  }

  // --- Boundary steering (rescue near the coast).
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
    // 2c: additive chirality bias, not an absolute override — breaks
    // near-ties (the single-river funnel) without flipping coasts the
    // heading clearly favours one way on.
    const dot2 = t2x * hx + t2y * hy + traits.chirality;
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

  return { vx, vy, driftScale };
}
