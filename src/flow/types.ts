/**
 * Shared shapes for the flow visual. Kept separate from `src/lib/types.ts` —
 * this page shares no data or types with the dashboard, only conventions.
 */

/** A wind farm (or later, other generation) that particles are born at. */
export interface Source {
  id: string;
  name: string;
  /** Raw lat/lon of the physical site. */
  latLon: [number, number];
  /** Snapped-to-mainland override, for sources off the GB mainland polygon. */
  anchor?: [number, number];
  /** Later: 'solar' | 'gas' | 'nuclear' | ... */
  type: 'wind';
  /** Particles/sec. V1: a fixed per-source constant, later live output. */
  rate: number;
  /** Per-source colour channel key, for palette lookup. */
  palette?: string;
}

/** A point in canvas (pixel) space. */
export type Vec2 = [number, number];
