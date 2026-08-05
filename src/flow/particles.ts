import { DEFAULT_FIELD_PARAMS, sampleField, type FieldParams } from './field';
import type { RasterMask } from './mask';
import type { World } from './world';

/**
 * True if any point along the segment (x0,y0)-(x1,y1), sampled at ~1
 * device-px resolution, falls outside the mask. Exported so the
 * containment verification check can hold the exact same rendered-line
 * standard the runtime enforces, rather than a looser approximation of it.
 */
export function segmentLeavesMask(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mask: RasterMask,
): boolean {
  // 2 samples/px: a diagonal coastline is a pixel staircase, and a
  // segment crossing it at a shallow angle can graze a step between
  // once-per-px samples even when both endpoints test inside.
  const length = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(2, Math.ceil(length * 2));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    if (!mask.isInside(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return true;
  }
  return false;
}

/**
 * Fixed-size particle pool: flat typed arrays, no per-frame allocation.
 * "Alive" isn't tracked separately — a particle that ages out or leaves
 * the mask is immediately respawned at a (weighted) random source, which
 * matches the spec's "dies ... then respawns at a source" behaviour
 * without variable-length bookkeeping.
 *
 * Step 1 scope: age-out and mask-exit only. "Slowing to a stop in the far
 * south" (the third death condition in the spec) is a step 2/3 nuance once
 * the field actually decelerates particles that far south.
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
  speed: Float32Array; // device px/sec, with per-particle jitter
  sourceIndex: Int16Array;

  private cumulativeRates: number[] = [];
  private totalRate = 0;

  constructor(
    private world: World,
    count: number,
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

  private respawn(i: number) {
    const srcIdx = this.pickSourceIndex();
    const resolved = this.world.sources[srcIdx];
    // Small radius jitter so particles from one source don't all trace
    // the exact same line — source outflow proper is step 3.
    const jitterR = 4 * Math.sqrt(Math.random());
    const jitterA = Math.random() * Math.PI * 2;
    const sx = resolved.position[0] + Math.cos(jitterA) * jitterR;
    const sy = resolved.position[1] + Math.sin(jitterA) * jitterR;

    this.x[i] = sx;
    this.y[i] = sy;
    this.px[i] = sx;
    this.py[i] = sy;
    // Initial heading: mostly southward with a little spread.
    const angle = Math.PI / 2 + (Math.random() - 0.5) * 0.8; // canvas: +y is south
    this.hx[i] = Math.cos(angle);
    this.hy[i] = Math.sin(angle);
    this.age[i] = 0;
    this.maxAge[i] = 4 + Math.random() * 5; // seconds
    this.speed[i] = 90 * (0.8 + Math.random() * 0.4);
    this.sourceIndex[i] = srcIdx;
  }

  step(dt: number, fieldParams: FieldParams = DEFAULT_FIELD_PARAMS) {
    const { world } = this;
    const { mask } = world;

    for (let i = 0; i < this.count; i++) {
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];

      const [fx, fy] = sampleField([this.x[i], this.y[i]], [this.hx[i], this.hy[i]], world, fieldParams);
      const len = Math.hypot(fx, fy) || 1;
      // Ease heading toward the field direction rather than snapping to
      // it, so trails curve instead of zigzagging between grid cells.
      const targetHx = fx / len;
      const targetHy = fy / len;
      const ease = 0.25;
      this.hx[i] += (targetHx - this.hx[i]) * ease;
      this.hy[i] += (targetHy - this.hy[i]) * ease;
      const hLen = Math.hypot(this.hx[i], this.hy[i]) || 1;
      this.hx[i] /= hLen;
      this.hy[i] /= hLen;

      this.x[i] += this.hx[i] * this.speed[i] * dt;
      this.y[i] += this.hy[i] * this.speed[i] * dt;
      this.age[i] += dt;

      // Check the whole travelled segment at ~1px resolution, not just
      // its endpoint. A single frame's travel is short (~1-2px), but
      // GB's coastline has pinch points (Solway Firth, the Clyde) at a
      // similar scale — the straight line render() draws between two
      // "inside" endpoints can still clip a thin outside notch between
      // them that a couple of fixed-fraction midpoints can straddle and
      // miss. Sampling once per pixel of segment length is what makes
      // the containment guarantee hold for the rendered line itself.
      const outside = segmentLeavesMask(
        this.px[i],
        this.py[i],
        this.x[i],
        this.y[i],
        mask,
      );

      const dead = this.age[i] > this.maxAge[i] || outside;
      if (dead) {
        this.respawn(i);
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, strokeStyle: string, lineWidth: number) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < this.count; i++) {
      // A particle that just respawned this frame has px/py reset equal
      // to x/y (see respawn()), so this degenerates to a zero-length
      // segment rather than a streak from its old death point.
      ctx.moveTo(this.px[i], this.py[i]);
      ctx.lineTo(this.x[i], this.y[i]);
    }
    ctx.stroke();
  }
}
