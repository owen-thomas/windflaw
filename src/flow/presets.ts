/**
 * Step 4: preset save/load, per the spec's "preset save/load as JSON
 * (export to clipboard/file is enough)" and "ship two presets: 'calm' and
 * 'windy Scotland surplus'" (Flow_Experiment_Spec.md, "Control panel").
 *
 * A preset is a full, self-contained snapshot — not a diff against
 * defaults — so round-tripping through JSON (export, hand-edit, re-import)
 * never depends on what DEFAULT_FIELD_PARAMS happens to be at import time.
 * The two shipped presets are still *written* as overrides on top of
 * DEFAULT_FIELD_PARAMS/DEFAULT_PARTICLE_STYLE in source, purely so their
 * diffs from default are legible in a review — `snapshotPreset` below,
 * which is what "Copy current as JSON" actually calls, always produces a
 * flat, fully-specified object either way.
 *
 * Per-source rates are keyed by `Source.id` (e.g. "edinbane"), not array
 * index/position — stable across reordering or future additions to
 * sources.ts, per the scalability contract (Flow_Experiment_Spec.md:
 * "England's generation mix -> more sources with different type").
 */
import { DEFAULT_FIELD_PARAMS, type FieldParams } from './field';
import { DEFAULT_PARTICLE_STYLE, type ParticleStyle } from './particles';
import type { PaletteName } from './palette';
import type { FlowControlContext } from './controls';

export interface FlowPreset {
  name: string;
  description: string;
  field: FieldParams;
  particleCount: number;
  speedMultiplier: number;
  strokeWeightMultiplier: number;
  style: ParticleStyle;
  /** Trail length — the palette's washAlpha, overridden independently of paletteName. */
  washAlpha: number;
  paletteName: PaletteName;
  seed: number;
  /** Keyed by Source.id — see this file's own docs on why. */
  sourceRates: Record<string, number>;
}

/** Read the live state referenced by `ctx` into a full, JSON-serializable preset. */
export function snapshotPreset(ctx: FlowControlContext, name = 'custom', description = ''): FlowPreset {
  return {
    name,
    description,
    field: { ...ctx.fieldParams },
    particleCount: ctx.getParticleCount(),
    speedMultiplier: ctx.getSpeedMultiplier(),
    strokeWeightMultiplier: ctx.getStrokeWeightMultiplier(),
    style: { ...ctx.particleStyle },
    washAlpha: ctx.getWashAlpha(),
    paletteName: ctx.getPaletteName(),
    seed: ctx.getSeed(),
    sourceRates: ctx.getSourceRates(),
  };
}

/**
 * Apply a full preset onto the live state referenced by `ctx`. Palette is
 * switched *before* washAlpha is applied — `setPaletteName` clones fresh
 * defaults from PALETTES (see main.ts's own docs), which would otherwise
 * stomp a preset's deliberately-overridden washAlpha if applied first.
 */
export function applyPreset(preset: FlowPreset, ctx: FlowControlContext): void {
  Object.assign(ctx.fieldParams, preset.field);
  Object.assign(ctx.particleStyle, preset.style);
  ctx.setParticleCount(preset.particleCount);
  ctx.setSpeedMultiplier(preset.speedMultiplier);
  ctx.setStrokeWeightMultiplier(preset.strokeWeightMultiplier);
  ctx.setPaletteName(preset.paletteName);
  ctx.setWashAlpha(preset.washAlpha);
  ctx.setSeed(preset.seed);
  ctx.setSourceRates(preset.sourceRates);
}

export const CALM_PRESET: FlowPreset = {
  name: 'calm',
  description:
    'Low, even output everywhere — a quiet system with no surplus anywhere in particular. Gentle motion, light density pressure, longer trails, less per-particle texture.',
  field: {
    ...DEFAULT_FIELD_PARAMS,
    driftStrength: 50,
    noiseWeight: 0.25,
    densityWeight: 0.5,
    spacingWaveAmplitude: 0.2,
  },
  particleCount: 900,
  speedMultiplier: 0.75,
  strokeWeightMultiplier: 1,
  style: { ...DEFAULT_PARTICLE_STYLE, jitterAmount: 0.7 },
  washAlpha: 0.05,
  paletteName: 'dark',
  seed: 1337,
  sourceRates: {
    edinbane: 6,
    seagreen: 6,
    cumberhead: 6,
    hagshawhill: 6,
    northkyle: 6,
    clyde: 6,
    whitelee: 6,
  },
};

/**
 * "North sources high, southern drift damped" (Flow_Experiment_Spec.md,
 * "Control panel"), read literally: the surplus is generated in the north
 * — Edinbane and Seagreen are the two genuinely northern sources (see
 * their lat values in sources.ts; the other five cluster in the central
 * belt near the border) — and doesn't get absorbed by demand further
 * south, so it pools/lingers rather than draining away. That means
 * *raising* driftFalloff (drift weakens faster heading south), not
 * lowering it: a lower driftFalloff means stronger southward reach, which
 * would read as the surplus being efficiently absorbed — the opposite of
 * a surplus that isn't finding demand. (An earlier draft of this preset
 * had the lever backwards; corrected on review.)
 */
export const WINDY_SCOTLAND_SURPLUS_PRESET: FlowPreset = {
  name: 'windy Scotland surplus',
  description:
    'North sources (Edinbane, Seagreen) running hot, the central-belt sources damped, and driftFalloff raised so the surplus pools in the north rather than draining south — previewing how live "surplus wind in Scotland" data will read.',
  field: {
    ...DEFAULT_FIELD_PARAMS,
    driftFalloff: 0.85,
    densityWeight: 1.3,
    densityTargetMultiplier: 0.3,
  },
  particleCount: 1800,
  speedMultiplier: 1,
  strokeWeightMultiplier: 1.1,
  style: { ...DEFAULT_PARTICLE_STYLE },
  washAlpha: 0.09,
  paletteName: 'dark',
  seed: 1337,
  sourceRates: {
    edinbane: 30,
    seagreen: 26,
    cumberhead: 6,
    hagshawhill: 6,
    northkyle: 6,
    clyde: 6,
    whitelee: 6,
  },
};

export const PRESETS: FlowPreset[] = [CALM_PRESET, WINDY_SCOTLAND_SURPLUS_PRESET];
