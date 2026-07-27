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
 *
 * Switching used to reload the page (`location.search = …`), which meant no
 * transition between states was ever observable — including the ones this
 * toggle exists to demonstrate. It now switches in place, so `setActive`
 * updates the pressed button without rebuilding the toggle itself.
 */

import { el } from './dom';
import { SCENARIOS } from '../lib/scenarios';

export interface ToggleView {
  el: HTMLElement;
  setActive(name: string): void;
}

export function toggleView(current: string, onSelect: (name: string) => void): ToggleView {
  const note = el('p', { class: 'toggle__note' });

  const buttons = new Map<string, HTMLButtonElement>();
  const buttonEls = SCENARIOS.map((scenario) => {
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
    buttons.set(scenario.name, button);
    return button;
  });

  const active = SCENARIOS.find((s) => s.name === current) ?? SCENARIOS[0];
  note.textContent = active.note;

  const root = el(
    'aside',
    { class: 'toggle', role: 'group', 'aria-label': 'Preview state' },
    el('p', { class: 'toggle__label', text: 'State' }),
    el('div', { class: 'toggle__row' }, ...buttonEls),
    note
  );

  return {
    el: root,
    setActive(name: string) {
      for (const [scenarioName, button] of buttons) {
        button.dataset.active = scenarioName === name ? 'true' : 'false';
      }
      const scenario = SCENARIOS.find((s) => s.name === name);
      if (scenario) note.textContent = scenario.note;
    },
  };
}
