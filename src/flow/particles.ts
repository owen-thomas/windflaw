import { buildDensityField, type DensityField } from './densityField';
import {
  DEFAULT_FIELD_PARAMS,
  sampleField,
  type FieldParams,
  type ParticleTraits,
} from './field';
import type { RasterMask } from './mask';
import type { World } from './world';
import { resolveStrokeColor, resolveStrokeWidth, type Palette } from './palette';

export interface MaskClampResult {
  /** The last sample along the segment confirmed inside the mask. */
  x: number;
  y: number;
  /** True if any sample along the segment fell outside the mask. */
  left: boolean;
}

/**
 * Ring search outward from (x, y) for the nearest inside-the-mask pixel,
 * within a small radius. Only ever called when a particle's *starting*
 * position for the frame is already outside — a residual escape from a
 * previous frame's sub-pixel gap (see clampToMask's docs) — so this is
 * rare, and the radius is small enough that the cost doesn't matter when
 * it does run.
 */
function findNearestInside(
  x: number,
  y: number,
  mask: RasterMask,
  maxRadius = 8,
): { x: number; y: number } | null {
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const nx = x + dx;
        const ny = y + dy;
        if (mask.isInside(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

/**
 * Walk (x0,y0)-(x1,y1) at ~1 device-px resolution and return the last
 * inside-the-mask sample, plus whether the segment left the mask at all.
 * This is the shared primitive behind both the mechanical containment
 * check (`segmentLeavesMask`, unchanged behaviour) and the step 2a rescue
 * in `ParticleSystem.step` below, which needs the actual clamp point, not
 * just a yes/no.
 *
 * 2 samples/px: a diagonal coastline is a pixel staircase, and a segment
 * crossing it at a shallow angle can graze a step between once-per-px
 * samples even when both endpoints test inside. That means, rarely, a
 * particle's committed position can itself already be outside at the
 * start of the *next* frame — this function's own walk would find no
 * inside sample at all in that case (t=0 already fails) and, left
 * unhandled, the particle would freeze there, unable to make forward
 * progress, racking up strikes without moving until it hits the strike
 * limit. `findNearestInside` recovers from that starting condition
 * directly, rather than only ever depending on it not occurring.
 */
export function clampToMask(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mask: RasterMask,
): MaskClampResult {
  if (!mask.isInside(x0, y0)) {
    const recovered = findNearestInside(x0, y0, mask);
    if (recovered) return { x: recovered.x, y: recovered.y, left: true };
    // No inside pixel within range — should be unreachable in practice
    // (it would mean the particle is deep outside GB entirely). Hold
    // position rather than propagate a point neither call site can use.
    return { x: x0, y: y0, left: true };
  }

  const length = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(2, Math.ceil(length * 2));
  let lastX = x0;
  let lastY = y0;
  let left = false;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = x0 + (x1 - x0) * t;
    const py = y0 + (y1 - y0) * t;
    if (!mask.isInside(px, py)) {
      left = true;
      break;
    }
    lastX = px;
    lastY = py;
  }
  return { x: lastX, y: lastY, left };
}

/**
 * True if any point along the segment falls outside the mask. Exported so
 * the containment verification check can hold the exact same rendered-line
 * standard the runtime enforces, rather than a looser approximation of it.
 */
export function segmentLeavesMask(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mask: RasterMask,
): boolean {
  return clampToMask(x0, y0, x1, y1, mask).left;
}

/**
 * Project a heading onto the local coastline tangent, discarding its
 * component along the distance-field gradient (the normal axis). Used for
 * the step 2a rescue: "glide, not scrape" — a shallow graze becomes a
 * smooth deflection along the boundary rather than a bounce off it. Same
 * containment guarantee as reflecting would give (the outward component is
 * gone either way), but no visible kink.
 */
function projectOntoTangent(hx: number, hy: number, gx: number, gy: number): [number, number] {
  if (gx === 0 && gy === 0) return [hx, hy];
  const dot = hx * gx + hy * gy;
  const tx = hx - dot * gx;
  const ty = hy - dot * gy;
  const len = Math.hypot(tx, ty);
  if (len < 1e-6) {
    // Heading was ~exactly along the normal (a dead-on approach) — the
    // projection is degenerate. Slide along the gradient's own
    // perpendicular so a straight-in approach still glides rather than
    // stalling; which of the two tangents is arbitrary here since neither
    // was already favoured.
    return [-gy, gx];
  }
  return [tx / len, ty / len];
}

// --- Step 2a: rescue instead of kill ---------------------------------------
// A particle is killed for grazing the coast only after this many
// consecutive strikes (see `strikes` below), not on the first one.
// Containment doesn't depend on this number at all — every clamp is
// already forced inside before it's ever drawn — so it's purely a "give up,
// this particle seems stuck" threshold, not a containment mechanism. Harness
// runs at 16 and 40 both still showed the large majority of all deaths as
// strike-outs: a real coastal glide along a jagged, raster-staircased
// stretch, or through Scotland's narrow, fjord-like west coast, can
// legitimately re-graze on most frames for well over a second while making
// genuine (if slow) progress. Raised until consecutive strikes essentially
// never trip this on their own — the TRAPPED_* checkpoint below now does
// the actual "genuinely stuck" job, by measuring real net displacement
// rather than an unbroken run of single-frame grazes, so this is a pure
// last-resort backstop for a pathological run of consecutive strikes even
// the trapped check hasn't caught yet.
const STRIKE_LIMIT = 200;
// After a clamp, nudge this many device px further inward (along the SDF
// gradient) than the literal last-inside sample, when that nudge itself
// tests inside. Without it, the clamped point sits exactly on the
// waterline, and the raster coastline's stair-step artefacts can trigger
// another graze on the very next frame from pure tangential motion alone.
// Raised from a first guess of 1.5px, which was still inside the raster's
// own staircase amplitude (mask.ts's morphological closing handles gaps up
// to ~1-1.5px) and so didn't reliably clear it.
const CLAMP_NUDGE_PX = 2;

// --- Step 2e (stall): a genuine southern terminator -------------------------
// driftScale (from field.ts) below this, sustained for STALL_DURATION
// seconds, counts as "slowed to a stop in the far south" — the spec's
// third death condition. Gated on the field's position-based decay, not on
// a particle's own effective speed, so a particle that merely drew a slow
// personal speed jitter early in Scotland isn't mistaken for one that has
// genuinely run out of road.
const STALL_DRIFT_SCALE = 0.2;
const STALL_DURATION = 1.5; // seconds

// --- Trapped detector --------------------------------------------------------
// A general, geometry-agnostic backstop for the failure mode strike-
// counting alone can miss: a particle oscillating back and forth in a
// tight coastal pocket (a sea loch, a narrow strait like Kyle of Lochalsh)
// can go clean-graze-clean-graze indefinitely without ever stringing
// together enough *consecutive* strikes to hit STRIKE_LIMIT, while making
// almost no net progress. Rather than hand-tune steering weights against
// every such pocket individually, check actual net displacement over a
// rolling window directly — "genuinely stopped getting anywhere" is a
// simpler, more robust signal than any specific force balance.
const TRAPPED_CHECK_INTERVAL = 1.2; // seconds between displacement checks
const TRAPPED_MIN_DISPLACEMENT = 25; // device px of net progress required per interval

// --- Step 2g: density-aware spacing --------------------------------------
// How long a particle has to sit somewhere over densityRecycleThreshold x
// the grid's mean before it's force-respawned (see field.ts's docs and
// the `overDensityTime` tracking below). Longer than STALL_DURATION —
// sitting in a crowded cell isn't dangerous the way stalling in the far
// south is, it's just wasteful, so it gets a more patient grace period
// before the system intervenes.
const DENSITY_RECYCLE_DURATION = 2.0; // seconds

// --- Step 2c: per-particle persistence --------------------------------------
// Ranges for the fixed-at-spawn traits passed into sampleField. Deliberately
// small relative to the quantities they perturb (see field.ts's docs on
// each trait) — texture, not a second field.
const CHIRALITY_MAGNITUDE = 0.5; // ± half this, additive on the coast tie-break's dot difference
const LATERAL_BIAS_MAGNITUDE = 20; // device px/sec, ± half this

// Heading-ease rate, expressed at a 60fps baseline and converted to a
// dt-aware blend fraction in step() — see the step2 plan feedback: the
// step 1 fixed 0.25-per-frame ease was implicitly tuned to 60fps and any
// retuning of downstream field weights would only have held at 60fps.
const EASE_RATE_AT_60FPS = 0.25;

export type DeathCause = 'age' | 'strike' | 'stall' | 'trapped' | 'density';

export interface ParticleSystemOptions {
  /**
   * 'dynamic' (default): age budget sized from this world's actual
   * north-south extent, so a real tail of particles can physically cross
   * it. 'legacy': step 1's fixed 4-9s ceiling — kept only so the step 2
   * instrumentation harness (scripts/flow-harness.ts) can produce true
   * before/after numbers for the age-budget fix in isolation from the
   * other 2a-2e changes (step2 plan feedback: "make the budget a
   * separately toggled harness knob").
   */
  ageBudgetMode?: 'dynamic' | 'legacy';
  /**
   * Fired right before a particle respawns, with its cause and the age it
   * died at. Purely an observability hook for the harness — never used by
   * the runtime page — so per-life data (lifespan distribution,
   * throughput-by-latitude) can be gathered without the particle pool
   * itself accumulating unbounded history.
   */
  onDeath?: (index: number, cause: DeathCause, ageAtDeath: number) => void;
}

/**
 * Fixed-size particle pool: flat typed arrays, no per-frame allocation.
 * "Alive" isn't tracked separately — a particle that ages out, stalls, or
 * racks up too many coast strikes is immediately respawned at a
 * (weighted) random source, matching the spec's "dies ... then respawns at
 * a source" behaviour without variable-length bookkeeping.
 */
export class ParticleSystem {
  readonly count: number;
  x: Float32Array;
  y: Float32Array;
  px: Float32Array; // previous position, for segment drawing
  py: Float32Array;
  hx: Float32Array; // heading (unit-ish), carried across frames for steering continuity
  hy: Float32Array;
  age: Float32Array;
  maxAge: Float32Array;
  speed: Float32Array; // device px/sec, with per-particle jitter (pre-driftScale)
  sourceIndex: Int16Array;

  /** Consecutive coast-graze count since the last clean (non-clamped) frame. */
  strikes: Uint8Array;
  /** Seconds this particle has spent under STALL_DRIFT_SCALE, consecutively. */
  stallTime: Float32Array;
  /** Position at the start of the current trapped-check window (see TRAPPED_*). */
  checkpointX: Float32Array;
  checkpointY: Float32Array;
  /** Seconds since the trapped-check window last reset. */
  checkpointAge: Float32Array;
  /** Consecutive seconds this particle has sat over densityRecycleThreshold x the grid's mean — see DENSITY_RECYCLE_DURATION. */
  overDensityTime: Float32Array;

  // Step 2c persistent per-particle traits — see field.ts's ParticleTraits docs.
  chirality: Float32Array;
  lateralBias: Float32Array;
  noisePhase: Float32Array;

  // Step 3 (art pass) persistent per-particle traits: fixed-at-spawn
  // texture, not resampled per frame — see palette.ts's docs on why these
  // are quantized to a few buckets (-1, 0, 1) rather than continuous.
  /** Hue-jitter bucket, -1/0/1 — see palette.ts's HUE_JITTER_STEP_DEG. */
  hueBucket: Int8Array;
  /** Stroke-width-jitter bucket, -1/0/1 — see palette.ts's WEIGHT_JITTER_STEP. */
  weightBucket: Int8Array;

  /**
   * Reusable per-render-bucket index buffers, keyed by a small integer
   * combining (sourceIndex, hueBucket, weightBucket) — see render()'s
   * docs. Rebuilt (lengths reset, not reallocated) every frame rather
   * than allocated fresh, keeping rendering allocation-free like the rest
   * of this class.
   */
  private renderBuckets: number[][] = [];

  /** Total elapsed sim time, for the curl-noise field's time axis. */
  private time = 0;

  /**
   * Running total of coast-graze events (frames where a particle's segment
   * left the mask and got clamped+deflected rather than killed) across
   * this object's whole lifetime. Public and monotonic — the step2 plan
   * feedback's replacement for the old "escape rate" health metric, which
   * goes trivially to zero once grazes are rescued instead of killed and
   * so stops measuring anything. A rising strike rate (this, divided by
   * elapsed particle-seconds) is the new early warning that steering is
   * failing and the rescue is doing steering's job.
   */
  totalStrikeEvents = 0;

  /** 2g's occupancy grid — dynamic simulation state, rebuilt whenever the world (and so the mask's dimensions) changes. */
  densityField: DensityField;

  private cumulativeRates: number[] = [];
  private totalRate = 0;

  constructor(
    private world: World,
    count: number,
    private options: ParticleSystemOptions = {},
  ) {
    this.count = count;
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.hx = new Float32Array(count);
    this.hy = new Float32Array(count);
    this.age = new Float32Array(count);
    this.maxAge = new Float32Array(count);
    this.speed = new Float32Array(count);
    this.sourceIndex = new Int16Array(count);
    this.strikes = new Uint8Array(count);
    this.stallTime = new Float32Array(count);
    this.checkpointX = new Float32Array(count);
    this.checkpointY = new Float32Array(count);
    this.checkpointAge = new Float32Array(count);
    this.overDensityTime = new Float32Array(count);
    this.chirality = new Float32Array(count);
    this.lateralBias = new Float32Array(count);
    this.noisePhase = new Float32Array(count);
    this.hueBucket = new Int8Array(count);
    this.weightBucket = new Int8Array(count);
    this.densityField = buildDensityField(world.mask);

    this.buildRateTable();
    for (let i = 0; i < count; i++) {
      this.respawn(i);
      // Stagger initial ages so the field doesn't pulse as one wave of
      // particles ages out in lockstep.
      this.age[i] = Math.random() * this.maxAge[i];
    }
  }

  setWorld(world: World) {
    this.world = world;
    this.buildRateTable();
    // A resize changes the mask's dimensions, so the occupancy grid has to
    // be rebuilt at the new size — rebuilding (rather than resampling)
    // just means a brief cold start for the density signal, which decays
    // back to steady-state within a couple of DENSITY_RECYCLE_DURATIONs.
    this.densityField = buildDensityField(world.mask);
  }

  private buildRateTable() {
    this.cumulativeRates = [];
    let sum = 0;
    for (const resolved of this.world.sources) {
      sum += resolved.source.rate;
      this.cumulativeRates.push(sum);
    }
    this.totalRate = sum;
  }

  private pickSourceIndex(): number {
    const r = Math.random() * this.totalRate;
    for (let i = 0; i < this.cumulativeRates.length; i++) {
      if (r <= this.cumulativeRates[i]) return i;
    }
    return this.cumulativeRates.length - 1;
  }

  /**
   * The age-budget ceiling a newly spawned particle draws from. Dynamic
   * mode sizes it off this world's actual north-south extent, so a real
   * (if thin) tail of particles is physically capable of crossing GB —
   * step 1's fixed 4-9s ceiling meant *no* particle ever could, independent
   * of anything else about the field (step2 plan, point 1). Legacy mode
   * reproduces that fixed ceiling for harness A/B comparisons.
   */
  private ageBudgetRange(): { min: number; extra: number } {
    if (this.options.ageBudgetMode === 'legacy') {
      return { min: 4, extra: 5 }; // step 1's original range
    }
    const { top, bottom } = this.world.projection.bounds;
    const span = Math.max(1, bottom - top);
    const avgSpeed = 90; // midpoint of the speed jitter range drawn below
    // Coast steering + curl noise lengthen the actual path well beyond a
    // straight line north-south; 1.35x is a conservative pad, not measured.
    const curveFactor = 1.35;
    const crossingTime = (span * curveFactor) / avgSpeed;
    return { min: crossingTime * 0.5, extra: crossingTime * 0.9 };
  }

  private respawn(i: number) {
    const srcIdx = this.pickSourceIndex();
    const resolved = this.world.sources[srcIdx];
    // Small radius jitter so particles from one source don't all trace
    // the exact same line — source outflow proper is step 3.
    const jitterR = 4 * Math.sqrt(Math.random());
    const jitterA = Math.random() * Math.PI * 2;
    let sx = resolved.position[0] + Math.cos(jitterA) * jitterR;
    let sy = resolved.position[1] + Math.sin(jitterA) * jitterR;
    // resolved.position is guaranteed inside the mask (buildWorld either
    // found it naturally inside or walked it there with a snap buffer),
    // but an un-snapped source sitting close to a simplified coastline has
    // no guaranteed clearance — the jitter above could occasionally land
    // just outside. Falling back to the unjittered point keeps every
    // spawn point inside without exception, which the rescue logic below
    // depends on (it clamps back toward *last known inside*, and has
    // nothing to clamp back to if a particle starts its very first frame
    // already outside).
    if (!this.world.mask.isInside(sx, sy)) {
      sx = resolved.position[0];
      sy = resolved.position[1];
    }

    this.x[i] = sx;
    this.y[i] = sy;
    this.px[i] = sx;
    this.py[i] = sy;
    // Initial heading: mostly southward with a little spread.
    const angle = Math.PI / 2 + (Math.random() - 0.5) * 0.8; // canvas: +y is south
    this.hx[i] = Math.cos(angle);
    this.hy[i] = Math.sin(angle);
    this.age[i] = 0;
    const { min, extra } = this.ageBudgetRange();
    this.maxAge[i] = min + Math.random() * extra;
    this.speed[i] = 90 * (0.8 + Math.random() * 0.4);
    this.sourceIndex[i] = srcIdx;
    this.strikes[i] = 0;
    this.stallTime[i] = 0;
    this.checkpointX[i] = sx;
    this.checkpointY[i] = sy;
    this.checkpointAge[i] = 0;
    this.overDensityTime[i] = 0;
    this.chirality[i] = (Math.random() - 0.5) * CHIRALITY_MAGNITUDE;
    this.lateralBias[i] = (Math.random() - 0.5) * LATERAL_BIAS_MAGNITUDE;
    this.noisePhase[i] = Math.random() * 1000; // decorrelates the fine noise octave's time axis
    this.hueBucket[i] = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
    this.weightBucket[i] = Math.floor(Math.random() * 3) - 1;
  }

  step(dt: number, fieldParams: FieldParams = DEFAULT_FIELD_PARAMS) {
    const { world } = this;
    const { mask } = world;
    this.time += dt;
    // dt-aware ease: EASE_RATE_AT_60FPS is "per frame at 60fps"; converting
    // it to a continuous per-second rate means tuned values hold at any
    // frame rate, not just 60fps.
    const ease = 1 - Math.pow(1 - EASE_RATE_AT_60FPS, dt * 60);

    // 2g: decay + recompute the occupancy grid's gradient/mean once per
    // frame, from last frame's final deposits — not once per particle.
    // Every particle this frame reads the same settled snapshot (steering
    // below) and then deposits into it for *next* frame's snapshot, a
    // standard single-frame-lag scheme that keeps the field stable and the
    // per-particle cost at "one more array lookup".
    if (fieldParams.densityEnabled) {
      const decayFactor = Math.exp(-fieldParams.densityDecayRate * dt);
      this.densityField.decayAndUpdateGradient(decayFactor);
    }

    for (let i = 0; i < this.count; i++) {
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];

      const traits: ParticleTraits = {
        chirality: this.chirality[i],
        lateralBias: this.lateralBias[i],
        noisePhase: this.noisePhase[i],
      };
      const { vx: fx, vy: fy, driftScale } = sampleField(
        [this.x[i], this.y[i]],
        [this.hx[i], this.hy[i]],
        world,
        fieldParams,
        this.time,
        traits,
        undefined,
        fieldParams.densityEnabled ? this.densityField : null,
      );
      const len = Math.hypot(fx, fy) || 1;
      // Ease heading toward the field direction rather than snapping to
      // it, so trails curve instead of zigzagging between grid cells.
      const targetHx = fx / len;
      const targetHy = fy / len;
      this.hx[i] += (targetHx - this.hx[i]) * ease;
      this.hy[i] += (targetHy - this.hy[i]) * ease;
      const hLen = Math.hypot(this.hx[i], this.hy[i]) || 1;
      this.hx[i] /= hLen;
      this.hy[i] /= hLen;

      // Couple advection speed to the field's own southward decay. Without
      // this, particles never slow down anywhere — they'd travel at their
      // jittered speed[i] forever, which both contradicts the spec's
      // "slowing to a stop in the far south" death condition and turns a
      // raised age budget into coast-scraping instead of a gentle stop
      // (step2 plan feedback).
      const effectiveSpeed = this.speed[i] * driftScale;
      this.x[i] += this.hx[i] * effectiveSpeed * dt;
      this.y[i] += this.hy[i] * effectiveSpeed * dt;
      this.age[i] += dt;

      if (driftScale < STALL_DRIFT_SCALE) {
        this.stallTime[i] += dt;
      } else {
        this.stallTime[i] = 0;
      }

      // Check the whole travelled segment at ~1px resolution, not just
      // its endpoint. A single frame's travel is short (~1-2px), but
      // GB's coastline has pinch points (Solway Firth, the Clyde) at a
      // similar scale — the straight line render() draws between two
      // "inside" endpoints can still clip a thin outside notch between
      // them that a couple of fixed-fraction midpoints can straddle and
      // miss. Sampling once per pixel of segment length is what makes
      // the containment guarantee hold for the rendered line itself.
      const clamped = clampToMask(this.px[i], this.py[i], this.x[i], this.y[i], mask);
      if (clamped.left) {
        // 2a: rescue instead of kill. Clamp back to the last
        // confirmed-inside sample and slide the heading along the local
        // tangent (project out the normal component) rather than
        // reflecting — "glide, not scrape". Containment is exactly as
        // strict as before: the rendered segment's endpoints both test
        // inside, the same standard step 1 enforced by killing outright.
        const { gx, gy } = world.distanceField.sample(clamped.x, clamped.y);
        // Nudge a little further inside than the literal last-inside
        // sample, when that nudge itself still tests inside — see
        // CLAMP_NUDGE_PX's docs. Falls back to the un-nudged clamp point
        // (still a valid, inside point) if the nudge would overshoot past
        // a very thin spit of land.
        const nudgedX = clamped.x + gx * CLAMP_NUDGE_PX;
        const nudgedY = clamped.y + gy * CLAMP_NUDGE_PX;
        if (mask.isInside(nudgedX, nudgedY)) {
          this.x[i] = nudgedX;
          this.y[i] = nudgedY;
        } else {
          this.x[i] = clamped.x;
          this.y[i] = clamped.y;
        }
        const [thx, thy] = projectOntoTangent(this.hx[i], this.hy[i], gx, gy);
        this.hx[i] = thx;
        this.hy[i] = thy;
        this.strikes[i]++;
        this.totalStrikeEvents++;
        // this.x/this.y are Float32Array: the assignment above rounds the
        // float64 point we just validated with mask.isInside, and that
        // rounding can — rarely, only for a point sitting almost exactly
        // on a pixel boundary — tip it across into an outside pixel.
        // Re-validate against the *actual stored* value and recover if
        // storage rounding broke what we just proved.
        if (!mask.isInside(this.x[i], this.y[i])) {
          const recovered = findNearestInside(this.x[i], this.y[i], mask);
          if (recovered) {
            this.x[i] = recovered.x;
            this.y[i] = recovered.y;
          }
        }
      } else {
        this.strikes[i] = 0;
      }

      // Trapped check: a particle oscillating in a tight coastal pocket
      // can graze on and off forever without ever stringing together
      // STRIKE_LIMIT *consecutive* strikes. Checked on its own interval
      // (not every frame) so it's measuring net progress over a window,
      // not frame-to-frame jitter.
      let trapped = false;
      this.checkpointAge[i] += dt;
      if (this.checkpointAge[i] > TRAPPED_CHECK_INTERVAL) {
        const progressed = Math.hypot(
          this.x[i] - this.checkpointX[i],
          this.y[i] - this.checkpointY[i],
        );
        if (progressed < TRAPPED_MIN_DISPLACEMENT) {
          trapped = true;
        } else {
          this.checkpointX[i] = this.x[i];
          this.checkpointY[i] = this.y[i];
        }
        this.checkpointAge[i] = 0;
      }

      // 2g: deposit at this frame's final (post-move, post-rescue)
      // position, and track how long this particle has sat somewhere
      // over-dense — "recycling for coverage". Deposit happens
      // unconditionally when the mechanism is on (even a particle about
      // to be force-respawned below should still register where it *was*
      // crowding); the recycle check reads the density this frame's
      // deposit doesn't affect until next frame's decayAndUpdateGradient,
      // so it can't immediately re-trigger itself.
      let overDensity = false;
      if (fieldParams.densityEnabled) {
        this.densityField.deposit(this.x[i], this.y[i], fieldParams.densityDepositRate * dt);
        const { density } = this.densityField.sample(this.x[i], this.y[i]);
        const mean = this.densityField.meanInteriorDensity;
        // Guard against the cold-start window (mean still ~0, nothing
        // deposited yet) reading every first-touched cell as infinitely
        // over its target.
        if (mean > 1e-6 && density > mean * fieldParams.densityRecycleThreshold) {
          this.overDensityTime[i] += dt;
        } else {
          this.overDensityTime[i] = 0;
        }
        if (this.overDensityTime[i] > DENSITY_RECYCLE_DURATION) overDensity = true;
      }

      // Order matters only for reporting which cause "wins" when several
      // thresholds are crossed in the same frame — containment and the
      // respawn itself don't depend on it.
      let cause: DeathCause | null = null;
      if (this.age[i] > this.maxAge[i]) cause = 'age';
      else if (this.strikes[i] > STRIKE_LIMIT) cause = 'strike';
      else if (this.stallTime[i] > STALL_DURATION) cause = 'stall';
      else if (trapped) cause = 'trapped';
      else if (overDensity) cause = 'density';

      if (cause) {
        this.options.onDeath?.(i, cause, this.age[i]);
        this.respawn(i);
      }
    }
  }

  /**
   * Draws every particle's previous->current segment, batched by render
   * bucket (source x hueBucket x weightBucket) rather than one draw call
   * per particle — the spec's "per-source colour channel" and "per-
   * particle jitter in weight ... and hue" (Flow_Experiment_Spec.md,
   * "Trails and particles") both need per-particle style variation, but
   * Canvas 2D only takes one strokeStyle/lineWidth per stroke() call, and
   * thousands of individual stroke() calls a frame would blow the 60fps
   * budget. Bucketing keeps it at (sources x 9) draw calls — a few dozen
   * — with every particle still getting exactly one segment draw, matching
   * the spec's "one segment draw per particle" performance target.
   *
   * `renderBuckets` is reused frame to frame (lengths reset, not the
   * arrays reallocated) so this stays allocation-free like `step()`.
   */
  render(ctx: CanvasRenderingContext2D, palette: Palette) {
    const numSources = this.world.sources.length;
    const numBuckets = numSources * 9; // 3 hueBuckets x 3 weightBuckets, offset -1..1 each
    if (this.renderBuckets.length !== numBuckets) {
      this.renderBuckets = Array.from({ length: numBuckets }, () => []);
    } else {
      for (const bucket of this.renderBuckets) bucket.length = 0;
    }

    for (let i = 0; i < this.count; i++) {
      const bucketIndex =
        this.sourceIndex[i] * 9 + (this.hueBucket[i] + 1) * 3 + (this.weightBucket[i] + 1);
      this.renderBuckets[bucketIndex].push(i);
    }

    ctx.lineCap = 'round';
    for (let b = 0; b < numBuckets; b++) {
      const indices = this.renderBuckets[b];
      if (indices.length === 0) continue;
      const sourceIdx = Math.floor(b / 9);
      const hueBucket = Math.floor((b % 9) / 3) - 1;
      const weightBucket = (b % 3) - 1;
      const channel = this.world.sources[sourceIdx]?.source.palette;
      ctx.strokeStyle = resolveStrokeColor(palette, channel, hueBucket);
      ctx.lineWidth = resolveStrokeWidth(palette, weightBucket);
      ctx.beginPath();
      for (const i of indices) {
        // A particle that just respawned this frame has px/py reset equal
        // to x/y (see respawn()), so this degenerates to a zero-length
        // segment rather than a streak from its old death point.
        ctx.moveTo(this.px[i], this.py[i]);
        ctx.lineTo(this.x[i], this.y[i]);
      }
      ctx.stroke();
    }
  }
}
