/**
 * Fetching the two functions.
 *
 * Neither call can fail the other, and neither can blank the screen: a
 * rejection becomes a transport error on that feed alone and the previous
 * payload is kept by the caller. The functions themselves always answer 200
 * (DECISIONS 004), so a rejection here means the network or the platform,
 * not an upstream.
 */

import type { CurtailmentResponse, GridResponse, NarrationResponse } from './types';
import { emptyFeeds, type Feeds } from './state';
import { settlementAt } from './settlement';

const TIMEOUT_MS = 10_000;

async function getJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function reason(err: unknown): string {
  if (err instanceof Error) {
    return err.name === 'AbortError' ? 'timed out' : err.message;
  }
  return String(err);
}

export async function fetchFeeds(): Promise<Feeds> {
  // Ask for narration by the period our own clock says is current. The
  // server treats this only as a cache key and a sanity bound (it always
  // generates against its own clock) — see api/narration.ts.
  const { date, period } = settlementAt();

  const [grid, curtailment, narration] = await Promise.allSettled([
    getJson<GridResponse>('/api/grid'),
    getJson<CurtailmentResponse>('/api/curtailment'),
    getJson<NarrationResponse>(`/api/narration?date=${date}&period=${period}`),
  ]);

  const feeds = emptyFeeds();
  if (grid.status === 'fulfilled') feeds.grid = grid.value;
  else feeds.gridError = reason(grid.reason);

  if (curtailment.status === 'fulfilled') feeds.curtailment = curtailment.value;
  else feeds.curtailmentError = reason(curtailment.reason);

  if (narration.status === 'fulfilled') feeds.narration = narration.value;
  else feeds.narrationError = reason(narration.reason);

  return feeds;
}
