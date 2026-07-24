/**
 * Dump one unit's raw PN and BOALF for a slice of a day.
 *
 * Testing the hypothesis that BOALF records encode only the *ramp* between
 * levels, and that the instructed level then holds until the next acceptance —
 * which would mean both the spike method and the first phase 1 method are
 * reading the data wrong, in opposite directions.
 */

import { SCOTTISH_WIND_SET } from '../api/_lib/bmus';
import type { BOALFItem, PNItem } from '../api/_lib/elexon';

const BASE = 'https://data.elexon.co.uk/bmrs/api/v1';
const DATE = '2026-06-20';
const UNIT = process.argv[2] ?? 'MOWWO-2';
const SP_FROM = 38;
const SP_TO = 44;

async function main() {
  const pnRes = await fetch(`${BASE}/datasets/PN/stream?from=${DATE}&to=2026-06-21&bmUnit=${UNIT}`);
  const pn = ((await pnRes.json()) as PNItem[])
    .filter((p) => p.settlementPeriod >= SP_FROM && p.settlementPeriod <= SP_TO)
    .sort((a, b) => Date.parse(a.timeFrom) - Date.parse(b.timeFrom));

  const boaRes = await fetch(
    `${BASE}/datasets/BOALF?from=${DATE}&to=${DATE}&settlementPeriodFrom=${SP_FROM}&settlementPeriodTo=${SP_TO}`
  );
  const boaBody = (await boaRes.json()) as { data?: BOALFItem[] };
  const boa = (boaBody.data ?? [])
    .filter((b) => b.nationalGridBmUnit === UNIT && SCOTTISH_WIND_SET.has(b.nationalGridBmUnit))
    .sort((a, b) => Date.parse(a.timeFrom) - Date.parse(b.timeFrom));

  console.log(`Unit ${UNIT}, ${DATE}, SP ${SP_FROM}–${SP_TO}\n`);

  console.log('--- PN (declared) ---');
  console.log('  SP   from      to        levelFrom  levelTo');
  for (const p of pn) {
    console.log(
      `  ${String(p.settlementPeriod).padStart(2)}   ${hhmm(p.timeFrom)}     ${hhmm(p.timeTo)}     ${String(p.levelFrom).padStart(7)}  ${String(p.levelTo).padStart(7)}`
    );
  }

  console.log('\n--- BOALF (accepted) ---');
  console.log('  acc      SP range   from      to        levelFrom  levelTo   so');
  for (const b of boa) {
    console.log(
      `  ${String(b.acceptanceNumber).padStart(7)}  ${String(b.settlementPeriodFrom).padStart(2)}→${String(b.settlementPeriodTo).padStart(2)}      ` +
        `${hhmm(b.timeFrom)}     ${hhmm(b.timeTo)}     ${String(b.levelFrom).padStart(7)}  ${String(b.levelTo).padStart(7)}   ${b.soFlag ? 'Y' : 'n'}`
    );
  }

  // If the hold hypothesis is right, consecutive records from one acceptance
  // should chain: the levelTo of one is the levelFrom of the next.
  console.log('\n--- Grouped by acceptance ---');
  const byAcc = new Map<number, BOALFItem[]>();
  for (const b of boa) {
    const list = byAcc.get(b.acceptanceNumber) ?? [];
    list.push(b);
    byAcc.set(b.acceptanceNumber, list);
  }
  for (const [acc, items] of [...byAcc].sort((a, b) => a[0] - b[0])) {
    const first = items[0];
    const last = items[items.length - 1];
    console.log(
      `  acc ${acc}: ${items.length} segment(s), ${hhmm(first.timeFrom)}→${hhmm(last.timeTo)}, ` +
        `${first.levelFrom} → ${last.levelTo} MW, declared SP ${first.settlementPeriodFrom}→${first.settlementPeriodTo}`
    );
  }
}

function hhmm(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
