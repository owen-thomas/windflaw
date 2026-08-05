import type { Vec2 } from './types';

/**
 * Scaled equirectangular projection with a cos(mid-latitude) correction on
 * longitude — sufficient at GB's scale, no projection library needed (per
 * spec). Fits the polygon's bounding box to the viewport with padding,
 * preserving aspect, so it's rebuilt whenever the canvas resizes.
 */
export interface Projection {
  /** Project [lat, lon] to canvas pixel space. */
  project(latLon: [number, number]): Vec2;
  width: number;
  height: number;
  /** Canvas-space bounding box the polygon was fit into. Used by the field
   *  to map canvas y to a north/south fraction without inverting the
   *  projection. */
  bounds: { top: number; bottom: number; left: number; right: number };
}

export interface ProjectionOptions {
  /** Fraction of the shorter viewport dimension reserved as padding on each side. */
  padding?: number;
}

export function buildProjection(
  ring: [number, number][],
  viewportWidth: number,
  viewportHeight: number,
  options: ProjectionOptions = {},
): Projection {
  const padding = options.padding ?? 0.06;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lat, lon] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);

  // Extent of the polygon in "projected degrees" (lon already cos-corrected).
  const spanX = (maxLon - minLon) * lonScale;
  const spanY = maxLat - minLat;

  const padPx = padding * Math.min(viewportWidth, viewportHeight);
  const availW = viewportWidth - 2 * padPx;
  const availH = viewportHeight - 2 * padPx;

  // Fit to the viewport preserving aspect: one axis is padding-constrained,
  // the other gets extra margin so the shape isn't stretched.
  const scale = Math.min(availW / spanX, availH / spanY);

  const drawW = spanX * scale;
  const drawH = spanY * scale;
  const offsetX = (viewportWidth - drawW) / 2;
  const offsetY = (viewportHeight - drawH) / 2;

  function project([lat, lon]: [number, number]): Vec2 {
    const x = (lon * lonScale - minLon * lonScale) * scale + offsetX;
    // Screen y grows downward; latitude grows northward, so flip.
    const y = (maxLat - lat) * scale + offsetY;
    return [x, y];
  }

  return {
    project,
    width: viewportWidth,
    height: viewportHeight,
    bounds: {
      top: offsetY,
      bottom: offsetY + drawH,
      left: offsetX,
      right: offsetX + drawW,
    },
  };
}
