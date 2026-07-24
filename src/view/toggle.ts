/**
 * The state switcher.
 *
 * Phase 1 has to make five states reachable, four of which the grid will not
 * produce on request. It ships in the production build rather than dev only,
 * because the case study capture should come from the deployed artefact.
 *
 * It stays out of the way: hidden until ?dev=1 or ?state=… is present, and
 * excluded from the accessible reading of the page, since it is scaffolding
 * rather than part of the argument.
 */

import { el } from './dom';
import { SCENARIOS } from '../lib/scenarios';

export function toggleView(current: string, onSelect: (name: string) => void): HTMLElement {
  const note = el('p', { class: 'toggle__note' });

  const buttons = SCENARIOS.map((scenario) => {
    const button = el('button', {
      type: 'button',
      class: 'toggle__button',
      'data-active': scenario.name === current ? 'true' : 'false',
      text: scenario.label,
    });
    button.addEventListener('click', () => onSelect(scenario.name));
    button.addEventListener('pointerenter', () => {
      note.textContent = scenario.note;
    });
    return button;
  });

  const active = SCENARIOS.find((s) => s.name === current) ?? SCENARIOS[0];
  note.textContent = active.note;

  return el(
    'aside',
    { class: 'toggle', role: 'group', 'aria-label': 'Preview state' },
    el('p', { class: 'toggle__label', text: 'State' }),
    el('div', { class: 'toggle__row' }, ...buttons),
    note
  );
}
