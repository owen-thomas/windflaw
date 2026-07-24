/**
 * Masthead: the product's name, its claim, and the clock that claim runs on.
 *
 * The clock is doing real work. "Live" is a word the product cannot honestly
 * use on its own — the data moves in half-hours and can be minutes old before
 * it arrives — so the masthead always states which settlement period is on
 * screen, and how old the reading is, in the same breath as the title.
 */

import { el, setAttr, setText, type View } from './dom';
import { formatAge, formatPeriodSpan } from '../lib/format';
import { overallAge, type AppState } from '../lib/state';

const STANDFIRST =
  'What Britain’s grid is doing right now, and how much Scottish wind is being ' +
  'switched off while it happens.';

export function mastheadView(): View {
  const period = el('span', { class: 'clock__period' });
  const span = el('span', { class: 'clock__span' });
  const age = el('span', { class: 'clock__age' });

  /*
   * The second line of the masthead is a slot, not a fixed standfirst. When
   * the reading goes stale the notice takes the place of the strapline: a
   * returning visitor does not need the product explained, and a screen
   * carrying a 47-minute-old figure needs to say so above the fold rather
   * than in a colour change. Swapping rather than adding also keeps the
   * composition to one screen in every state.
   */
  const note = el('p', { class: 'standfirst', 'data-role': 'standfirst', text: STANDFIRST });

  const clock = el(
    'div',
    { class: 'clock', 'data-freshness': 'fresh' },
    period,
    span,
    age
  );

  const root = el(
    'header',
    { class: 'masthead' },
    el(
      'div',
      { class: 'masthead__id' },
      el('h1', { class: 'wordmark', text: 'Windfall' }),
      note
    ),
    clock
  );

  return {
    el: root,
    update(state: AppState) {
      const settlement = state.grid?.settlement ?? state.curtailment?.now?.settlement ?? null;

      if (settlement) {
        setText(period, `Settlement period ${settlement.period}`);
        setText(span, formatPeriodSpan(settlement.periodStart, settlement.periodEnd));
      } else {
        setText(period, 'Settlement period unknown');
        setText(span, '—');
      }

      const reading = overallAge(state);
      if (!reading) {
        setText(age, 'No reading');
        setAttr(clock, 'data-freshness', 'failed');
        setAttr(note, 'data-role', 'warning');
        setText(
          note,
          'Windfall is not reaching its data sources. Nothing on this page is current.'
        );
        return;
      }

      setAttr(clock, 'data-freshness', reading.freshness);
      setText(
        age,
        reading.freshness === 'stale'
          ? `Last read ${formatAge(reading.ms)}`
          : `Read ${formatAge(reading.ms)}`
      );

      if (reading.freshness === 'stale') {
        setAttr(note, 'data-role', 'warning');
        // Named by period rather than by position: the clock moves below the
        // notice at narrow widths, and "to the right" would then be wrong.
        setText(
          note,
          `This reading is ${formatAge(reading.ms).replace(' ago', ' old')}. The figures below ` +
            (settlement
              ? `describe settlement period ${settlement.period}, not the one now running.`
              : 'describe an earlier settlement period, not the one now running.')
        );
      } else {
        setAttr(note, 'data-role', 'standfirst');
        setText(note, STANDFIRST);
      }
    },
  };
}
