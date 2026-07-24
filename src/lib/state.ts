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

import type { CurtailmentResponse, GridResponse } from './types';

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
}

export interface AppState extends Feeds {
  /** Render clock. Ticks independently of fetching so ages stay truthful. */
  now: Date;
  scenario: string;
}

export function emptyFeeds(): Feeds {
  return { grid: null, gridError: null, curtailment: null, curtailmentError: null };
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
