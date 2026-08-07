/**
 * Step 4: the control panel (Flow_Experiment_Spec.md, "Control panel").
 * Hidden by default, toggled with `h` — see main.ts's keydown handler.
 * Hand-rolled DOM (a fixed-position overlay), not canvas-drawn or a UI
 * library: this repo's own convention is vanilla TS with no rendering/UI
 * dependencies, and real `<input type="range">` elements are simply
 * cheaper than reimplementing sliders on canvas.
 *
 * This file never touches simulation code directly — everything it does
 * goes through `FlowControlContext`, which main.ts implements against its
 * own live state (fieldParams, the ParticleSystem, the palette). That
 * keeps this file ignorant of *how* e.g. a particle-count change is
 * applied (main.ts's setParticleCount rebuilds just the ParticleSystem,
 * not the whole world) — only that it can ask for it.
 */
import type { FieldParams } from './field';
import type { ParticleStyle } from './particles';
import type { PaletteName } from './palette';
import { SOURCES } from './sources';
import { PRESETS, applyPreset, snapshotPreset, type FlowPreset } from './presets';

/**
 * Everything the panel needs to read and mutate live simulation state.
 * `fieldParams` and `particleStyle` are live objects the panel mutates in
 * place — the same "no setters" convention main.ts already uses for
 * `fieldParams` (see its own docs: a mutable clone of DEFAULT_FIELD_PARAMS
 * that sampleField reads fresh every frame). Everything else needs a side
 * effect beyond storing a number (a ParticleSystem rebuild, a rate-table
 * refresh, a palette clone, a noise reseed), so those are get/set pairs
 * instead.
 */
export interface FlowControlContext {
  fieldParams: FieldParams;
  particleStyle: ParticleStyle;
  getParticleCount(): number;
  setParticleCount(n: number): void;
  getSpeedMultiplier(): number;
  setSpeedMultiplier(n: number): void;
  getStrokeWeightMultiplier(): number;
  setStrokeWeightMultiplier(n: number): void;
  getWashAlpha(): number;
  setWashAlpha(n: number): void;
  getPaletteName(): PaletteName;
  setPaletteName(name: PaletteName): void;
  getSeed(): number;
  setSeed(seed: number): void;
  /** Keyed by Source.id — see presets.ts's own docs on why. */
  getSourceRates(): Record<string, number>;
  setSourceRates(rates: Record<string, number>): void;
}

/** FieldParams keys that are plain numeric sliders — the three enum/boolean knobs are handled separately below. */
type NumericFieldKey = Exclude<keyof FieldParams, 'baseFieldMode' | 'noiseMode' | 'densityEnabled'>;

