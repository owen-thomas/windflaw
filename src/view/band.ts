/**
 * A region band: one place, one mix bar.
 *
 * North and south are drawn identically — same scale, same fuel sequence,
 * same type — so the only difference on screen is the data. That is the
 * argument: put the two bars one above the other and the fossil tail in the
 * south is visible before any number is read.
 *
 * Every segment exists from the start with a width of zero, so a fuel
 * appearing or vanishing is a width change rather than a node swap. The
 * phase 3 motion pass depends on that.
 */

import { el, setAttr, setText, type View } from './dom';
import { FUEL_ORDER, orderMix } from '../lib/fuels';
import { formatIntensity, formatPct, fuelLabel } from '../lib/format';
import type { RegionState, RegionalState } from '../lib/types';
import { speaksOfNow, type AppState } from '../lib/state';

export interface BandSpec {
  side: 'north' | 'south';
  eyebrow: string;
  /** The fuel this band's reading leads with. */
  lead: 'wind' | 'gas';
  /**
   * The caption asserts something about the constraint, so it has to follow
   * the constraint — including when the constraint is unreadable. On a calm
   * day the curtailment copy would simply be false; with Elexon down, both
   * the "held back" and the "coping" copy would be claims the page cannot
   * support. A screen that keeps asserting through its own outage is the
   * fastest way to lose a reader who is checking.
   */
  caption: {
    /** Present and past tense of the same claim; see DECISIONS 010. */
    constrained: { now: string; past: string };
    clear: { now: string; past: string };
    /** Tense-free: it describes the standing relation, not this half-hour. */
    unknown: string;
  };
  pick: (regions: RegionalState) => RegionState | null;
}

/**
 * A segment narrower than this cannot hold its own label without clipping at
 * the narrow end of the desktop range. Everything below it is still read in
 * full from the legend directly beneath the bar.
 */
const LABEL_THRESHOLD_PCT = 12;

export function bandView(spec: BandSpec): View {
  const place = el('h2', { class: 'band__place' });
  const reading = el('p', { class: 'band__reading' });
  const leadFigure = el('span', { class: 'band__lead' });
  const intensity = el('span', { class: 'band__intensity' });
  reading.append(leadFigure, el('span', { class: 'band__sep', text: '·' }), intensity);

  const segments = new Map<string, { seg: HTMLElement; label: HTMLElement }>();
  const bar = el('div', { class: 'mix', 'aria-hidden': 'true' });
  for (const fuel of FUEL_ORDER) {
    const label = el('span', { class: 'mix__label' });
    const seg = el('div', { class: 'mix__seg', 'data-fuel': fuel, style: 'flex-basis:0%' }, label);
    segments.set(fuel, { seg, label });
    bar.append(seg);
  }

  // The accessible reading of the bar: the same numbers as text.
  const legend = el('dl', { class: 'legend' });

  const note = el('p', { class: 'band__caption' });
  const foot = el('div', { class: 'band__foot' }, legend, note);

  const root = el(
    'section',
    { class: 'band', 'data-side': spec.side, 'data-state': 'ok' },
    el(
      'div',
      { class: 'band__head' },
      el(
        'div',
        { class: 'band__id' },
        el('p', { class: 'eyebrow', text: spec.eyebrow }),
        place
      ),
      reading
    ),
    bar,
    foot
  );

  return {
    el: root,
    update(state: AppState) {
      const region = state.grid?.regions ? spec.pick(state.grid.regions) : null;
      const now = state.curtailment?.now;
      if (!now) {
        setText(note, spec.caption.unknown);
      } else {
        const tense = speaksOfNow(state.curtailment?.fetchedAt, now.settlement, state.now)
          ? 'now'
          : 'past';
        setText(note, spec.caption[now.curtailedMW > 0 ? 'constrained' : 'clear'][tense]);
      }

      if (!region && state.pending) {
        setAttr(root, 'data-state', 'pending');
        setText(place, spec.side === 'north' ? 'Scotland' : 'South England');
        setText(leadFigure, 'Reading');
        setText(intensity, 'Waiting for Carbon Intensity');
        for (const { seg, label } of segments.values()) {
          seg.style.flexBasis = '0%';
          setText(label, '');
        }
        legend.replaceChildren();
        setAttr(foot, 'data-empty', 'true');
        return;
      }

      if (!region) {
        setAttr(root, 'data-state', 'failed');
        setText(place, spec.side === 'north' ? 'Scotland' : 'South England');
        setText(leadFigure, 'No reading');
        setText(intensity, 'Carbon Intensity unavailable');
        for (const { seg, label } of segments.values()) {
          seg.style.flexBasis = '0%';
          setText(label, '');
        }
        legend.replaceChildren();
        setAttr(foot, 'data-empty', 'true');
        return;
      }
      setAttr(foot, 'data-empty', null);

      setAttr(root, 'data-state', 'ok');
      setText(place, region.name);
      const leadPct = spec.lead === 'wind' ? region.windPct : region.gasPct;
      setText(leadFigure, `${formatPct(leadPct)} ${spec.lead}`);
      setText(intensity, formatIntensity(region.intensity.forecast ?? region.intensity.actual));

      const mix = orderMix(region.generationMix);
      for (const { fuel, perc } of mix) {
        const entry = segments.get(fuel);
        if (!entry) continue;
        entry.seg.style.flexBasis = `${perc}%`;
        setAttr(entry.seg, 'data-empty', perc === 0 ? 'true' : null);
        setText(entry.label, perc >= LABEL_THRESHOLD_PCT ? `${fuelLabel(fuel)} ${formatPct(perc)}` : '');
      }

      legend.replaceChildren(
        ...mix
          .filter((f) => f.perc > 0)
          .map((f) =>
            el(
              'div',
              { class: 'legend__item' },
              el('dt', { 'data-fuel': f.fuel }, el('span', { class: 'legend__swatch' }), fuelLabel(f.fuel)),
              el('dd', { text: formatPct(f.perc) })
            )
          )
      );
    },
  };
}

export const NORTH: BandSpec = {
  side: 'north',
  eyebrow: 'The wind is here',
  lead: 'wind',
  caption: {
    constrained: {
      now: 'Scotland is generating more than it can use, and more than the network can carry away.',
      past: 'Scotland was generating more than it could use, and more than the network could carry away.',
    },
    clear: {
      now: 'Scotland is generating less than the network south of it can carry.',
      past: 'Scotland was generating less than the network south of it could carry.',
    },
    unknown: 'How much of this reaches the south cannot be read this half-hour.',
  },
  pick: (r) => r.scotland ?? r.northScotland,
};

export const SOUTH: BandSpec = {
  side: 'south',
  eyebrow: 'The demand is here',
  lead: 'gas',
  caption: {
    constrained: {
      now: 'With the northern wind held back, gas plants in the south make up the difference.',
      past: 'With the northern wind held back, gas plants in the south made up the difference.',
    },
    clear: {
      now: 'Southern demand is being met close to home, largely by gas.',
      past: 'Southern demand was being met close to home, largely by gas.',
    },
    unknown: 'Southern demand leans on gas whenever northern wind cannot reach it.',
  },
  pick: (r) => r.southEngland ?? r.southEastEngland,
};
