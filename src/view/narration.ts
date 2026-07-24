/**
 * The narration slot.
 *
 * Phase 2 fills this with generated text; phase 1 renders the deterministic
 * fallback so the slot is real, sized against genuine sentences, and its
 * treatment already decided.
 *
 * Two of the design questions from the project plan are answered here. The
 * text is set apart from every other piece of copy on the screen — larger,
 * lighter, on its own rule — so it reads as commentary rather than as label.
 * And its provenance is stated in words rather than implied by styling: the
 * strap beneath says what wrote it and which period it describes. A reader
 * should never have to guess whether a machine wrote a sentence.
 */

import { el, setAttr, setText, type View } from './dom';
import { narrate } from '../lib/narrate';
import { speaksOfNow, settlementOf, type AppState } from '../lib/state';

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
      const narration = narrate(state.grid, state.curtailment, present);

      if (!narration && state.pending) {
        setAttr(root, 'data-provenance', 'none');
        setText(body, 'Waiting for this half-hour’s readings.');
        setText(strap, 'Nothing is described until the sources have answered.');
        return;
      }

      if (!narration) {
        setAttr(root, 'data-provenance', 'none');
        setText(body, 'Nothing to describe: no reading arrived this half-hour.');
        setText(strap, 'Windfall is not reaching its data sources.');
        return;
      }

      const period = settlement?.period;
      setAttr(root, 'data-provenance', narration.provenance);
      setText(body, narration.text);
      setText(
        strap,
        narration.provenance === 'generated'
          ? `Written by Claude for settlement period ${period ?? '—'}.`
          : `Assembled from the figures above for settlement period ${period ?? '—'}. Not yet written by a model.`
      );
    },
  };
}
