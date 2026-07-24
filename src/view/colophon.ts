/**
 * Method and sources.
 *
 * The method note is a designed element rather than small print (DECISIONS
 * 003): the headline figure is deliberately conservative, and a reader who
 * has seen a larger number elsewhere needs to find out why here rather than
 * conclude Windfall is wrong. It sits closed by default and one click away.
 *
 * Source health is stated in words next to a mark, never by colour alone.
 */

import { el, setAttr, setText, type View } from './dom';
import type { SourceHealth } from '../lib/types';
import type { AppState } from '../lib/state';

const HEALTH_WORD: Record<SourceHealth | 'unreachable', string> = {
  ok: 'answering',
  partial: 'partly answering',
  failed: 'not answering',
  unreachable: 'unreachable',
};

interface SourceRow {
  row: HTMLElement;
  status: HTMLElement;
}

function sourceRow(name: string, detail: string): SourceRow {
  const status = el('span', { class: 'source__status' });
  const row = el(
    'div',
    { class: 'source', 'data-health': 'ok' },
    el('span', { class: 'source__mark', 'aria-hidden': 'true' }),
    el(
      'span',
      { class: 'source__id' },
      el('span', { class: 'source__name', text: name }),
      el('span', { class: 'source__detail', text: detail })
    ),
    status
  );
  return { row, status };
}

export function colophonView(): View {
  const carbon = sourceRow('Carbon Intensity', 'NESO · mix, regions, forecast');
  const elexon = sourceRow('Elexon Insights', 'BMRS · declarations and acceptances');

  const basis = el('p', { class: 'method__basis' });
  const coverage = el('p', { class: 'method__coverage' });

  const root = el(
    'footer',
    { class: 'colophon' },
    el(
      'details',
      { class: 'method' },
      el('summary', { class: 'method__summary', text: 'How this number is worked out' }),
      basis,
      coverage,
      el('p', {
        class: 'method__floor',
        text:
          'Published figures for curtailment are often larger. Windfall counts only instructed ' +
          'turn-downs — wind the grid actively paid to switch off — which is a floor: real ' +
          'curtailment is higher, and this figure will never overstate it.',
      }),
      el('p', {
        class: 'method__check',
        text:
          'Checked against the Wind Curtailment Monitor, an independent tracker reading the ' +
          'same balancing data, Windfall agrees to within about 1% on most days.',
      })
    ),
    el(
      'div',
      { class: 'sources' },
      carbon.row,
      elexon.row,
      el('p', {
        class: 'colophon__byline',
        text: 'Windfall · built by Owen Thomas · figures are lower bounds',
      })
    )
  );

  return {
    el: root,
    update(state: AppState) {
      const method = state.curtailment?.method;
      setText(
        basis,
        method?.basis ??
          'Instructed turn-downs of transmission-connected Scottish wind via the balancing mechanism.'
      );
      setText(
        coverage,
        method
          ? `Tracking ${method.unitsTracked} transmission-connected Scottish wind units, ` +
              `${Math.round(method.capacityMW).toLocaleString('en-GB')} MW of registered capacity.`
          : 'Coverage unknown while the balancing feed is unavailable.'
      );

      const gridHealth: SourceHealth | 'unreachable' = state.gridError
        ? 'unreachable'
        : (state.grid?.health.overall ?? 'unreachable');
      const curtailmentHealth: SourceHealth | 'unreachable' = state.curtailmentError
        ? 'unreachable'
        : (state.curtailment?.health.overall ?? 'unreachable');

      setAttr(carbon.row, 'data-health', gridHealth);
      setText(carbon.status, HEALTH_WORD[gridHealth]);
      setAttr(elexon.row, 'data-health', curtailmentHealth);
      setText(elexon.status, HEALTH_WORD[curtailmentHealth]);
    },
  };
}
