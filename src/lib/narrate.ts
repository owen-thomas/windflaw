/**
 * The deterministic narration.
 *
 * This is phase 2's failure state, written in phase 1 so the slot on screen
 * is real and sized against genuine sentences rather than lorem. When the
 * model is wired up it replaces this text; when generation fails, this is
 * what the page shows, and the page is never empty.
 *
 * It obeys the same rules the prompt will: British English, plain register,
 * hedged to settlement-period granularity, "at least" on the curtailment
 * figure, and description only — it never advises.
 */

import { formatMW, formatPct } from './format';
import type { CurtailmentResponse, GridResponse } from './types';

export interface Narration {
  text: string;
  /** How the sentence was produced. The UI states this rather than implying it. */
  provenance: 'template' | 'generated';
}

export function narrate(
  grid: GridResponse | null,
  curtailment: CurtailmentResponse | null
): Narration | null {
  const north = grid?.regions?.scotland ?? grid?.regions?.northScotland ?? null;
  const south = grid?.regions?.southEngland ?? grid?.regions?.southEastEngland ?? null;
  if (!north && !south && !curtailment?.now) return null;

  const parts: string[] = [];

  if (north) {
    parts.push(
      `Scotland is running at around ${formatPct(north.windPct)} wind this half-hour, ` +
        `at ${Math.round(north.intensity.forecast ?? north.intensity.actual ?? 0)} grams of ` +
        `carbon dioxide per kilowatt-hour.`
    );
  }

  if (south) {
    parts.push(
      `South England is at ${formatPct(south.gasPct)} gas and ` +
        `${Math.round(south.intensity.forecast ?? south.intensity.actual ?? 0)} grams.`
    );
  }

  const now = curtailment?.now;
  if (now && now.curtailedMW > 0) {
    parts.push(
      `At least ${formatMW(now.curtailedMW)} of Scottish wind is instructed to stop, because ` +
        `the network south cannot carry it.`
    );
  } else if (now) {
    parts.push(
      'No tracked Scottish wind is currently instructed to stop; the network is carrying ' +
        'what the north is making.'
    );
  } else {
    parts.push('The curtailment reading is unavailable this half-hour.');
  }

  return { text: parts.join(' '), provenance: 'template' };
}
