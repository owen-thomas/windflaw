/**
 * The headline: Scottish wind instructed off the system.
 *
 * Resolves the open question in DECISIONS 006. Instantaneous MW carries the
 * typographic weight; settled MWh sits beneath it in a single line. The
 * reasons are that MW is the only figure that is honest at every moment
 * inside a settlement period, and that it shares a clock with the generation
 * mix directly above it. MWh stays on screen because energy is what the
 * money is paid against, but it is a supporting reading, not the headline.
 *
 * Both figures are floors and the eyebrow says so before either is read
 * (DECISIONS 003). "At least" is part of the claim, not a footnote.
 */

import { clear, el, setAttr, setText, setTextCrossfade, type View } from './dom';
import { formatMW, formatMWh, formatPct, formatPeriodSpan, joinList } from '../lib/format';
import type { CurtailedUnit, CurtailmentResponse } from '../lib/types';
import { speaksOfNow, type AppState } from '../lib/state';

/** Farms below this share of the headline are folded into "and others". */
const NAMED_FARMS = 4;

export function headlineView(): View {
  const eyebrow = el('p', { class: 'headline__eyebrow' });
  const figure = el('strong', { class: 'headline__figure' });
  const predicate = el('p', { class: 'headline__predicate' });

  const shareFill = el('div', { class: 'share__fill' });
  const shareBar = el('div', { class: 'share', 'aria-hidden': 'true' }, shareFill);
  const shareNote = el('p', { class: 'share__note' });

  const farms = el('p', { class: 'headline__farms' });
  const settled = el('p', { class: 'headline__settled' });

  // The claim carries the weight; the evidence sits beside it on the same
  // baseline, which keeps the whole paradox chain inside one screen.
  const root = el(
    'section',
    { class: 'headline', 'data-state': 'ok', 'aria-labelledby': 'headline-figure' },
    el(
      'div',
      { class: 'headline__claim' },
      eyebrow,
      el('p', { class: 'headline__line' }, figure),
      predicate
    ),
    el('div', { class: 'headline__evidence' }, shareBar, shareNote, farms, settled)
  );
  figure.id = 'headline-figure';

  return {
    el: root,
    update(state: AppState) {
      const data = state.curtailment;
      const present = speaksOfNow(data?.fetchedAt, data?.now?.settlement, state.now);

      if (!data?.now && state.pending) {
        setAttr(root, 'data-state', 'pending');
        setText(eyebrow, 'Wind switched off');
        setTextCrossfade(figure, 'Reading');
        setTextCrossfade(
          predicate,
          'Windflaw is asking Elexon what is being held down this half-hour. Nothing is ' +
            'claimed until it answers.'
        );
        shareFill.style.width = '0%';
        setText(shareNote, '');
        setText(farms, '');
        setText(settled, '');
        return;
      }

      if (!data || !data.now) {
        setAttr(root, 'data-state', 'failed');
        setText(eyebrow, 'Wind switched off');
        setTextCrossfade(figure, 'Unavailable');
        setTextCrossfade(
          predicate,
          state.curtailmentError
            ? 'Windflaw could not reach its own reading of the balancing mechanism.'
            : 'Elexon’s balancing data did not answer this time. The generation mix above is unaffected.'
        );
        shareFill.style.width = '0%';
        setText(shareNote, '');
        setText(farms, '');
        setText(settled, settledLine(data));
        return;
      }

      const { curtailedMW, units } = data.now;

      if (curtailedMW <= 0) {
        setAttr(root, 'data-state', 'none');
        setText(eyebrow, 'Right now');
        setTextCrossfade(figure, 'None');
        setTextCrossfade(
          predicate,
          present
            ? 'of Scotland’s tracked wind is being instructed off. The network is carrying what it makes.'
            : 'of Scotland’s tracked wind was being instructed off when this was last read.'
        );
        shareFill.style.width = '0%';
        setText(shareNote, `Nothing held down across ${data.method.unitsTracked} tracked units.`);
        setText(farms, '');
        setText(settled, settledLine(data));
        return;
      }

      setAttr(root, 'data-state', 'curtailing');
      setText(eyebrow, 'At least');
      setTextCrossfade(figure, formatMW(curtailedMW));
      // "Right now" is a claim with an expiry date. Once the reading is a
      // settlement period old it stops being true, and the tense has to move
      // with it — a colour change would not undo the word.
      setTextCrossfade(
        predicate,
        present
          ? 'of Scottish wind is being held off the grid, right now.'
          : 'of Scottish wind was being held off the grid when this was last read.'
      );

      const share = (curtailedMW / data.method.capacityMW) * 100;
      shareFill.style.width = `${Math.min(100, share)}%`;
      setText(
        shareNote,
        `${formatPct(share)} of the ${formatMW(data.method.capacityMW)} of Scottish wind Windflaw tracks.`
      );

      clear(farms);
      farms.append(...farmNodes(units));
      setText(settled, settledLine(data));
    },
  };
}

/** Roll units up to the farms people have heard of. */
function byFarm(units: CurtailedUnit[]): { farm: string; mw: number }[] {
  const totals = new Map<string, number>();
  for (const unit of units) {
    totals.set(unit.farm, (totals.get(unit.farm) ?? 0) + unit.curtailedMW);
  }
  return [...totals.entries()]
    .map(([farm, mw]) => ({ farm, mw }))
    .sort((a, b) => b.mw - a.mw);
}

function farmNodes(units: CurtailedUnit[]): Node[] {
  const farms = byFarm(units);
  if (farms.length === 0) return [];

  const named = farms.slice(0, NAMED_FARMS);
  const rest = farms.slice(NAMED_FARMS);
  const nodes: Node[] = [];

  named.forEach((entry, index) => {
    if (index > 0) nodes.push(el('span', { class: 'farms__sep', text: '·' }));
    nodes.push(
      el(
        'span',
        { class: 'farms__item' },
        el('span', { class: 'farms__name', text: entry.farm }),
        el('span', { class: 'farms__mw', text: formatMW(entry.mw) })
      )
    );
  });

  if (rest.length > 0) {
    nodes.push(el('span', { class: 'farms__sep', text: '·' }));
    // Name the remainder outright when it is short enough to read; only count
    // them once the list would run past the line.
    const names = rest.map((r) => r.farm);
    nodes.push(
      el('span', {
        class: 'farms__rest',
        text:
          names.length <= 3
            ? joinList(names)
            : `and ${names.length} more, ${joinList(names.slice(0, 2))} among them`,
      })
    );
  }
  return nodes;
}

/**
 * The second clock. Named as a completed period every time, so it can never
 * be mistaken for a figure that is still accumulating.
 */
function settledLine(data: CurtailmentResponse | null): string {
  if (!data?.settled) return '';
  const { curtailedMWh, settlement } = data.settled;
  const span = formatPeriodSpan(settlement.periodStart, settlement.periodEnd);
  if (curtailedMWh <= 0) return `Nothing in the last complete half-hour either, ${span}.`;
  return `${formatMWh(curtailedMWh)} over the last complete half-hour, ${span}.`;
}
