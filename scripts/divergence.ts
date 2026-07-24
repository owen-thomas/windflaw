/**
 * Why Windfall and the Wind Curtailment Monitor disagree on some days.
 *
 * The cross-check (scripts/cross-check.ts) found agreement to 1% on two of
 * four days, but Windfall 29% *above* the monitor on a quiet day and 13%
 * below it on a heavily constrained one. Two divergences in opposite
 * directions cannot share one cause, so this tests the candidates separately.
 *
 * Being *higher* is the informative case. The monitor covers more units than
 * Windfall's 50 Scottish ones, so a scope difference can only push the
 * monitor's figure up, never down. Something must be counted by Windfall and
 * not by them.
 *
 * Two hypotheses, both measurable here:
 *
 *   1. The zero-clamp (DECISIONS 007). Windfall clamps each sample at zero so
 *      over-instruction cannot net off curtailment; the monitor's methodology
 *      describes a signed "curtailment or redespatching level". If that is the
 *      difference, netting should move Windfall toward the monitor.
 *
 *   2. The SO flag. Acceptances carry a system-operator flag distinguishing
 *      actions taken for system reasons — constraints — from energy balancing.
 *      The monitor reports wind "discarded due to transmission constraints".
 *      Windfall counts every acceptance regardless of flag. On a quiet day,
 *      non-constraint balancing is a larger share of a smaller total, which
 *      would inflate Windfall exactly where it is observed to be inflated.
 *
 * Neither production behaviour changes on the strength of this script; it
 * exists to make the method note's claims testable.
 */

import {
  deriveSettled,
  fetchBOALF,
  fetchPN,
  instructedLevelAt,
  levelAt,
  type BOALFItem,
  type PNItem,
} from '../api/_lib/elexon';
import { periodBounds, periodsInDay } from '../src/lib/settlement';

const MONITOR_GWH: Record<string, number> = {
  '2026-06-13': 58.5,
  '2026-06-20': 23.5,
  '2026-07-18': 10.9,
  '2026-07-23': 7.2,
};

const CONCURRENCY = 6;
const SAMPLE_MINUTES = 1;

function groupByUnit<T extends { nationalGridBmUnit: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const existing = grouped.get(item.nationalGridBmUnit);
    if (existing) existing.push(item);
    else grouped.set(item.nationalGridBmUnit, [item]);
  }
  return grouped;
}

/**
 * Energy by which units were instructed *above* their declaration — the
 * quantity the clamp discards. Same sampling and precedence rules as
 * `deriveSettled`, so the only difference is that the sign is kept.
 */
function overInstructedMWh(pn: PNItem[], boalf: BOALFItem[], start: Date, end: Date): number {
  const pnByUnit = groupByUnit(pn);
  const boaByUnit = groupByUnit(boalf);
  const stepMs = SAMPLE_MINUTES * 60_000;
  const stepHours = SAMPLE_MINUTES / 60;
  let mwh = 0;

  for (const [id, acceptances] of boaByUnit) {
    const declaredSegments = pnByUnit.get(id) ?? [];
    if (declaredSegments.length === 0) continue;

    for (let t = start.getTime() + stepMs / 2; t < end.getTime(); t += stepMs) {
      const declared = levelAt(declaredSegments, t);
      if (declared === null) continue;
      const instructed = instructedLevelAt(acceptances, t);
      if (instructed === null || instructed <= declared) continue;
      mwh += (instructed - declared) * stepHours;
    }
  }

  return mwh;
}

async function periodFigures(date: string, period: number) {
  const [pn, boalf] = await Promise.all([fetchPN(date, period), fetchBOALF(date, period)]);
  const { start, end } = periodBounds(date, period);
  return {
    all: deriveSettled(pn, boalf, start, end).curtailedMWh,
    // Production code, given only the system-operator acceptances.
    soOnly: deriveSettled(
      pn,
      boalf.filter((i) => i.soFlag),
      start,
      end
    ).curtailedMWh,
    over: overInstructedMWh(pn, boalf, start, end),
  };
}

async function main() {
  console.log('Divergence from the Wind Curtailment Monitor, by cause\n');
  console.log('date            all   over-inst    SO-only   monitor   all/mon   SO/mon');
  console.log('-'.repeat(76));

  for (const date of Object.keys(MONITOR_GWH)) {
    const total = periodsInDay(date);
    const periods = Array.from({ length: total }, (_, i) => i + 1);
    let all = 0;
    let soOnly = 0;
    let over = 0;

    for (let i = 0; i < periods.length; i += CONCURRENCY) {
      const batch = periods.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((p) => periodFigures(date, p)));
      for (const r of results) {
        all += r.all;
        soOnly += r.soOnly;
        over += r.over;
      }
    }

    const monitor = MONITOR_GWH[date];
    const allGWh = all / 1000;
    const soGWh = soOnly / 1000;

    console.log(
      `${date} ${allGWh.toFixed(2).padStart(7)} ${(over / 1000).toFixed(2).padStart(11)} ` +
        `${soGWh.toFixed(2).padStart(10)} ${monitor.toFixed(2).padStart(9)} ` +
        `${(allGWh / monitor).toFixed(3).padStart(9)}x ${(soGWh / monitor).toFixed(3).padStart(7)}x`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
