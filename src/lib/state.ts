/**
 * Client-side application state.
 *
 * Two kinds of failure are modelled separately and must not be conflated:
 *
 *   transport — the client could not reach our own function at all. The
 *               payload is missing entirely.
 *   health    — the function answered, but an upstream let it down. Some
 *               data is present; the flags say which parts. See DECISIONS 004.
 *
 * Freshness is derived from the payload's `fetchedAt`, never from when the
 * response arrived, because a CDN hit can be minutes old (DECISIONS 005).
 */

import { msUntilRollover, type SettlementRef } from './settlement.js';
import type { CurtailmentResponse, GridResponse, NarrationResponse } from './types.js';

export type Freshness = 'fresh' | 'ageing' | 'stale';

/** One CDN TTL. Anything younger is as fresh as the product ever claims. */
const FRESH_MS = 6 * 60 * 1000;
/** A whole settlement period without a refresh. The data has been superseded. */
const STALE_MS = 30 * 60 * 1000;

export interface Feeds {
  grid: GridResponse | null;
  /** Transport failure reaching /api/grid, not an upstream health flag. */
  gridError: string | null;
  curtailment: CurtailmentResponse | null;
  curtailmentError: string | null;
  /**
   * Absent for every fixture scenario by construction — scenarios.ts builds
   * these synchronously and never calls the network, so the narration view
   * always falls back to its local template for a fixture, which is the
   * correct behaviour rather than a special case (see scenarios.ts).
   */
  narration: NarrationResponse | null;
  narrationError: string | null;
}

export interface AppState extends Feeds {
  /** Render clock. Ticks independently of fetching so ages stay truthful. */
  now: Date;
  scenario: string;
  /**
   * True until the first fetch resolves. Empty-and-untried is not the same
   * claim as tried-and-failed, and the page must not make the second one
   * while it is still in the first (DECISIONS 016).
   */
  pending: boolean;
}

export function emptyFeeds(): Feeds {
  return {
    grid: null,
    gridError: null,
    curtailment: null,
    curtailmentError: null,
    narration: null,
    narrationError: null,
  };
}

export interface Age {
  freshness: Freshness;
  ms: number;
}

export function ageOf(fetchedAt: string | null | undefined, now: Date): Age | null {
  if (!fetchedAt) return null;
  const ms = Math.max(0, now.getTime() - Date.parse(fetchedAt));
  const freshness: Freshness = ms < FRESH_MS ? 'fresh' : ms < STALE_MS ? 'ageing' : 'stale';
  return { freshness, ms };
}

/**
 * The worst freshness across the feeds that actually arrived. Used for the
 * masthead's single honest claim about how current the screen is; individual
 * elements still show their own state.
 */
export function overallAge(state: AppState): Age | null {
  const ages = [ageOf(state.grid?.fetchedAt, state.now), ageOf(state.curtailment?.fetchedAt, state.now)]
    .filter((a): a is Age => a !== null);
  if (ages.length === 0) return null;
  return ages.reduce((worst, a) => (a.ms > worst.ms ? a : worst));
}

/** The settlement period the figures on screen describe, if any is known. */
export function settlementOf(state: AppState): SettlementRef | null {
  return state.grid?.settlement ?? state.curtailment?.now?.settlement ?? null;
}

/**
 * Whether the period on screen is the one now running.
 *
 * Age alone cannot answer this. A response cached for five minutes is young
 * by any freshness rule and can still describe a period that closed while it
 * sat in the CDN — land just after a rollover and the page would print a
 * green dot over a superseded reading. The payload names its own period, and
 * that period has an end time, so the comparison is exact (DECISIONS 006).
 */
export function describesNow(state: AppState): boolean {
  const settlement = settlementOf(state);
  if (!settlement) return false;
  return msUntilRollover(settlement, state.now) > 0;
}

/**
 * Whether one element's own reading may be spoken about in the present tense.
 *
 * Freshness and rollover are separate failures of currency and either one is
 * enough to move the tense. Each element asks about its own payload rather
 * than about the page's worst feed, for the same reason each owns its own
 * health: the mix can be current while the curtailment reading is not.
 * DECISIONS 010 applies the tense rule to every claim on the page, not only
 * to the headline.
 */
export function speaksOfNow(
  fetchedAt: string | null | undefined,
  settlement: SettlementRef | null | undefined,
  now: Date
): boolean {
  if (!settlement) return false;
  if (ageOf(fetchedAt, now)?.freshness === 'stale') return false;
  return msUntilRollover(settlement, now) > 0;
}
