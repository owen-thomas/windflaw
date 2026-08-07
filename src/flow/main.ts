/**
 * Boot for the /flow page. Step 3 (art pass) added palettes, per-source/
 * per-particle stroke texture, and the dark/light toggle — see
 * Flow_Experiment_Spec.md's "Art pass" and palette.ts's docs. Step 4 adds
 * the control panel + presets — see controls.ts and presets.ts.
 */

import { DEFAULT_FIELD_PARAMS, reseedNoise, type FieldParams } from './field';
import { DEFAULT_PARTICLE_STYLE, ParticleSystem, segmentLeavesMask } from './particles';
import { renderDebugOverlay, type DebugLayer } from './debug';
import { buildWorld, GB_RING, type World } from './world';
import { DARK_PALETTE, PALETTES, type Palette, type PaletteName } from './palette';
import { SOURCES } from './sources';
import { createControlPanel, type FlowControlContext } from './controls';

const canvas = document.querySelector<HTMLCanvasElement>('#flow-canvas')!;
const ctx = canvas.getContext('2d')!;

// 2g: dropped from step-2/3's 3000. The fan-out doc's feedback is explicit
// that "fill the space" is a placement problem, not a quantity one — with
// density-aware spacing now doing that work, fewer elements read better,
// and the freed frame budget pays for the density grid's per-frame decay
// + gradient recompute. Step 4's particle-count slider goes up to 8000.
let particleCount = 1400;

let palette: Palette = { ...DARK_PALETTE };
// Live, mutable copy — DEFAULT_FIELD_PARAMS itself stays a pure constant.
// Mutable so runtime toggles (baseFieldMode's 'f' key below; more to come
// as later fan-out steps land their own A/B flags) can flip a field
// without a page reload. Step 4's field-weight sliders mutate this same
// object directly — no extra plumbing needed.
const fieldParams: FieldParams = { ...DEFAULT_FIELD_PARAMS };

// Step 4: knobs that live outside FieldParams/Palette because applying
// them needs no rebuild at all — read fresh every frame in frame() below.
let speedMultiplier = 1; // scales dt: also correctly speeds up noise evolution and density decay, both per-second rates
let strokeWeightMultiplier = 1;
// Mirrors field.ts's internal DEFAULT_NOISE_SEED (not exported — kept in
// sync by hand since it's a display-only starting value for the seed
// input, not something reseedNoise itself needs to know).
let currentSeed = 1337;

let world: World;
let particles: ParticleSystem;
let debugCanvas: HTMLCanvasElement | null = null;
let debugLayers = new Set<DebugLayer>(['coastline', 'mask']);
let debugVisible = false;
let controlPanel: ReturnType<typeof createControlPanel>;

function sizeCanvas(): { width: number; height: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(1, 0, 0, 1, 0, 0); // device pixels throughout — matches the mask's resolution
  return { width: canvas.width, height: canvas.height };
}

function rebuild() {
  const { width, height } = sizeCanvas();
  world = buildWorld(width, height);
  if (particles) {
    particles.setWorld(world);
  } else {
    particles = new ParticleSystem(world, particleCount, { style: { ...DEFAULT_PARTICLE_STYLE } });
  }
  debugCanvas = null; // rebuilt lazily on next draw if debug is visible
  paintOpaque();
}

/**
 * Step 4's particle-count slider: swaps in a fresh ParticleSystem at the
 * new size, same world. Actually cheaper than a resize's rebuild() (no
 * buildWorld/mask/distance-field recompute) — just new typed arrays plus
 * `count` respawns. Carries over the current `style` (jitter/spawn-spread)
 * so a count change doesn't silently reset those sliders — see
 * ParticleSystemOptions.style's own docs.
 */
function setParticleCount(n: number) {
  particleCount = Math.round(n);
  particles = new ParticleSystem(world, particleCount, { style: particles.style });
}

/**
 * Full opaque repaint in the current palette's background — used on
 * rebuild (a resize can change canvas dimensions, leaving stale pixels
 * the wash-fade alone wouldn't fully cover) and on a palette switch (the
 * wash alpha is far too low to clear the *other* palette's colours in one
 * frame; without this, switching dark->light would show old dark trails
 * fading out through a wrong-coloured wash for several seconds).
 */
