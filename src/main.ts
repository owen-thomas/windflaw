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

import { fetchCoreFeeds, fetchNarration } from './lib/client';
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

const toggle = showToggle ? toggleView(scenarioName, selectScenario) : null;
if (toggle) app.append(toggle.el);

function render() {
  state.now = new Date();
  screen.update(state);
}

/**
 * Switches the scenario in place. This used to be `location.search = …`,
 * which reloaded the page — meaning no transition between states was ever
 * observable, including the ones the toggle exists to demonstrate
 * (rollover, curtailment engaging, the narration swap). Feeds are cleared
 * to empty-and-pending first so a switch reads as a fresh, honest arrival —
 * the same choreography a first-time visitor sees — rather than the
 * previous scenario's numbers sitting under the new scenario's chrome for a
 * frame.
 *
 * The URL still updates (`history.replaceState`, not a navigation), so a
 * link to `?state=curtailing` keeps working and a reload lands on the same
 * state.
 */
function selectScenario(name: string) {
  const next = new URLSearchParams(location.search);
  if (name === 'live') next.delete('state');
  else next.set('state', name);
  next.set('dev', '1');
  history.replaceState(null, '', `${location.pathname}?${next.toString()}`);

  Object.assign(state, emptyFeeds());
  state.scenario = name;
  state.pending = true;
  toggle?.setActive(name);
  render();
  void refresh();
}

async function refresh() {
  const scenario = scenarioByName(state.scenario);

  if (scenario.build) {
    Object.assign(state, scenario.build(new Date()));
    state.pending = scenario.pending ?? false;
    render();
    return;
  }

  // Core and narration resolve independently. Narration is, on a cache
  // miss, a live model call that can take several seconds (DECISIONS 018);
  // awaiting it alongside grid and curtailment would mean the first visitor
  // of every settlement period — the one whose request causes the
  // generation — waits longest for a screen that has nothing to do with the
  // model. The narration landing after the rest of the screen is not
  // deferred work here; it is the template-to-generated swap the narration
  // view already exists to show.
  const core = fetchCoreFeeds().then((feeds) => {
    // Keep the last good payload when a feed fails; only the error is new.
    if (feeds.grid) state.grid = feeds.grid;
    state.gridError = feeds.gridError;
    if (feeds.curtailment) state.curtailment = feeds.curtailment;
    state.curtailmentError = feeds.curtailmentError;
    // The first attempt has now happened, whatever it returned. Everything
    // after this point may honestly be described as tried.
    state.pending = false;
    render();
  });

  const narration = fetchNarration().then((feed) => {
    if (feed.narration) state.narration = feed.narration;
    state.narrationError = feed.narrationError;
    render();
  });

  await Promise.all([core, narration]);
}

render();
// `boot` marks the first resolved attempt at every feed, not the first
// paint: capture work and any future gating want the answered page, not the
// asking one.
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
    selectScenario(next.name);
  });
}
