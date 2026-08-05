/**
 * Boot for the /flow page. Step 3 (art pass) added palettes, per-source/
 * per-particle stroke texture, and the dark/light toggle — see
 * Flow_Experiment_Spec.md's "Art pass" and palette.ts's docs. Control
 * panel + presets (step 4) are still to come.
 */

import { DEFAULT_FIELD_PARAMS } from './field';
import { ParticleSystem, segmentLeavesMask } from './particles';
import { renderDebugOverlay, type DebugLayer } from './debug';
import { buildWorld, GB_RING, type World } from './world';
import { DARK_PALETTE, PALETTES, type Palette, type PaletteName } from './palette';

const canvas = document.querySelector<HTMLCanvasElement>('#flow-canvas')!;
const ctx = canvas.getContext('2d')!;

const PARTICLE_COUNT = 3000;

let palette: Palette = DARK_PALETTE;

let world: World;
let particles: ParticleSystem;
let debugCanvas: HTMLCanvasElement | null = null;
let debugLayers = new Set<DebugLayer>(['coastline', 'mask']);
let debugVisible = false;

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
    particles = new ParticleSystem(world, PARTICLE_COUNT);
  }
  debugCanvas = null; // rebuilt lazily on next draw if debug is visible
  paintOpaque();
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

function setPalette(name: PaletteName) {
  palette = PALETTES[name];
  paintOpaque();
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

let lastTime = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - lastTime) / 1000); // clamp to avoid a huge step after a tab switch
  lastTime = now;

  ctx.fillStyle = `rgba(${palette.backgroundRGB}, ${palette.washAlpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  particles.step(dt, DEFAULT_FIELD_PARAMS);
  particles.render(ctx, palette);

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
