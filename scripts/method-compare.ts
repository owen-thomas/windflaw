/**
 * Quantify the phase 1 derivation against the phase 0 spike baseline.
 *
 * The spike validated 24.25 GWh for 20 June 2026 using whole-period energy
 * totals and a single winning acceptance per period. Phase 1 refines both:
 * acceptance precedence is resolved per instant, and shortfalls are clamped
 * at zero per sample so over-instruction cannot net off curtailment.
 *
 * This script runs the new derivation over the same day so the difference is
 * a measured number rather than an assumption. Feeds DECISIONS.md 007 and the
 * de Berker cross-check.
 */

import { deriveSettled, fetchBOALF, fetchPN } from '../api/_lib/elexon';
import { periodBounds, periodsInDay } from '../src/lib/settlement';

const DATE = '2026-06-20';
const SPIKE_BASELINE_GWH = 24.25;
const TRACKER_GWH = 56.45;
const CONCURRENCY = 6;

async function periodTotal(period: number) {
  const [pn, boalf] = await Promise.all([fetchPN(DATE, period), fetchBOALF(DATE, period)]);
  const { start, end } = periodBounds(DATE, period);
  const derived = deriveSettled(pn, boalf, start, end);
  return { period, ...derived };
}

async function main() {
  const total = periodsInDay(DATE);
  console.log(`Re-deriving ${DATE} across ${total} settlement periods`);
  console.log(`Spike baseline: ${SPIKE_BASELINE_GWH} GWh | Tracker: ${TRACKER_GWH} GWh\n`);

  const periods = Array.from({ length: total }, (_, i) => i + 1);
  const results: Awaited<ReturnType<typeof periodTotal>>[] = [];

  for (let i = 0; i < periods.length; i += CONCURRENCY) {
    const batch = periods.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(batch.map(periodTotal));
    results.push(...settled);
    process.stdout.write(
      `  periods ${batch[0]}–${batch[batch.length - 1]}: ` +
        `${settled.reduce((s, r) => s + r.curtailedMWh, 0).toFixed(0)} MWh\n`
    );
  }

  const totalMWh = results.reduce((sum, r) => sum + r.curtailedMWh, 0);
  const totalGWh = totalMWh / 1000;

  const byFarm = new Map<string, number>();
  for (const r of results) {
    for (const f of r.farms) byFarm.set(f.name, (byFarm.get(f.name) ?? 0) + f.curtailedMWh);
  }

  console.log('\n=== BY FARM ===');
  for (const [farm, mwh] of [...byFarm.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${farm.padEnd(22)} ${(mwh / 1000).toFixed(2).padStart(7)} GWh`);
  }

  console.log('\n' + '='.repeat(56));
  console.log(`Phase 1 derivation:  ${totalGWh.toFixed(2)} GWh`);
  console.log(`Phase 0 spike:       ${SPIKE_BASELINE_GWH.toFixed(2)} GWh   (ratio ${(totalGWh / SPIKE_BASELINE_GWH).toFixed(3)}x)`);
  console.log(`Public tracker:      ${TRACKER_GWH.toFixed(2)} GWh   (ratio ${(totalGWh / TRACKER_GWH).toFixed(3)}x)`);
  console.log(`Periods with curtailment: ${results.filter((r) => r.curtailedMWh > 0).length} / ${total}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
