/**
 * Boot.
 *
 * Two clocks run here, deliberately separate. The render clock ticks every
 * few seconds so "read four minutes ago" stops being a lie the moment it is
 * printed; the fetch clock is slow, because the data underneath moves in
 * half-hours and the responses are CDN-cached anyway.
 *
 * A failed refetch never clears what is on screen. The previous payload
 * stays, its age keeps climbing, and the staleness treatment does the
 * explaining — which is the behaviour section 5.4 of the plan asks for.
 */

import '@fontsource-variable/dm-sans';
import './styles/tokens.css';
import './styles/app.css';

import { fetchFeeds } from './lib/client';
import { scenarioByName, SCENARIOS } from './lib/scenarios';
import { emptyFeeds, type AppState } from './lib/state';
import { screenView } from './view/screen';
import { toggleView } from './view/toggle';

/** How often the displayed age is recomputed. */
const TICK_MS = 15_000;
/** How often the feeds are refetched. Well inside a settlement period. */
const REFETCH_MS = 120_000;

const app = document.querySelector<HTMLDivElement>('#app')!;

const params = new URLSearchParams(location.search);
const scenarioName = scenarioByName(params.get('state')).name;
const showToggle = params.has('dev') || params.has('state') || import.meta.env.DEV;

const state: AppState = {
  ...emptyFeeds(),
  now: new Date(),
  scenario: scenarioName,
  pending: true,
};

const screen = screenView();
app.replaceChildren(screen.el);

if (showToggle) {
  app.append(
    toggleView(scenarioName, (name) => {
      const next = new URLSearchParams(location.search);
      if (name === 'live') next.delete('state');
      else next.set('state', name);
      next.set('dev', '1');
      location.search = next.toString();
    })
  );
}

function render() {
  state.now = new Date();
  screen.update(state);
}

async function refresh() {
  const scenario = scenarioByName(state.scenario);

  if (scenario.build) {
    Object.assign(state, scenario.build(new Date()));
    state.pending = scenario.pending ?? false;
    render();
    return;
  }

  try {
    const feeds = await fetchFeeds();
    // Keep the last good payload when a feed fails; only the error is new.
    if (feeds.grid) state.grid = feeds.grid;
    state.gridError = feeds.gridError;
    if (feeds.curtailment) state.curtailment = feeds.curtailment;
    state.curtailmentError = feeds.curtailmentError;
    if (feeds.narration) state.narration = feeds.narration;
    state.narrationError = feeds.narrationError;
  } finally {
    // The first attempt has now happened, whatever it returned. Everything
    // after this point may honestly be described as tried.
    state.pending = false;
    render();
  }
}

render();
// `boot` marks the first resolved fetch, not the first paint: capture work
// and any future gating want the answered page, not the asking one.
void refresh().then(() => {
  app.dataset.boot = 'ready';
});

setInterval(render, TICK_MS);
setInterval(() => void refresh(), REFETCH_MS);

if (import.meta.env.DEV) {
  // Convenience for capture work: cycle states from the keyboard.
  addEventListener('keydown', (event) => {
    if (event.key !== ']' && event.key !== '[') return;
    const index = SCENARIOS.findIndex((s) => s.name === state.scenario);
    const step = event.key === ']' ? 1 : -1;
    const next = SCENARIOS[(index + step + SCENARIOS.length) % SCENARIOS.length];
    const search = new URLSearchParams(location.search);
    if (next.name === 'live') search.delete('state');
    else search.set('state', next.name);
    search.set('dev', '1');
    location.search = search.toString();
  });
}
