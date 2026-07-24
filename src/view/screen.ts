/**
 * The screen.
 *
 * Composition, top to bottom, is the paradox chain from the project plan
 * read as geography: what the north makes, how much of it is switched off,
 * why it cannot travel, and what burns in the south instead. The page is a
 * north–south section through Britain rather than a grid of panels, which is
 * what keeps it a single argument rather than a dashboard.
 *
 * The headline sits at the foot of the north band, immediately above the
 * constraint, because it is the consequence of the line below it.
 */

import { el, type View } from './dom';
import { bandView, NORTH, SOUTH } from './band';
import { colophonView } from './colophon';
import { constraintView } from './constraint';
import { headlineView } from './headline';
import { mastheadView } from './masthead';
import { narrationView } from './narration';
import type { AppState } from '../lib/state';

export function screenView(): View {
  const masthead = mastheadView();
  const north = bandView(NORTH);
  const headline = headlineView();
  const constraint = constraintView();
  const south = bandView(SOUTH);
  const narration = narrationView();
  const colophon = colophonView();

  const views = [masthead, north, headline, constraint, south, narration, colophon];

  const root = el(
    'div',
    { class: 'screen' },
    masthead.el,
    el('main', { class: 'paradox' }, north.el, headline.el, constraint.el, south.el),
    narration.el,
    colophon.el
  );

  return {
    el: root,
    update(state: AppState) {
      for (const view of views) view.update(state);
    },
  };
}