interface FieldSliderSpec {
  key: NumericFieldKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

type FieldEnumSpec =
  | { key: 'baseFieldMode'; label: string; kind: 'select'; options: Array<FieldParams['baseFieldMode']> }
  | { key: 'noiseMode'; label: string; kind: 'select'; options: Array<FieldParams['noiseMode']> }
  | { key: 'densityEnabled'; label: string; kind: 'checkbox' };

interface FieldGroup {
  title: string;
  note?: string;
  sliders: FieldSliderSpec[];
  enums?: FieldEnumSpec[];
}

// Grouped to match field.ts's own `sampleField` comment sections, so the
// panel's structure and the code doing the work read the same way.
const FIELD_GROUPS: FieldGroup[] = [
  {
    title: 'Drift & path',
    note:
      '"Path weight" also stands in for the spec\'s "source outflow strength" — the small-radius bloom the spec named was superseded by 2f\'s whole-domain divergent field (see field.ts\'s baseFieldMode docs). The surviving "source outflow radius" knob is the spawn-spread slider under Particles below.',
    sliders: [
      { key: 'driftStrength', label: 'Drift strength', min: 0, max: 200, step: 5 },
      { key: 'driftFalloff', label: 'Drift falloff (south)', min: 0, max: 1, step: 0.01 },
      { key: 'driftSpread', label: 'Drift spread (east-west fan)', min: 0, max: 1.5, step: 0.01 },
      { key: 'pathWeight', label: 'Path weight (source outflow strength)', min: 0, max: 1, step: 0.01 },
    ],
    enums: [{ key: 'baseFieldMode', label: 'Base field', kind: 'select', options: ['divergent', 'south'] }],
  },
  {
    title: 'Centering',
    sliders: [
      { key: 'centerWeight', label: 'Center pull', min: 0, max: 0.5, step: 0.005 },
      { key: 'centerSouthFalloffExponent', label: 'Center falloff exponent', min: 0.5, max: 6, step: 0.1 },
    ],
  },
  {
    title: 'Noise & waves',
    sliders: [
      { key: 'noiseScale', label: 'Noise scale (cycles across GB)', min: 0.5, max: 10, step: 0.1 },
      { key: 'noiseSpeed', label: 'Noise speed', min: 0, max: 0.3, step: 0.005 },
      { key: 'noiseWeight', label: 'Noise weight', min: 0, max: 1.5, step: 0.01 },
      { key: 'spacingWaveAmplitude', label: 'Spacing wave amplitude', min: 0, max: 1, step: 0.01 },
    ],
    enums: [{ key: 'noiseMode', label: 'Noise mode', kind: 'select', options: ['transverse', 'isotropicCurl'] }],
  },
  {
    title: 'Density & spacing',
    sliders: [
      { key: 'densityWeight', label: 'Density weight', min: 0, max: 3, step: 0.05 },
      { key: 'densityTargetMultiplier', label: 'Density target multiplier', min: 0.1, max: 2, step: 0.01 },
      { key: 'densityMaxPush', label: 'Density max push', min: 0, max: 150, step: 5 },
      { key: 'densityDecayRate', label: 'Density decay rate', min: 0.1, max: 3, step: 0.05 },
      { key: 'densityDepositRate', label: 'Density deposit rate', min: 0, max: 5, step: 0.1 },
      { key: 'densityRecycleThreshold', label: 'Density recycle threshold', min: 1, max: 20, step: 0.5 },
    ],
    enums: [{ key: 'densityEnabled', label: 'Density steering on', kind: 'checkbox' }],
  },
  {
    title: 'Coast',
    sliders: [
      { key: 'steerThreshold', label: 'Steer (rescue) threshold', min: 0, max: 60, step: 1 },
      { key: 'steerWeight', label: 'Steer weight', min: 0, max: 1.5, step: 0.01 },
      { key: 'pushWeight', label: 'Push weight', min: 0, max: 1.5, step: 0.01 },
      { key: 'conformThreshold', label: 'Conform threshold', min: 0, max: 150, step: 1 },
      { key: 'conformWeight', label: 'Conform weight', min: 0, max: 1, step: 0.01 },
    ],
  },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  return node;
}

function labeledRow(labelText: string, control: HTMLElement): HTMLElement {
  const row = el('div', { className: 'flow-panel-row' });
  row.append(el('label', { textContent: labelText }), control);
  return row;
}

const PANEL_STYLES = `
.flow-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 340px;
  max-width: 90vw;
  height: 100vh;
  overflow-y: auto;
  background: rgba(10, 10, 14, 0.88);
  color: #e8e8ec;
  font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  padding: 12px 14px 40px;
  box-sizing: border-box;
  z-index: 1000;
  backdrop-filter: blur(6px);
}
.flow-panel h2 { font-size: 13px; margin: 18px 0 6px; opacity: 0.85; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 3px; }
.flow-panel h2:first-child { margin-top: 0; }
.flow-panel p.flow-panel-note, .flow-panel p.flow-panel-hint { opacity: 0.6; font-size: 10.5px; margin: 2px 0 8px; }
.flow-panel-row { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
.flow-panel-row label { flex: 0 0 150px; min-width: 0; opacity: 0.85; }
.flow-panel-control { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
/* A range input's default min-width:auto floors it at its intrinsic
   (~180px) width, which is wider than this panel's available flex space —
   without min-width:0 the row can't shrink to fit and the value readout
   gets pushed past the panel's right edge (clipped, not just wrapped,
   since the panel scrolls vertically only). */
.flow-panel-control input[type="range"] { flex: 1; min-width: 0; }
.flow-panel-value { flex: 0 0 44px; text-align: right; opacity: 0.7; font-variant-numeric: tabular-nums; }
.flow-panel select, .flow-panel textarea, .flow-panel input[type="number"] {
  background: rgba(255,255,255,0.08); color: inherit; border: 1px solid rgba(255,255,255,0.2); border-radius: 3px; padding: 2px 4px;
}
/* Browsers give type="number" a wide default intrinsic width (~170px) —
   the seed row (label + this + the Reseed button) overflows the panel
   without an explicit cap. */
.flow-panel input[type="number"] { width: 70px; }
.flow-panel button {
  background: rgba(255,255,255,0.12); color: inherit; border: 1px solid rgba(255,255,255,0.25); border-radius: 3px;
  padding: 4px 8px; cursor: pointer; font-size: 11px;
}
.flow-panel button:hover { background: rgba(255,255,255,0.22); }
.flow-panel textarea { width: 100%; height: 70px; font: 10px/1.3 monospace; box-sizing: border-box; margin: 4px 0; }
`;

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  document.head.append(el('style', { textContent: PANEL_STYLES }));
  stylesInjected = true;
}