function paintOpaque() {
  ctx.fillStyle = `rgb(${palette.backgroundRGB})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Step 4: switches to a *clone* of the named palette's tuned defaults,
 * not the shared PALETTES[name] object itself — the control panel's trail
 * length / stroke weight sliders mutate `palette` in place (same
 * direct-mutation convention as fieldParams), and mutating the shared
 * DARK_PALETTE/LIGHT_PALETTE constants directly would permanently corrupt
 * the tuned reference values for the rest of the session. Cloning means a
 * panel tweak is scoped to the current palette selection and resets to
 * the tuned default on every switch — a deliberate "revert to reference"
 * side effect, not just an implementation accident.
 *
 * Refreshes the panel's displayed values (if it exists yet — not true
 * during boot, before `controlPanel` is built) regardless of which caller
 * triggered the switch. Centralising the refresh here, rather than
 * leaving it to each caller, is what keeps the 'p' keyboard toggle in
 * main.ts's keydown handler and the panel's own Dark/Light buttons
 * consistent — the panel's washAlpha/stroke-weight sliders would
 * otherwise show a stale value after 'p' until the next show or preset
 * load, since that path doesn't go through the panel's own click
 * handlers.
 */
function setPalette(name: PaletteName) {
  palette = { ...PALETTES[name] };
  paintOpaque();
  controlPanel?.refresh();
}

let resizeTimer: number | undefined;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(rebuild, 200);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'd') {
    debugVisible = !debugVisible;
  } else if (e.key === '1') {
    toggleLayer('coastline');
  } else if (e.key === '2') {
    toggleLayer('mask');
  } else if (e.key === '3') {
    toggleLayer('sdf');
  } else if (e.key === '4') {
    toggleLayer('gradient');
  } else if (e.key === 'p') {
    setPalette(palette.name === 'dark' ? 'light' : 'dark');
  } else if (e.key === 'f') {
    // 2f A/B: divergent-from-sources (default) vs the step-2 south-goal
    // field — see field.ts's baseFieldMode docs.
    fieldParams.baseFieldMode = fieldParams.baseFieldMode === 'divergent' ? 'south' : 'divergent';
    console.log(`[flow] baseFieldMode -> ${fieldParams.baseFieldMode}`);
  } else if (e.key === 'g') {
    // 2g A/B: density-aware spacing (steering term + coverage recycling)
    // on vs off — see field.ts's densityEnabled docs.
    fieldParams.densityEnabled = !fieldParams.densityEnabled;
    console.log(`[flow] densityEnabled -> ${fieldParams.densityEnabled}`);
  } else if (e.key === 'n') {
    // 2h A/B: transverse (default) vs the step-2 isotropic curl mechanism
    // — see field.ts's noiseMode docs.
    fieldParams.noiseMode = fieldParams.noiseMode === 'transverse' ? 'isotropicCurl' : 'transverse';
    console.log(`[flow] noiseMode -> ${fieldParams.noiseMode}`);
  } else if (e.key === 'c') {
    // 2i A/B: coast conformance on vs off — see field.ts's conformWeight
    // docs. conformWeight=0 is a clean disable (the term short-circuits),
    // same "off via 0" convention as driftSpread/centerWeight/noiseWeight.
    fieldParams.conformWeight =
      fieldParams.conformWeight > 0 ? 0 : DEFAULT_FIELD_PARAMS.conformWeight;
    console.log(`[flow] conformWeight -> ${fieldParams.conformWeight}`);
  } else if (e.key === 'h') {
    // Step 4: the control panel, hidden by default per the spec.
    controlPanel.toggle();
  }
});

function toggleLayer(layer: DebugLayer) {
  if (debugLayers.has(layer)) {
    debugLayers.delete(layer);
  } else {
    debugLayers.add(layer);
  }
  debugCanvas = null;
}

rebuild();

/**
 * Step 4: the panel's whole view of live state, implemented against this
 * module's own mutable variables/functions — see controls.ts's
 * FlowControlContext docs for why each entry is a direct mutable
 * reference vs. a get/set pair.
 */
const panelContext: FlowControlContext = {
  fieldParams,
  get particleStyle() {
    return particles.style;
  },
  getParticleCount: () => particleCount,
  setParticleCount,
  getSpeedMultiplier: () => speedMultiplier,
  setSpeedMultiplier: (n) => {
    speedMultiplier = n;
  },
  getStrokeWeightMultiplier: () => strokeWeightMultiplier,
  setStrokeWeightMultiplier: (n) => {
    strokeWeightMultiplier = n;
  },
  getWashAlpha: () => palette.washAlpha,
  setWashAlpha: (n) => {
    palette.washAlpha = n;
  },
  getPaletteName: () => palette.name,
  setPaletteName: setPalette,
  getSeed: () => currentSeed,
  setSeed: (seed) => {
    currentSeed = seed;
    reseedNoise(seed);
  },
  getSourceRates: () => Object.fromEntries(SOURCES.map((s) => [s.id, s.rate])),
  setSourceRates: (rates) => {
    for (const source of SOURCES) {
      if (rates[source.id] !== undefined) source.rate = rates[source.id];
    }
    particles.refreshRates();
  },
};
controlPanel = createControlPanel(panelContext);

let lastTime = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - lastTime) / 1000); // clamp to avoid a huge step after a tab switch
  lastTime = now;

  ctx.fillStyle = `rgba(${palette.backgroundRGB}, ${palette.washAlpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Step 4's "global speed" slider: scale dt itself rather than threading
  // a multiplier through particles.ts. Correctly speeds up noise
  // evolution and density decay along with advection, since both are
  // expressed as per-second rates against the same dt (see field.ts's
  // noiseSpeed and densityDecayRate).
  particles.step(dt * speedMultiplier, fieldParams);
  particles.render(ctx, palette, strokeWeightMultiplier);

  if (debugVisible) {
    if (!debugCanvas) {
      debugCanvas = renderDebugOverlay(world, debugLayers, GB_RING);
    }
    ctx.drawImage(debugCanvas, 0, 0);
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Exposed for the mechanical containment check (step 7 of the build order) —
// not part of the runtime UI.
(window as unknown as { __flow: unknown }).__flow = {
  getWorld: () => world,
  getParticles: () => particles,
  getPalette: () => palette,
  setPalette,
  segmentLeavesMask,
};
