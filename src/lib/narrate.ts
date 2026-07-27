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
import { situationOf } from './situation';
import type { CurtailmentResponse, GridResponse } from './types';

export interface Narration {
  text: string;
  /** How the sentence was produced. The UI states this rather than implying it. */
  provenance: 'template' | 'generated';
}

/**
 * Grams in words, or nothing at all.
 *
 * A missing reading is missing: it is not zero, and zero is a remarkable
 * claim to make about a grid. The band view says "unknown" in the same case
 * (format.ts), and this text is what ships whenever generation fails, so a
 * number invented here is a number the product tells a reader as fact.
 * The singular matters too — 1 gCO₂/kWh is an ordinary Scottish reading on a
 * windy day, which is to say the flagship state.
 */
function grams(value: number | null): string | null {
  if (value === null) return null;
  const rounded = Math.round(value);
  return `${rounded} ${rounded === 1 ? 'gram' : 'grams'}`;
}

/**
 * `present` is false once the reading has gone stale or its settlement period
 * has closed. The narration is the longest piece of prose on the page and so
 * the most expensive place to leave the tense wrong; the rule is the same one
 * the headline and the constraint follow (DECISIONS 010).
 */
export function narrate(
  grid: GridResponse | null,
  curtailment: CurtailmentResponse | null,
  present = true
): Narration | null {
  const situation = situationOf(grid, curtailment);
  if (!situation.north && !situation.south && situation.constraint === 'unknown') return null;

  const parts: string[] = [];

  if (situation.north) {
    const intensity = grams(situation.north.intensity);
    parts.push(
      `Scotland ${present ? 'is' : 'was'} running at around ${formatPct(situation.north.windPct)} wind ` +
        `${present ? 'this half-hour' : 'when this was last read'}` +
        (intensity
          ? `, at ${intensity} of carbon dioxide per kilowatt-hour.`
          : `. Its carbon intensity ${present ? 'is not being' : 'was not'} reported.`)
    );
  }

  if (situation.south) {
    const intensity = grams(situation.south.intensity);
    parts.push(
      `South England ${present ? 'is' : 'was'} at ${formatPct(situation.south.gasPct)} gas` +
        (intensity ? ` and ${intensity}.` : ', with no intensity reading.')
    );
  }

  if (situation.constraint === 'constrained' && situation.curtailedMW !== null) {
    parts.push(
      `At least ${formatMW(situation.curtailedMW)} of Scottish wind ` +
        `${present ? 'is' : 'was'} instructed to stop, because the network south ` +
        `${present ? 'cannot' : 'could not'} carry it.`
    );
  } else if (situation.constraint === 'clear') {
    parts.push(
      present
        ? 'No tracked Scottish wind is currently instructed to stop; the network is carrying ' +
            'what the north is making.'
        : 'No tracked Scottish wind was instructed to stop; the network was carrying what the ' +
            'north was making.'
    );
  } else {
    parts.push('The curtailment reading is unavailable this half-hour.');
  }

  return { text: parts.join(' '), provenance: 'template' };
}
