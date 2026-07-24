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
import type { AppState } from '../lib/state';

const CONSTRAINED =
  'The transmission network between Scotland and England is full. Power that cannot ' +
  'flow south is paid to stop.';

const CLEAR =
  'The transmission network between Scotland and England has room this half-hour. ' +
  'What the north makes can travel south.';

const UNKNOWN =
  'The transmission network between Scotland and England is the limit on how much ' +
  'northern wind can reach southern demand.';

export function constraintView(): View {
  const body = el('p', { class: 'constraint__body' });
  const root = el(
    'div',
    { class: 'constraint', 'data-state': 'unknown', role: 'separator', 'aria-orientation': 'horizontal' },
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
      setAttr(root, 'data-state', constrained ? 'constrained' : 'clear');
      setText(body, constrained ? CONSTRAINED : CLEAR);
    },
  };
}
