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
import type { AppState } from '../lib/state';

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
      const narration = narrate(state.grid, state.curtailment);

      if (!narration) {
        setAttr(root, 'data-provenance', 'none');
        setText(body, 'Nothing to describe: no reading arrived this half-hour.');
        setText(strap, 'Windfall is not reaching its data sources.');
        return;
      }

      const period = state.grid?.settlement?.period ?? state.curtailment?.now?.settlement.period;
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
