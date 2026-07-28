/**
 * Prompt construction and output validation for the generated narration.
 *
 * The model is handed only pre-rounded, pre-formatted figures — never asked
 * to compute or restate a raw API number — so hallucination becomes
 * mechanically checkable rather than a matter of judgment: every digit the
 * model prints has to trace back to a digit we gave it (`validate`, the
 * numeral check). This is the guardrail that lets a generation sit cached
 * and unreviewed for up to half an hour.
 *
 * The rounding is deliberately coarser than the screen's own figures. This
 * text is generated once near the top of a period and can still be on
 * screen when the headline MW has moved with fresh acceptances twenty
 * minutes later; "around 1,800 MW" absorbs that drift where "1,841 MW"
 * would read as contradicting a number two rows above it.
 */

import type { Situation } from '../../src/lib/situation';

export const MIN_WORDS = 40;
export const MAX_WORDS = 70;

/** Outright banned rather than pattern-matched for imperatives: cheap, and
 *  the prompt carries the rest of the advice guardrail. */
const BANNED_WORDS = ['you', 'your', 'yours', "you're", 'should', 'consider', 'recommend', 'advise', 'try'];

function roundedMW(mw: number): number {
  return Math.round(mw / 100) * 100;
}

function roundedPct(pct: number): number {
  return Math.round(pct / 5) * 5;
}

function intensityFact(label: string, gco2: number | null): string {
  if (gco2 === null) return `${label}'s carbon intensity: not reported this half-hour`;
  const rounded = Math.round(gco2);
  return `${label}'s carbon intensity: ${rounded} gram${rounded === 1 ? '' : 's'} of CO2 per kilowatt-hour`;
}

/** The facts the model may draw on, already rounded to what it should print. */
export function factsOf(situation: Situation): string[] {
  const facts: string[] = [];

  if (situation.north) {
    facts.push(`${situation.north.name}: around ${roundedPct(situation.north.windPct)}% wind this half-hour`);
    facts.push(intensityFact(situation.north.name, situation.north.intensity));
  }
  if (situation.south) {
    facts.push(`${situation.south.name}: around ${roundedPct(situation.south.gasPct)}% gas this half-hour`);
    facts.push(intensityFact(situation.south.name, situation.south.intensity));
  }

  if (situation.constraint === 'constrained' && situation.curtailedMW !== null) {
    facts.push(
      `Curtailment: at least ${roundedMW(situation.curtailedMW).toLocaleString('en-GB')} MW of Scottish ` +
        'wind instructed to stop right now, because the network south cannot carry it'
    );
  } else if (situation.constraint === 'clear') {
    facts.push(
      'Curtailment: none. No tracked Scottish wind is currently instructed to stop; the network is ' +
        'carrying what the north is making'
    );
  } else {
    facts.push('Curtailment: unavailable this half-hour');
  }

  if (situation.forecastDirection) {
    facts.push(`Next two hours: national carbon intensity is forecast to be ${situation.forecastDirection}`);
  }

  return facts;
}

export function buildPrompt(situation: Situation): { system: string; user: string } {
  const facts = factsOf(situation);

  const system =
    'You write a single short paragraph narrating the British electricity grid, for a public website ' +
    'called Windflaw. British English, plain register, no exclamation marks, no enthusiasm. ' +
    'You may be slightly wry about the specific paradox of paying wind farms to switch off while gas ' +
    'plants elsewhere pick up the load, but only when the facts below actually show that happening — ' +
    'on a calm, ordinary half-hour with nothing curtailed, stay flat and say so plainly rather than ' +
    'reaching for drama that is not there. ' +
    `Length: ${MIN_WORDS} to ${MAX_WORDS} words, one paragraph, no headings, no lists. ` +
    'Hedge appropriately: this is a half-hourly settlement reading, partly forecast, not a live ' +
    'per-second feed. Words like "around", "currently" and "this half-hour" are correct; false ' +
    'precision is not. ' +
    'Describe and explain only. Never advise, instruct, or address the reader directly — no "you", ' +
    'no suggestions about what anyone should do with their own electricity use. ' +
    'Use only the figures given to you below, in the rounding given. Do not calculate a more precise ' +
    'number, and do not introduce any figure that is not listed.';

  const user =
    'Facts for this settlement period, already rounded to the precision you should print:\n' +
    facts.map((fact) => `- ${fact}`).join('\n') +
    '\n\nWrite the paragraph now.';

  return { system, user };
}

/** Digit runs, comma grouping normalised away so "1,800" and "1800" match. */
function numeralsIn(text: string): string[] {
  return (text.match(/\d[\d,]*\.?\d*/g) ?? []).map((n) => n.replace(/,/g, ''));
}

export function validate(text: string, situation: Situation): boolean {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) return false;
  if (text.includes('!')) return false;

  for (const banned of BANNED_WORDS) {
    if (new RegExp(`\\b${banned}\\b`, 'i').test(text)) return false;
  }

  const allowedNumerals = new Set(numeralsIn(factsOf(situation).join(' ')));
  for (const numeral of numeralsIn(text)) {
    if (!allowedNumerals.has(numeral)) return false;
  }

  return true;
}
