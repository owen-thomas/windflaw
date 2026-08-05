/**
 * Boot for the /flow skeleton (build step 1). Crude particles, one field
 * (southward drift + boundary steering only), debug overlays keyed to
 * judge containment. Art pass (palettes, trail texture, curl noise, source
 * outflow, control panel) is later steps — see Flow_Experiment_Spec.md.
 */

import { DEFAULT_FIELD_PARAMS } from './field';
import { ParticleSystem, segmentLeavesMask } from './particles';
import { renderDebugOverlay, type DebugLayer } from './debug';
import { buildWorld, GB_RING, type World } from './world';

const canvas = document.querySelector<HTMLCanvasElement>('#flow-canvas')!;
const ctx = canvas.getContext('2d')!;

const PARTICLE_COUNT = 3000;
const WASH_ALPHA = 0.08; // fade-to-background wash; trail length = inverse of this
const BG_COLOR = '5, 6, 8';
const STROKE_COLOR = 'rgba(220, 235, 245, 0.55)';
const STROKE_WIDTH = 1;

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

  // Opaque paint on rebuild so the wash-fade doesn't reveal stale pixels
  // from the previous canvas size.
  ctx.fillStyle = `rgb(${BG_COLOR})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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

  ctx.fillStyle = `rgba(${BG_COLOR}, ${WASH_ALPHA})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  particles.step(dt, DEFAULT_FIELD_PARAMS);
  particles.render(ctx, STROKE_COLOR, STROKE_WIDTH);

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
  segmentLeavesMask,
};
