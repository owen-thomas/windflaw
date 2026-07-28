/**
 * The single classification of what the grid is doing this half-hour.
 *
 * Both narrations read from this: the deterministic sentence in narrate.ts
 * and the generated one built server-side in api/_lib/narration-prompt.ts.
 * Before this existed, the constrained/clear/unknown call and the region
 * figures were worked out inline wherever they were needed, which is exactly
 * how a template and a model prompt end up describing two different grids
 * from the same payload. One function, one classification, both consumers.
 *
 * Deliberately excludes tense and freshness. Whether a claim may be spoken in
 * the present is a question about the *reader's* screen at render time
 * (state.ts, speaksOfNow) — this module only ever describes "now" as of the
 * instant its inputs were fetched, which is what a fresh server-side
 * generation always is.
 */

import type { CurtailmentResponse, GridResponse } from './types.js';
import type { SettlementRef } from './settlement.js';

export type ConstraintState = 'constrained' | 'clear' | 'unknown';
export type ForecastDirection = 'rising' | 'falling' | 'flat' | null;

export interface RegionFigure {
  name: string;
  windPct: number;
  gasPct: number;
  /** gCO2/kWh, forecast preferred over actual — see DECISIONS on this choice. */
  intensity: number | null;
}

export interface Situation {
  settlement: SettlementRef | null;
  constraint: ConstraintState;
  curtailedMW: number | null;
  north: RegionFigure | null;
  south: RegionFigure | null;
  forecastDirection: ForecastDirection;
}

function regionFigure(
  region: {
    name: string;
    windPct: number;
    gasPct: number;
    intensity: { forecast: number | null; actual: number | null };
  } | null
): RegionFigure | null {
  if (!region) return null;
  return {
    name: region.name,
    windPct: region.windPct,
    gasPct: region.gasPct,
    intensity: region.intensity.forecast ?? region.intensity.actual,
  };
}

/** Two hours of national intensity forecast, points 30 minutes apart. */
const LOOKAHEAD_POINTS = 4;
/** Smaller swings are noise, not a direction worth narrating. */
const FLAT_THRESHOLD_GCO2 = 10;

/**
 * A proxy for "is more or less wind expected", read off the only forecast
 * this product fetches: national carbon intensity (DECISIONS 011 — the 24h
 * forecast is fetched but not drawn, kept for exactly this). Falling
 * intensity tracks rising wind on the GB grid closely enough to narrate as
 * direction; it is not a wind forecast and should not be sold as one.
 */
function forecastDirectionOf(forecast: GridResponse['forecast']): ForecastDirection {
  if (!forecast || forecast.length < 2) return null;
  const points = forecast
    .slice(0, LOOKAHEAD_POINTS)
    .map((p) => p.forecast)
    .filter((v): v is number => v !== null);
  if (points.length < 2) return null;
  const delta = points[points.length - 1] - points[0];
  if (Math.abs(delta) < FLAT_THRESHOLD_GCO2) return 'flat';
  return delta < 0 ? 'falling' : 'rising';
}

export function situationOf(
  grid: GridResponse | null,
  curtailment: CurtailmentResponse | null
): Situation {
  const northRegion = grid?.regions?.scotland ?? grid?.regions?.northScotland ?? null;
  const southRegion = grid?.regions?.southEngland ?? grid?.regions?.southEastEngland ?? null;
  const now = curtailment?.now ?? null;

  return {
    settlement: grid?.settlement ?? curtailment?.now?.settlement ?? null,
    constraint: now === null ? 'unknown' : now.curtailedMW > 0 ? 'constrained' : 'clear',
    curtailedMW: now?.curtailedMW ?? null,
    north: regionFigure(northRegion),
    south: regionFigure(southRegion),
    forecastDirection: forecastDirectionOf(grid?.forecast ?? null),
  };
}
