/**
 * Where does a day's curtailment actually sit?
 *
 * For the 23 July outlier (DECISIONS 013): Windfall reads 9.26 GWh against
 * the Wind Curtailment Monitor's 7.20, and the excess of ~2 GWh has to be
 * something Windfall counts and the monitor does not. Localising it comes
 * before explaining it — a single farm, a single window of the day, and a
 * uniform spread each imply a different cause.
 *
 * Prints per-period and per-farm totals so the outlier day can be held
 * against a day that agreed.
 *
 *   npx tsx scripts/day-profile.ts 2026-07-23
 */

import { deriveSettled, fetchBOALF, fetchPN } from '../api/_lib/elexon';
import { periodBounds, periodsInDay } from '../src/lib/settlement';

const DATE = process.argv[2] ?? '2026-07-23';
const CONCURRENCY = 6;

async function periodTotal(date: string, period: number) {
  const [pn, boalf] = await Promise.all([fetchPN(date, period), fetchBOALF(date, period)]);
  const { start, end } = periodBounds(date, period);
  return { period, start, ...deriveSettled(pn, boalf, start, end) };
}

async function main() {
  const total = periodsInDay(DATE);
  const periods = Array.from({ length: total }, (_, i) => i + 1);
  const results: Awaited<ReturnType<typeof periodTotal>>[] = [];

  for (let i = 0; i < periods.length; i += CONCURRENCY) {
    const batch = periods.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch.map((p) => periodTotal(DATE, p)))));
  }

  const totalMWh = results.reduce((s, r) => s + r.curtailedMWh, 0);
  console.log(`${DATE} — ${(totalMWh / 1000).toFixed(2)} GWh across ${total} periods\n`);

  console.log('--- BY PERIOD (non-zero) ---');
  console.log('  SP  local      MWh   units');
  for (const r of results) {
    if (r.curtailedMWh <= 0) continue;
    const hhmm = r.start.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/London',
    });
    console.log(
      `  ${String(r.period).padStart(2)}  ${hhmm}  ${r.curtailedMWh.toFixed(1).padStart(7)}  ${String(r.unitsCurtailed).padStart(5)}`
    );
  }

  const byFarm = new Map<string, number>();
  for (const r of results) {
    for (const f of r.farms) byFarm.set(f.farm, (byFarm.get(f.farm) ?? 0) + f.curtailedMWh);
  }

  console.log('\n--- BY FARM ---');
  for (const [farm, mwh] of [...byFarm.entries()].sort((a, b) => b[1] - a[1])) {
    const share = (mwh / totalMWh) * 100;
    console.log(
      `  ${farm.padEnd(24)} ${(mwh / 1000).toFixed(3).padStart(7)} GWh  ${share.toFixed(1).padStart(5)}%`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
