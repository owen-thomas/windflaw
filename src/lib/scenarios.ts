/**
 * The state toggle.
 *
 * Phase 1 requires every state reachable without waiting for the grid to
 * produce it: a calm day with no curtailment cannot be summoned on demand,
 * and neither can an Elexon outage. Each scenario is the captured live
 * payload (sample.ts) bent into the shape of the state, then rebased so its
 * timestamps sit against the real clock — otherwise every fixture screen
 * would read as hours old and the staleness treatment could not be judged.
 *
 * Reachable as ?state=<name>. Kept in the production build deliberately: the
 * case study needs to capture these screens from the deployed artefact, not
 * from a dev server.
 */

import type { CurtailmentResponse, GridResponse } from './types';
import { previousPeriod, settlementAt } from './settlement';
import { SAMPLE_CURTAILMENT, SAMPLE_GRID } from './sample';
import { emptyFeeds, type Feeds } from './state';

export interface Scenario {
  name: string;
  label: string;
  /** What this state is for, shown in the toggle. */
  note: string;
  /** Null means fetch live. */
  build: ((now: Date) => Feeds) | null;
  /** Renders the page as it looks before the first fetch has answered. */
  pending?: true;
}

/** Move a captured payload's clocks onto the real settlement timeline. */
function rebase(now: Date, ageMs: number): { grid: GridResponse; curtailment: CurtailmentResponse } {
  const at = new Date(now.getTime() - ageMs);
  const current = settlementAt(at);
  const settled = previousPeriod(current);

  const grid = structuredClone(SAMPLE_GRID);
  grid.fetchedAt = at.toISOString();
  grid.settlement = current;

  const curtailment = structuredClone(SAMPLE_CURTAILMENT);
  curtailment.fetchedAt = at.toISOString();
  if (curtailment.now) {
    curtailment.now.settlement = current;
    curtailment.now.sampledAt = at.toISOString();
  }
  if (curtailment.settled) curtailment.settled.settlement = settled;

  return { grid, curtailment };
}

function feeds(grid: GridResponse | null, curtailment: CurtailmentResponse | null): Feeds {
  return { grid, gridError: null, curtailment, curtailmentError: null };
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'live',
    label: 'Live',
    note: 'Whatever the grid is actually doing.',
    build: null,
  },
  {
    name: 'curtailing',
    label: 'Curtailing',
    note: 'A windy evening: 1.8 GW held down, Scotland at 76% wind.',
    build: (now) => {
      const { grid, curtailment } = rebase(now, 0);
      return feeds(grid, curtailment);
    },
  },
  {
    name: 'calm',
    label: 'No curtailment',
    note: 'A still day. Nothing is being switched off — a first-class state.',
    build: (now) => {
      const { grid, curtailment } = rebase(now, 0);

      // Wind drops out of the mix, but not onto the same fuel everywhere.
      // Scotland has almost no gas plant: a still day there means imports,
      // nuclear and hydro, not a gas fleet that does not exist. Putting 60%
      // gas in Scotland would be a fixture that teaches the wrong thing to
      // anyone reviewing the state.
      const SCOTTISH_SINKS = { imports: 0.5, nuclear: 0.3, hydro: 0.2 };
      const SOUTHERN_SINKS = { gas: 0.7, imports: 0.3 };

      if (grid.regions) {
        for (const [key, region] of Object.entries(grid.regions)) {
          if (!region) continue;
          const scottish = key.toLowerCase().includes('scotland');
          becalm(region.generationMix, scottish ? SCOTTISH_SINKS : SOUTHERN_SINKS);
          region.windPct = pctOf(region.generationMix, 'wind');
          region.gasPct = pctOf(region.generationMix, 'gas');
          region.intensity = scottish
            ? { forecast: 68, actual: null, index: 'low' }
            : { forecast: 264, actual: null, index: 'high' };
        }
      }
      if (grid.national) {
        becalm(grid.national.generationMix, { gas: 0.6, imports: 0.4 });
        grid.national.windPct = pctOf(grid.national.generationMix, 'wind');
        grid.national.gasPct = pctOf(grid.national.generationMix, 'gas');
        grid.national.intensity = { forecast: 218, actual: 224, index: 'high' };
      }

      if (curtailment.now) {
        curtailment.now.curtailedMW = 0;
        curtailment.now.unitsCurtailed = 0;
        curtailment.now.units = [];
      }
      if (curtailment.settled) {
        curtailment.settled.curtailedMWh = 0;
        curtailment.settled.unitsCurtailed = 0;
        curtailment.settled.farms = [];
      }
      return feeds(grid, curtailment);
    },
  },
  {
    name: 'degraded',
    label: 'Degraded',
    note: 'Elexon is down. The mix still renders; curtailment owns its failure.',
    build: (now) => {
      const { grid, curtailment } = rebase(now, 0);
      curtailment.now = null;
      curtailment.settled = null;
      curtailment.health = { overall: 'failed', now: 'failed', settled: 'failed' };
      curtailment.errors = ['now: timeout after 8000ms for /balancing/physical'];
      return feeds(grid, curtailment);
    },
  },
  {
    name: 'stale',
    label: 'Stale',
    note: 'Nothing has refreshed for 47 minutes. A settlement period has passed.',
    build: (now) => {
      const { grid, curtailment } = rebase(now, 47 * 60 * 1000);
      return feeds(grid, curtailment);
    },
  },
  {
    name: 'waiting',
    label: 'Waiting',
    note: 'The first fetch has not answered yet. The page claims nothing.',
    build: () => emptyFeeds(),
    pending: true,
  },
  {
    name: 'offline',
    label: 'Offline',
    note: 'The client cannot reach its own functions. Nothing to degrade to.',
    build: () => ({
      grid: null,
      gridError: 'timed out',
      curtailment: null,
      curtailmentError: 'timed out',
    }),
  },
];

/** How much of the wind goes away on a still day. */
const BECALMED_SHARE = 0.82;

/** Take most of the wind out of a mix and hand it to the named fuels. */
function becalm(mix: { fuel: string; perc: number }[], sinks: Record<string, number>) {
  const wind = mix.find((f) => f.fuel === 'wind');
  if (!wind) return;

  const removed = round1(wind.perc * BECALMED_SHARE);
  wind.perc = round1(wind.perc - removed);

  for (const [fuel, weight] of Object.entries(sinks)) {
    const sink = mix.find((f) => f.fuel === fuel);
    if (sink) sink.perc = round1(sink.perc + removed * weight);
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function pctOf(mix: { fuel: string; perc: number }[], fuel: string): number {
  return mix.find((f) => f.fuel === fuel)?.perc ?? 0;
}

export function scenarioByName(name: string | null): Scenario {
  return SCENARIOS.find((s) => s.name === name) ?? SCENARIOS[0];
}
