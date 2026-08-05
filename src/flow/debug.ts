import type { World } from './world';

/**
 * Temporary debug overlays for judging containment and steering quality
 * during the skeleton step — coastline outline, mask tint, SDF heatmap,
 * gradient arrows. Stripped before the art pass (step 3); everything here
 * is static per-world, so it's rendered once to an offscreen canvas and
 * blitted rather than redrawn per frame.
 */
export type DebugLayer = 'coastline' | 'mask' | 'sdf' | 'gradient';

export function renderDebugOverlay(
  world: World,
  layers: Set<DebugLayer>,
  ring: [number, number][],
): HTMLCanvasElement {
  const { mask, distanceField, projection } = world;
  const canvas = document.createElement('canvas');
  canvas.width = mask.width;
  canvas.height = mask.height;
  const ctx = canvas.getContext('2d')!;

  if (layers.has('sdf')) {
    const img = ctx.createImageData(mask.width, mask.height);
    const { gridWidth, cellSize, distance } = distanceField;
    const maxDist = 400; // device px, clamp for colour scale
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        const gx = Math.min(gridWidth - 1, Math.round(x / cellSize));
        const gy = Math.min(distanceField.gridHeight - 1, Math.round(y / cellSize));
        const d = distance[gy * gridWidth + gx];
        const t = Math.min(1, Math.abs(d) / maxDist);
        const i = (y * mask.width + x) * 4;
        if (d >= 0) {
          // Inside: teal ramp.
          img.data[i] = 10;
          img.data[i + 1] = 40 + t * 180;
          img.data[i + 2] = 40 + t * 120;
        } else {
          // Outside: magenta ramp.
          img.data[i] = 40 + t * 180;
          img.data[i + 1] = 10;
          img.data[i + 2] = 40 + t * 120;
        }
        img.data[i + 3] = 140;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  if (layers.has('mask')) {
    ctx.fillStyle = 'rgba(80, 200, 255, 0.12)';
    for (let y = 0; y < mask.height; y += 1) {
      // Cheap row-run fill instead of per-pixel fillRect for the tint.
      let x = 0;
      while (x < mask.width) {
        if (mask.data[y * mask.width + x] === 1) {
          const runStart = x;
          while (x < mask.width && mask.data[y * mask.width + x] === 1) x++;
          ctx.fillRect(runStart, y, x - runStart, 1);
        } else {
          x++;
        }
      }
    }
  }

  if (layers.has('gradient')) {
    ctx.strokeStyle = 'rgba(255, 220, 60, 0.6)';
    ctx.lineWidth = 1;
    const step = distanceField.cellSize * 6;
    ctx.beginPath();
    for (let y = step / 2; y < mask.height; y += step) {
      for (let x = step / 2; x < mask.width; x += step) {
        const { gx, gy } = distanceField.sample(x, y);
        if (gx === 0 && gy === 0) continue;
        const len = 10;
        ctx.moveTo(x, y);
        ctx.lineTo(x + gx * len, y + gy * len);
      }
    }
    ctx.stroke();
  }

  if (layers.has('coastline')) {
    const points = ring.map(projection.project);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.stroke();
  }

  return canvas;
}
