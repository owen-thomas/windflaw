/**
 * The constraint: the rule between north and south.
 *
 * Compositionally this is the hinge of the screen. Reading order down the
 * page is the paradox chain from the project plan — what Scotland makes,
 * what is switched off, why it cannot travel, what runs instead — so the
 * boundary has to be a real horizontal edge, not a heading.
 *
 * It is also where the phase 3 motion lands: flow marks running south and
 * stopping dead at this line.
 */

import { el, setAttr, setText, type View } from './dom';
import { speaksOfNow, type AppState } from '../lib/state';

/*
 * Both readings come in a present and a past tense. A stale or superseded
 * reading under a present-tense claim is wrong whatever colour the timestamp
 * is (DECISIONS 010), and “is full” is as much a claim about now as the
 * headline above it. The unknown copy needs no pair: it describes the
 * network's standing role rather than its state this half-hour.
 */
const CONSTRAINED = {
  now:
    'The transmission network between Scotland and England is full. Power that cannot ' +
    'flow south is paid to stop.',
  past:
    'The transmission network between Scotland and England was full when this was last ' +
    'read. Power that could not flow south was paid to stop.',
};

const CLEAR = {
  now:
    'The transmission network between Scotland and England has room this half-hour. ' +
    'What the north makes can travel south.',
  past:
    'The transmission network between Scotland and England had room when this was last ' +
    'read. What the north made could travel south.',
};

const UNKNOWN =
  'The transmission network between Scotland and England is the limit on how much ' +
  'northern wind can reach southern demand.';

export function constraintView(): View {
  const body = el('p', { class: 'constraint__body' });
  const root = el(
    'div',
    // Not role="separator": ARIA treats a non-focusable separator as
    // children-presentational, which would drop a link in the paradox chain
    // out of the accessible reading. It is a content block that happens to be
    // drawn with rules, and the rules themselves are already hidden.
    { class: 'constraint', 'data-state': 'unknown' },
    el('span', { class: 'constraint__rule', 'aria-hidden': 'true' }),
    el(
      'div',
      { class: 'constraint__text' },
      el('p', { class: 'eyebrow', text: 'The constraint' }),
      body
    ),
    el('span', { class: 'constraint__rule', 'aria-hidden': 'true' })
  );

  return {
    el: root,
    update(state: AppState) {
      const now = state.curtailment?.now;
      if (!now) {
        setAttr(root, 'data-state', 'unknown');
        setText(body, UNKNOWN);
        return;
      }
      const constrained = now.curtailedMW > 0;
      const tense = speaksOfNow(state.curtailment?.fetchedAt, now.settlement, state.now)
        ? 'now'
        : 'past';
      setAttr(root, 'data-state', constrained ? 'constrained' : 'clear');
      setText(body, constrained ? CONSTRAINED[tense] : CLEAR[tense]);
    },
  };
}
