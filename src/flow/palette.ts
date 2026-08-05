/**
 * Step 3 (art pass): dark/light palettes, tuned against the two reference
 * images named in the spec. Colour figures below aren't eyeballed — sampled
 * directly from the reference files (see the numbers in each palette's
 * comment) so the match is measured, not guessed.
 *
 * Both palettes drive the exact same mechanics (Flow_Experiment_Spec.md:
 * "works identically in both palettes because the wash colour is just the
 * current background"). The one deliberate mechanical difference is wash
 * alpha: the step2 plan's own resolution of the dash-vs-comet question —
 * lifespan (simulation) and dash length (render) are decoupled by the
 * fade-trail technique, so `Digital Art.jpg`'s short-dash tapestry and
 * `Art Pin.gif`'s long comet trails are the *same* particle motion under
 * different wash alpha, not a simulation-level fork.
 */
export type PaletteName = 'dark' | 'light';

export interface Palette {
  name: PaletteName;
  /** "r, g, b" component string — matches the wash-rect rgba(...) convention used throughout main.ts. */
  backgroundRGB: string;
  /** Trail fade rate per frame. Low = long comet trails (dark/Art Pin.gif); high = short, near-solid dashes (light/Digital Art.jpg). */
  washAlpha: number;
  /** Base stroke width, device px, before per-particle weight jitter (see palette's weightBucket use in particles.ts). */
  baseStrokeWidth: number;
  /** Base stroke alpha. */
  baseStrokeAlpha: number;
  /** HSL hue (0-360) at the centre of this palette's stroke colour. */
  baseHue: number;
  /** HSL saturation %. Kept modest even in the "neutral" dark palette — at 0% saturation, per-source and per-particle hue jitter would be invisible; a small nonzero baseline is what gives them something to rotate. */
  saturation: number;
  /** HSL lightness %. */
  lightness: number;
}

// Sampled from reference/Art Pin.gif (interior, avoiding edge/dither
// pixels): background ~(51,51,51) — GIF dithering lightens true black, so
// taken down toward the spec's literal "near-black" rather than matched
// exactly. Trail pixels averaged to (129,129,129), i.e. hue/saturation
// ~0 — genuinely neutral, not blue-tinted, contrary to a first guess.
export const DARK_PALETTE: Palette = {
  name: 'dark',
  backgroundRGB: '8, 8, 10',
  washAlpha: 0.07,
  baseStrokeWidth: 1.1,
  baseStrokeAlpha: 0.62,
  baseHue: 205,
  saturation: 25,
  lightness: 88,
};

// Sampled from reference/Digital Art.jpg: background (233,229,220) ->
// HSL(42, 23%, 89%); most-saturated stroke pixel found (8,87,205) ->
// HSL(216, 92%, 42%).
// 2j retune: washAlpha 0.32 -> 0.16. At 0.32 (step 3's figure, tuned
// against a 3000-particle default) the equilibrium tapestry read as
// scattered dots rather than Digital Art.jpg's dense, bold dash weave —
// two changes since compound against it: 2g's default particle count
// dropped to 1400 (less raw ink available at any instant), and washAlpha
// alone sets how many frames' worth of "ink" stays visible before the
// wash erases it. Per the step2 feedback this resolves through, dash
// length is purely this wash knob, not a simulation change — lower
// washAlpha keeps more recent segments visible at once, both lengthening
// individual dashes and increasing how many overlap, which is what
// "denser tapestry" actually means for a fade-trail renderer. Stayed
// comfortably above the dark palette's 0.07 (which reads as long comet
// trails) — the light palette should still read as dashes, just longer
// and more numerous ones than 0.32 gave.
export const LIGHT_PALETTE: Palette = {
  name: 'light',
  backgroundRGB: '233, 229, 220',
  washAlpha: 0.13,
  baseStrokeWidth: 2.2,
  baseStrokeAlpha: 0.9,
  baseHue: 216,
  saturation: 85,
  lightness: 42,
};

export const PALETTES: Record<PaletteName, Palette> = { dark: DARK_PALETTE, light: LIGHT_PALETTE };

/**
 * Small per-source hue offset (degrees), keyed by sources.ts's `palette`
 * channel letter. Deliberately subtle — both references read as one hue
 * family, not a rainbow — but real: each of the seven sources is visually
 * distinguishable, which is what the scalability contract needs later
 * ("England's generation mix -> more sources with different type and
 * palette" — a per-source colour channel that does nothing yet would have
 * to be retrofitted then).
 */
const SOURCE_HUE_OFFSET: Record<string, number> = {
  a: -12,
  b: -8,
  c: -4,
  d: 0,
  e: 4,
  f: 8,
  g: 12,
};

/** Degrees per per-particle hue-jitter bucket step (bucket values are -1, 0, 1 — see particles.ts). */
export const HUE_JITTER_STEP_DEG = 6;
/** Fractional stroke-width change per per-particle weight-jitter bucket step (-1, 0, 1). */
export const WEIGHT_JITTER_STEP = 0.3;

/** Resolve a particle's actual stroke colour from its palette, source channel, and hue-jitter bucket. */
export function resolveStrokeColor(
  palette: Palette,
  sourceChannel: string | undefined,
  hueBucket: number,
): string {
  const sourceOffset = sourceChannel !== undefined ? (SOURCE_HUE_OFFSET[sourceChannel] ?? 0) : 0;
  const hue = palette.baseHue + sourceOffset + hueBucket * HUE_JITTER_STEP_DEG;
  return `hsla(${hue}, ${palette.saturation}%, ${palette.lightness}%, ${palette.baseStrokeAlpha})`;
}

/** Resolve a particle's actual stroke width from its palette and weight-jitter bucket. */
export function resolveStrokeWidth(palette: Palette, weightBucket: number): number {
  return palette.baseStrokeWidth * (1 + weightBucket * WEIGHT_JITTER_STEP);
}
