/**
 * The narration slot.
 *
 * Two of the design questions from the project plan are answered here. The
 * text is set apart from every other piece of copy on the screen — larger,
 * lighter, on its own rule — so it reads as commentary rather than as label.
 * And its provenance is stated in words rather than implied by styling: the
 * strap beneath says what wrote it and which period it describes. A reader
 * should never have to guess whether a machine wrote a sentence.
 *
 * The generated sentence is only ever shown when three things line up: the
 * page's own reading is current enough to speak in the present (`present`,
 * the same test the deterministic sentence already used), the narration
 * function actually produced validated text, and that text names the exact
 * settlement period the rest of the screen is showing. Any one of those
 * failing — a stale reading, a rollover the narration fetch hasn't caught up
 * with yet, a generation that failed validation twice — falls through to the
 * local template, which is written to be correct in the past tense too. The
 * model never has to get tense right; it only ever describes a period that
 * has just been confirmed current.
 */

import { el, setAttr, setTextCrossfade, type View } from './dom';
import { narrate } from '../lib/narrate';
import { speaksOfNow, settlementOf, type AppState } from '../lib/state';
import type { SettlementRef } from '../lib/settlement';

/** The generated sentence, if it exists and names the period on screen. */
function matchingGenerated(
  state: AppState,
  settlement: SettlementRef | null
): { text: string } | null {
  const generated = state.narration?.narration;
  if (!generated || !settlement) return null;
  const named = state.narration!.settlement;
  if (named.date !== settlement.date || named.period !== settlement.period) return null;
  return generated;
}

export function narrationView(): View {
  const body = el('p', { class: 'narration__body' });
  const strap = el('p', { class: 'narration__strap' });

  const root = el(
    'section',
    { class: 'narration', 'data-provenance': 'template', 'aria-live': 'polite' },
    body,
    strap
  );

  return {
    el: root,
    update(state: AppState) {
      const settlement = settlementOf(state);
      // One paragraph, one tense, and the cautious reading wins: every feed
      // it draws on has to be current for it to speak in the present.
      const present =
        (!state.grid || speaksOfNow(state.grid.fetchedAt, state.grid.settlement, state.now)) &&
        (!state.curtailment?.now ||
          speaksOfNow(state.curtailment.fetchedAt, state.curtailment.now.settlement, state.now));

      const period = settlement?.period;
      const generated = present ? matchingGenerated(state, settlement) : null;

      if (generated) {
        setAttr(root, 'data-provenance', 'generated');
        setTextCrossfade(body, generated.text);
        setTextCrossfade(strap, `Written by Claude for settlement period ${period ?? '—'}.`);
        return;
      }

      const fallback = narrate(state.grid, state.curtailment, present);

      if (!fallback && state.pending) {
        setAttr(root, 'data-provenance', 'none');
        setTextCrossfade(body, 'Waiting for this half-hour’s readings.');
        setTextCrossfade(strap, 'Nothing is described until the sources have answered.');
        return;
      }

      if (!fallback) {
        setAttr(root, 'data-provenance', 'none');
        setTextCrossfade(body, 'Nothing to describe: no reading arrived this half-hour.');
        setTextCrossfade(strap, 'Windflaw is not reaching its data sources.');
        return;
      }

      setAttr(root, 'data-provenance', fallback.provenance);
      setTextCrossfade(body, fallback.text);
      setTextCrossfade(
        strap,
        `Assembled from the figures above for settlement period ${period ?? '—'}. Not yet written by a model.`
      );
    },
  };
}
