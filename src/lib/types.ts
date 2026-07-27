/**
 * Wire types shared between the serverless functions and the client.
 *
 * Two rules govern these shapes:
 *
 * 1. Every response carries `fetchedAt`. Staleness is computed from that
 *    field, never from when the client received the response — a CDN hit
 *    can be minutes old, and inside the stale-while-revalidate window it
 *    can be older still. The payload timestamp is the only honest clock.
 *
 * 2. Upstream failure is data, not an HTTP status. The functions return 200
 *    with health flags and whatever they managed to fetch, so one dead
 *    source cannot poison a cacheable response or blank a working element.
 */

import type { SettlementRef } from './settlement';

export type SourceHealth = 'ok' | 'partial' | 'failed';

export interface Fuel {
  fuel: string;
  perc: number;
}

export interface Intensity {
  forecast: number | null;
  actual: number | null;
  index: string | null;
}

export interface RegionState {
  regionId: number;
  name: string;
  intensity: Intensity;
  generationMix: Fuel[];
  windPct: number;
  gasPct: number;
}

export interface NationalState {
  intensity: Intensity;
  generationMix: Fuel[];
  windPct: number;
  gasPct: number;
}

export interface ForecastPoint {
  from: string;
  to: string;
  forecast: number | null;
  index: string | null;
}

/** The regions the paradox needs: wind in the north, gas in the south. */
export interface RegionalState {
  scotland: RegionState | null;
  northScotland: RegionState | null;
  southScotland: RegionState | null;
  southEngland: RegionState | null;
  southEastEngland: RegionState | null;
}

export interface GridResponse {
  fetchedAt: string;
  settlement: SettlementRef;
  health: {
    overall: SourceHealth;
    national: SourceHealth;
    regional: SourceHealth;
    forecast: SourceHealth;
  };
  errors: string[];
  national: NationalState | null;
  regions: RegionalState | null;
  forecast: ForecastPoint[] | null;
}

export interface CurtailedUnit {
  id: string;
  name: string;
  farm: string;
  capacityMW: number;
  /** Instantaneous shortfall: declared level minus instructed level, MW. */
  curtailedMW: number;
}

export interface CurtailedFarm {
  farm: string;
  name: string;
  curtailedMWh: number;
}

/**
 * Instantaneous curtailment. MW is a true "right now" measurement — it does
 * not accumulate, so it carries no mid-period undercount.
 */
export interface CurtailmentNow {
  settlement: SettlementRef;
  /** Instant the levels were sampled at. */
  sampledAt: string;
  curtailedMW: number;
  unitsCurtailed: number;
  units: CurtailedUnit[];
}

/**
 * Settled curtailment for the last complete period. MWh only becomes
 * meaningful once the period has closed and all acceptances have landed.
 */
export interface CurtailmentSettled {
  settlement: SettlementRef;
  curtailedMWh: number;
  unitsCurtailed: number;
  farms: CurtailedFarm[];
}

export interface CurtailmentResponse {
  fetchedAt: string;
  health: {
    overall: SourceHealth;
    now: SourceHealth;
    settled: SourceHealth;
  };
  errors: string[];
  now: CurtailmentNow | null;
  settled: CurtailmentSettled | null;
  /** Provenance for the method note. The figure is a floor, and says so. */
  method: {
    basis: string;
    unitsTracked: number;
    capacityMW: number;
  };
}

/**
 * One generated sentence per settlement period, or none.
 *
 * `health` is 'ok' only when `narration` is populated with text that passed
 * validation; every other case — no API key, a failed generation, nothing to
 * describe — is 'failed' with `narration: null`. The client's own template
 * (narrate.ts) is the fallback in every 'failed' case; this function never
 * ships a template sentence itself, so a transient failure here is
 * self-healing on the next request rather than pinned at the CDN for the
 * rest of the period.
 */
export interface NarrationResponse {
  fetchedAt: string;
  /** The period this text describes, named so the client can refuse to show
   *  it against a screen that has since moved on to a different period. */
  settlement: SettlementRef;
  health: SourceHealth;
  errors: string[];
  narration: { text: string; provenance: 'generated' } | null;
}
