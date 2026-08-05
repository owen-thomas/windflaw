import gbMainland from './data/gb-mainland.json';
import { buildDistanceField, type DistanceField } from './distanceField';
import { buildGeodesicField, type GeodesicField } from './geodesicField';
import { buildRasterMask, type RasterMask } from './mask';
import { buildProjection, type Projection } from './projection';
import { originOf, SOURCES } from './sources';
import type { Source, Vec2 } from './types';

export const GB_RING = (gbMainland as unknown as { ring: [number, number][] }).ring;

/** Minimum device-px clearance from the coast a snapped source is walked to. */
const SNAP_BUFFER_PX = 24;

/** A source resolved to canvas space, snapped inside the mask if needed. */
export interface ResolvedSource {
  source: Source;
  /** Canvas (device-pixel) position particles actually emit from. */
  position: Vec2;
  /** True if the source's origin projected outside the mask and was auto-snapped. */
  wasSnapped: boolean;
}

export interface World {
  projection: Projection;
  mask: RasterMask;
  distanceField: DistanceField;
  sources: ResolvedSource[];
  /**
   * The largest signed distance value anywhere on the mainland — i.e. the
   * single most-inland point's distance to the coast, in device px.
   * Measured directly from this world's distance field rather than
   * hardcoded, so it stays correct across viewport sizes and any future
   * coastline edits. Used by field.ts to normalise the whole-interior
   * centering term (step 2b) against an actual, current figure instead of
   * an eyeballed constant.
   */
  maxInteriorDist: number;
  /**
   * Path-aware "which way is actually south" field (see geodesicField.ts) —
   * a multi-source BFS from the southern goal band, giving every interior
   * cell its geodesic distance-to-south and gradient. Tried after both
   * field-parameter retuning and coastline-data pruning failed to move a
   * death hotspot at the Scotland/England border: that border is a genuine
   * narrow waist, and a purely local field (straight-line south + nearby-
   * coast steering) has no way to "see" it's approaching a re-entrant bay
   * rather than open coastline.
   */
  geodesicField: GeodesicField;
}

/**
 * Walk from a point toward the GB interior along the distance field's
 * gradient until it lands inside the mask. Used to auto-snap a source
 * whose origin falls just outside the simplified coastline (an artefact
 * of Douglas-Peucker tolerance, e.g. a narrow spur like Kyle of Lochalsh
 * being shaved off) rather than hard-failing on it.
 *
 * The gradient of the signed distance field points from low values
 * (further outside / nearer coast) toward high values (interior), so
 * following it — even from an outside starting point — heads inward.
 *
 * Walks past the first inside pixel to `buffer` device px of clearance,
 * not just past distance zero. A source that lands exactly on the
 * waterline has no margin at all — a particle emitted there dies to
 * mask-exit on its very first steps, before the field has any distance to
 * steer it. This is the same reason real wind farms aren't built in the
 * intertidal zone; a snapped source should behave like an inland one.
 */
function snapInside(
  start: Vec2,
  mask: RasterMask,
  distanceField: DistanceField,
  buffer: number,
): Vec2 {
  let [x, y] = start;
  const step = distanceField.cellSize;
  const maxSteps = Math.ceil((mask.width + mask.height) / step) + 50;

  for (let i = 0; i < maxSteps; i++) {
    if (mask.isInside(x, y) && distanceField.sample(x, y).dist >= buffer) return [x, y];
    const { gx, gy } = distanceField.sample(x, y);
    if (gx === 0 && gy === 0) {
      // No local gradient (flat/interior of a large uniform region this
      // shouldn't happen near a boundary) — nudge toward canvas centre as
      // a last resort so the walk doesn't stall.
      const cx = mask.width / 2;
      const cy = mask.height / 2;
      const dx = cx - x;
      const dy = cy - y;
      const len = Math.hypot(dx, dy) || 1;
      x += (dx / len) * step;
      y += (dy / len) * step;
      continue;
    }
    x += gx * step;
    y += gy * step;
  }
  return [x, y];
}

export function buildWorld(viewportWidth: number, viewportHeight: number): World {
  const projection = buildProjection(GB_RING, viewportWidth, viewportHeight);
  const mask = buildRasterMask(GB_RING, projection, viewportWidth, viewportHeight);
  const distanceField = buildDistanceField(mask);
  const geodesicField = buildGeodesicField(mask);

  const sources: ResolvedSource[] = SOURCES.map((source) => {
    const origin = originOf(source);
    const projected = projection.project(origin);
    if (mask.isInside(projected[0], projected[1])) {
      return { source, position: projected, wasSnapped: false };
    }
    const snapped = snapInside(projected, mask, distanceField, SNAP_BUFFER_PX);
    console.warn(
      `[flow] Source "${source.id}" (${source.name}) origin projects outside the GB ` +
        `mask at [${projected[0].toFixed(1)}, ${projected[1].toFixed(1)}]; ` +
        `auto-snapped to [${snapped[0].toFixed(1)}, ${snapped[1].toFixed(1)}]. ` +
        `Likely a coastline-simplification artefact — check this source's coordinates ` +
        `if the snap distance looks large.`,
    );
    return { source, position: snapped, wasSnapped: true };
  });

  let maxInteriorDist = 0;
  for (let i = 0; i < distanceField.distance.length; i++) {
    const d = distanceField.distance[i];
    if (d > maxInteriorDist) maxInteriorDist = d;
  }

  return { projection, mask, distanceField, sources, maxInteriorDist, geodesicField };
}