export interface ControlPanel {
  setVisible(visible: boolean): void;
  toggle(): void;
  /**
   * Re-sync every control's displayed value from `ctx` without changing
   * visibility. Needed whenever state changes from *outside* the panel —
   * main.ts's non-panel keyboard toggles ('p' for palette, 'f'/'g'/'n'/'c'
   * for the fan-out A/B flags) mutate the same live objects the panel
   * reads, and a hidden panel skips this on hide/show, so a stale display
   * would otherwise sit there until the next preset load.
   */
  refresh(): void;
}

/** Build the (initially hidden) control panel and append it to the document. Call once at boot. */
export function createControlPanel(ctx: FlowControlContext): ControlPanel {
  ensureStyles();
  const root = el('div', { className: 'flow-panel' });
  root.style.display = 'none';
  // Every bound control registers a `sync` fn here, called on preset
  // load/apply and on panel show — the only way a slider set by *code*
  // (rather than the user dragging it) gets its displayed value updated.
  const refreshers: Array<() => void> = [];

  function section(title: string, note?: string) {
    root.append(el('h2', { textContent: title }));
    if (note) root.append(el('p', { className: 'flow-panel-note', textContent: note }));
  }

  function addSlider(
    label: string,
    spec: { min: number; max: number; step: number },
    get: () => number,
    set: (n: number) => void,
  ) {
    const input = el('input', { type: 'range' }) as HTMLInputElement;
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    const readout = el('span', { className: 'flow-panel-value' });
    const sync = () => {
      const v = get();
      input.value = String(v);
      readout.textContent = Number.isInteger(v) ? String(v) : v.toFixed(3);
    };
    sync();
    input.addEventListener('input', () => {
      set(Number(input.value));
      sync();
    });
    refreshers.push(sync);
    const wrap = el('div', { className: 'flow-panel-control' });
    wrap.append(input, readout);
    root.append(labeledRow(label, wrap));
  }

  function addCheckbox(label: string, get: () => boolean, set: (v: boolean) => void) {
    const input = el('input', { type: 'checkbox' }) as HTMLInputElement;
    const sync = () => {
      input.checked = get();
    };
    sync();
    input.addEventListener('change', () => set(input.checked));
    refreshers.push(sync);
    root.append(labeledRow(label, input));
  }

  function addSelect<T extends string>(label: string, options: readonly T[], get: () => T, set: (v: T) => void) {
    const select = el('select') as HTMLSelectElement;
    for (const opt of options) select.append(el('option', { value: opt, textContent: opt }));
    const sync = () => {
      select.value = get();
    };
    sync();
    select.addEventListener('change', () => set(select.value as T));
    refreshers.push(sync);
    root.append(labeledRow(label, select));
  }

  function refreshAll() {
    for (const sync of refreshers) sync();
  }

  root.append(el('h2', { textContent: 'Flow — controls (h to hide)' }));

  // --- Particles ----------------------------------------------------------
  section('Particles');
  addSlider('Particle count', { min: 200, max: 8000, step: 100 }, ctx.getParticleCount, ctx.setParticleCount);
  addSlider('Global speed', { min: 0.25, max: 2, step: 0.05 }, ctx.getSpeedMultiplier, ctx.setSpeedMultiplier);
  addSlider('Trail length (wash alpha)', { min: 0.02, max: 0.5, step: 0.005 }, ctx.getWashAlpha, ctx.setWashAlpha);
  addSlider(
    'Stroke weight',
    { min: 0.3, max: 3, step: 0.05 },
    ctx.getStrokeWeightMultiplier,
    ctx.setStrokeWeightMultiplier,
  );
  addSlider(
    'Jitter amount',
    { min: 0, max: 2, step: 0.05 },
    () => ctx.particleStyle.jitterAmount,
    (n) => {
      ctx.particleStyle.jitterAmount = n;
    },
  );
  addSlider(
    'Spawn spread (px) — "source outflow radius"',
    { min: 0, max: 20, step: 1 },
    () => ctx.particleStyle.spawnJitterRadius,
    (n) => {
      ctx.particleStyle.spawnJitterRadius = n;
    },
  );

  // --- Field weights --------------------------------------------------------
  for (const group of FIELD_GROUPS) {
    section(group.title, group.note);
    for (const spec of group.sliders) {
      addSlider(
        spec.label,
        spec,
        () => ctx.fieldParams[spec.key],
        (n) => {
          ctx.fieldParams[spec.key] = n;
        },
      );
    }
    for (const e of group.enums ?? []) {
      if (e.kind === 'checkbox') {
        addCheckbox(
          e.label,
          () => ctx.fieldParams[e.key],
          (v) => {
            ctx.fieldParams[e.key] = v;
          },
        );
      } else {
        // A <select>'s value is an arbitrary string at the type level, so
        // the narrowed union `FieldParams[e.key]` can't accept `v`
        // directly here even though `addSelect`'s own options/get/set
        // triple keeps it consistent at runtime — see addSelect's `<T>`.
        addSelect(
          e.label,
          e.options,
          () => ctx.fieldParams[e.key],
          (v) => {
            (ctx.fieldParams as unknown as Record<string, string>)[e.key] = v;
          },
        );
      }
    }
  }

  // --- Per-source emission rates --------------------------------------------
  section('Source emission rates');
  for (const source of SOURCES) {
    addSlider(
      source.name,
      { min: 0, max: 60, step: 1 },
      () => ctx.getSourceRates()[source.id] ?? 0,
      (n) => {
        const rates = ctx.getSourceRates();
        rates[source.id] = n;
        ctx.setSourceRates(rates);
      },
    );
  }

  // --- Palette & seed --------------------------------------------------------
  section('Palette & seed');
  const darkBtn = el('button', { textContent: 'Dark' });
  const lightBtn = el('button', { textContent: 'Light' });
  // No refreshAll() here — setPaletteName (main.ts's setPalette) triggers
  // the panel refresh itself now, so every caller (this button, the 'p'
  // keyboard toggle, a preset load) stays in sync the same way.
  darkBtn.addEventListener('click', () => ctx.setPaletteName('dark'));
  lightBtn.addEventListener('click', () => ctx.setPaletteName('light'));
  const paletteRow = el('div', { className: 'flow-panel-row' });
  paletteRow.append(el('label', { textContent: 'Palette' }), darkBtn, lightBtn);
  root.append(paletteRow);

  const seedInput = el('input', { type: 'number' }) as HTMLInputElement;
  const syncSeed = () => {
    seedInput.value = String(ctx.getSeed());
  };
  syncSeed();
  refreshers.push(syncSeed);
  const reseedBtn = el('button', { textContent: 'Reseed' });
  reseedBtn.addEventListener('click', () => ctx.setSeed(Number(seedInput.value) || 0));
  const seedRow = el('div', { className: 'flow-panel-row' });
  seedRow.append(el('label', { textContent: 'Noise seed' }), seedInput, reseedBtn);
  root.append(seedRow);
  root.append(
    el('p', {
      className: 'flow-panel-hint',
      textContent:
        'Reseeds the swirl/noise pattern only — per-particle spawn randomness (spacing, speed jitter, traits) stays unseeded, so this alone will not reproduce a run bit-for-bit.',
    }),
  );

  // --- Presets ----------------------------------------------------------------
  section('Presets');
  const presetSelect = el('select') as HTMLSelectElement;
  for (const preset of PRESETS) presetSelect.append(el('option', { value: preset.name, textContent: preset.name }));
  const loadBtn = el('button', { textContent: 'Load' });
  loadBtn.addEventListener('click', () => {
    const preset = PRESETS.find((p) => p.name === presetSelect.value);
    if (preset) {
      applyPreset(preset, ctx);
      refreshAll();
    }
  });
  const presetRow = el('div', { className: 'flow-panel-row' });
  presetRow.append(presetSelect, loadBtn);
  root.append(presetRow);
  const presetDescription = el('p', { className: 'flow-panel-hint' });
  const syncPresetDescription = () => {
    const preset = PRESETS.find((p) => p.name === presetSelect.value);
    presetDescription.textContent = preset?.description ?? '';
  };
  presetSelect.addEventListener('change', syncPresetDescription);
  syncPresetDescription();
  root.append(presetDescription);

  const jsonArea = el('textarea', {
    placeholder: 'Paste preset JSON here, or click "Copy current as JSON" below.',
  }) as HTMLTextAreaElement;
  root.append(jsonArea);

  const copyBtn = el('button', { textContent: 'Copy current as JSON' });
  copyBtn.addEventListener('click', () => {
    const json = JSON.stringify(snapshotPreset(ctx), null, 2);
    jsonArea.value = json;
    navigator.clipboard?.writeText(json).catch(() => {
      // Clipboard access can be denied (permissions, insecure context) —
      // the JSON is still right there in the textarea to copy by hand.
    });
  });
  const applyBtn = el('button', { textContent: 'Apply pasted JSON' });
  applyBtn.addEventListener('click', () => {
    try {
      const parsed = JSON.parse(jsonArea.value) as FlowPreset;
      applyPreset(parsed, ctx);
      refreshAll();
    } catch (err) {
      console.warn('[flow] failed to parse pasted preset JSON', err);
    }
  });
  const presetBtnRow = el('div', { className: 'flow-panel-row' });
  presetBtnRow.append(copyBtn, applyBtn);
  root.append(presetBtnRow);

  document.body.append(root);

  return {
    refresh: refreshAll,
    setVisible(visible: boolean) {
      root.style.display = visible ? 'block' : 'none';
      if (visible) refreshAll();
    },
    toggle() {
      const nowVisible = root.style.display === 'none';
      root.style.display = nowVisible ? 'block' : 'none';
      if (nowVisible) refreshAll();
    },
  };
}
