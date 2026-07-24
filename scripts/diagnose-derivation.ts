/**
 * Why does the phase 1 derivation return less than half the spike's figure?
 *
 * Three candidate causes, checked here rather than guessed at:
 *   A. The per-period PN endpoint returns fewer units than PN/stream, so
 *      phase 1 is simply missing data.
 *   B. Acceptances that span periods are tagged only to their start period,
 *      so per-period BOALF queries lose the tail of long instructions.
 *   C. The spike compared a full-period PN integral against a BOA integral
 *      covering only the instructed window — inflating every partial-period
 *      acceptance.
 */

import { SCOTTISH_WIND_SET } from '../api/_lib/bmus';
import { fetchBOALF, fetchPN, type BOALFItem, type PNItem } from '../api/_lib/elexon';
import { periodBounds } from '../src/lib/settlement';

const BASE = 'https://data.elexon.co.uk/bmrs/api/v1';
const DATE = '2026-06-20';
const NEXT = '2026-06-21';
const PROBE_PERIOD = 40;

async function streamPN(units: string[]): Promise<PNItem[]> {
  const params = new URLSearchParams({ from: DATE, to: NEXT });
  for (const u of units) params.append('bmUnit', u);
  const res = await fetch(`${BASE}/datasets/PN/stream?${params}`);
  return (await res.json()) as PNItem[];
}

async function checkA() {
  console.log('=== A. PN endpoint coverage ===');
  const perPeriod = await fetchPN(DATE, PROBE_PERIOD);
  const perPeriodUnits = new Set(perPeriod.map((i) => i.nationalGridBmUnit));

  const all = [...SCOTTISH_WIND_SET];
  let stream: PNItem[] = [];
  for (let i = 0; i < all.length; i += 10) {
    stream = stream.concat(await streamPN(all.slice(i, i + 10)));
  }
  const streamThisPeriod = stream.filter((i) => i.settlementPeriod === PROBE_PERIOD);
  const streamUnits = new Set(streamThisPeriod.map((i) => i.nationalGridBmUnit));

  console.log(`  per-period endpoint: ${perPeriod.length} items, ${perPeriodUnits.size} units`);
  console.log(`  stream endpoint:     ${streamThisPeriod.length} items, ${streamUnits.size} units`);
  const missing = [...streamUnits].filter((u) => !perPeriodUnits.has(u));
  const extra = [...perPeriodUnits].filter((u) => !streamUnits.has(u));
  console.log(`  in stream but not per-period: ${missing.length ? missing.join(', ') : 'none'}`);
  console.log(`  in per-period but not stream: ${extra.length ? extra.join(', ') : 'none'}`);
}

async function checkB() {
  console.log('\n=== B. Cross-period acceptance tagging ===');
  const boalf = await fetchBOALF(DATE, PROBE_PERIOD);
  const spans = boalf.filter((b) => b.settlementPeriodFrom !== b.settlementPeriodTo);
  console.log(`  period ${PROBE_PERIOD}: ${boalf.length} Scottish wind acceptances`);
  console.log(`  of which span multiple periods: ${spans.length}`);
  for (const s of spans.slice(0, 5)) {
    console.log(
      `    ${s.nationalGridBmUnit} acc ${s.acceptanceNumber} SP ${s.settlementPeriodFrom}→${s.settlementPeriodTo}  ${s.timeFrom} → ${s.timeTo}`
    );
  }
  // Does a spanning acceptance also come back when querying a later period?
  const spanning = spans[0];
  if (spanning && spanning.settlementPeriodTo > PROBE_PERIOD) {
    const later = await fetchBOALF(DATE, spanning.settlementPeriodTo);
    const found = later.some((b) => b.acceptanceNumber === spanning.acceptanceNumber);
    console.log(
      `  acceptance ${spanning.acceptanceNumber} visible when querying SP ${spanning.settlementPeriodTo}: ${found}`
    );
  }
}

async function checkC() {
  console.log('\n=== C. BOA time coverage within a period ===');
  const [pn, boalf] = await Promise.all([fetchPN(DATE, PROBE_PERIOD), fetchBOALF(DATE, PROBE_PERIOD)]);
  const { start, end } = periodBounds(DATE, PROBE_PERIOD);
  console.log(`  period window ${start.toISOString()} → ${end.toISOString()}`);

  const byUnit = new Map<string, BOALFItem[]>();
  for (const b of boalf) {
    const list = byUnit.get(b.nationalGridBmUnit) ?? [];
    list.push(b);
    byUnit.set(b.nationalGridBmUnit, list);
  }

  console.log(`\n  ${'unit'.padEnd(10)}${'BOA covers'.padStart(12)}${'PN covers'.padStart(12)}   spike-vs-phase1 (MWh)`);
  for (const [unit, items] of [...byUnit].slice(0, 8)) {
    const boaMinutes = coverageMinutes(items, start, end);
    const pnItems = pn.filter((p) => p.nationalGridBmUnit === unit);
    const pnMinutes = coverageMinutes(pnItems, start, end);

    // Spike method: full-period PN integral minus the winning acceptance's own integral.
    const pnMWh = energy(pnItems);
    const highest = Math.max(...items.map((i) => i.acceptanceNumber));
    const boaMWh = energy(items.filter((i) => i.acceptanceNumber === highest));
    const spikeDiff = boaMWh < pnMWh ? pnMWh - boaMWh : 0;

    console.log(
      `  ${unit.padEnd(10)}${(boaMinutes.toFixed(0) + ' min').padStart(12)}${(pnMinutes.toFixed(0) + ' min').padStart(12)}   spike ${spikeDiff.toFixed(1)}`
    );
  }
}

function coverageMinutes(
  segments: { timeFrom: string; timeTo: string }[],
  start: Date,
  end: Date
): number {
  let covered = 0;
  const step = 60_000;
  for (let t = start.getTime() + step / 2; t < end.getTime(); t += step) {
    if (segments.some((s) => t >= Date.parse(s.timeFrom) && t <= Date.parse(s.timeTo))) covered += 1;
  }
  return covered;
}

function energy(segments: { timeFrom: string; timeTo: string; levelFrom: number; levelTo: number }[]): number {
  let total = 0;
  for (const s of segments) {
    const hours = (Date.parse(s.timeTo) - Date.parse(s.timeFrom)) / 3_600_000;
    if (hours <= 0) continue;
    total += ((s.levelFrom + s.levelTo) / 2) * hours;
  }
  return total;
}

async function main() {
  await checkA();
  await checkB();
  await checkC();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
