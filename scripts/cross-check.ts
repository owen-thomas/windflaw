/**
 * Stream C — cross-check against another balancing-mechanism source.
 *
 * DECISIONS 002 left a gap unexplained: Windfall derives 23.75 GWh for
 * 20 June 2026 where a public tracker reports 56.45 GWh, a ratio of 0.42x.
 * The working hypothesis was that the tracker uses an availability-based
 * method (modelled available wind against metered output) while Windfall
 * measures instructed turn-downs through the balancing mechanism — two
 * different questions, so two different answers.
 *
 * A hypothesis about a method family needs a second member of the family to
 * test it. The Wind Curtailment Monitor (Dudfield and de Berker,
 * wind.axle.energy) publishes a daily figure derived from FPN and BOAL — the
 * same two datasets Windfall uses, per its published methodology. If Windfall
 * lands close to it across a range of days, the gap to the tracker is a
 * difference between method families rather than an error in ours.
 *
 * Reference figures below were read from the monitor's date picker on
 * 24 July 2026. It publishes to 0.1 GWh, which sets the floor on how tightly
 * any agreement here can be claimed.
 *
 * Deliberately not automated against their API: this is a one-off validation
 * feeding the method note, not a runtime dependency. Windfall must never need
 * another project to be up in order to render.
 */

import { deriveSettled, fetchBOALF, fetchPN } from '../api/_lib/elexon';
import { periodBounds, periodsInDay } from '../src/lib/settlement';

interface Reference {
  date: string;
  /** Wind Curtailment Monitor daily total, GWh. */
  monitorGWh: number;
  note: string;
}

/**
 * A spread from a near-calm day to a heavily constrained one, and — because
 * the first run showed the largest disagreement on the most recent day — a
 * run of consecutive recent days to separate a method difference from data
 * that has not finished settling.
 */
const REFERENCES: Reference[] = [
  { date: '2026-06-13', monitorGWh: 58.5, note: 'heavy constraint' },
  { date: '2026-06-20', monitorGWh: 23.5, note: 'the phase 0 validation date' },
  { date: '2026-07-18', monitorGWh: 10.9, note: 'moderate, settled' },
  { date: '2026-07-21', monitorGWh: 7.8, note: 'recent' },
  { date: '2026-07-22', monitorGWh: 0.6, note: 'recent, near-calm' },
  { date: '2026-07-23', monitorGWh: 7.2, note: 'most recent complete day' },
];

/** The availability-based figure from DECISIONS 002, for contrast. */
const TRACKER_GWH_20_JUNE = 56.45;

const CONCURRENCY = 6;

async function periodTotal(date: string, period: number) {
  const [pn, boalf] = await Promise.all([fetchPN(date, period), fetchBOALF(date, period)]);
  const { start, end } = periodBounds(date, period);
  return deriveSettled(pn, boalf, start, end);
}

async function deriveDay(date: string): Promise<{ gwh: number; periods: number }> {
  const total = periodsInDay(date);
  const periods = Array.from({ length: total }, (_, i) => i + 1);
  let mwh = 0;
  let active = 0;

  for (let i = 0; i < periods.length; i += CONCURRENCY) {
    const batch = periods.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((p) => periodTotal(date, p)));
    for (const r of results) {
      mwh += r.curtailedMWh;
      if (r.curtailedMWh > 0) active += 1;
    }
  }

  return { gwh: mwh / 1000, periods: active };
}

async function main() {
  console.log('Cross-check: Windfall derivation vs Wind Curtailment Monitor\n');
  console.log('date          windfall    monitor     ratio   periods  note');
  console.log('-'.repeat(74));

  const ratios: number[] = [];

  for (const ref of REFERENCES) {
    const { gwh, periods } = await deriveDay(ref.date);
    const ratio = gwh / ref.monitorGWh;
    ratios.push(ratio);
    console.log(
      `${ref.date}  ${gwh.toFixed(2).padStart(8)} ${ref.monitorGWh.toFixed(2).padStart(10)} ` +
        `${ratio.toFixed(3).padStart(9)}x ${String(periods).padStart(7)}  ${ref.note}`
    );
  }

  const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const spread = Math.max(...ratios) - Math.min(...ratios);

  console.log('-'.repeat(74));
  console.log(`mean ratio ${mean.toFixed(3)}x, spread ${spread.toFixed(3)}`);
  // The same contrast the monitor faces, so the gap is shown to be a property
  // of the method family rather than of Windfall.
  const monitorVsTracker = REFERENCES[1].monitorGWh / TRACKER_GWH_20_JUNE;
  console.log(
    `\n20 June against the availability-based tracker (${TRACKER_GWH_20_JUNE} GWh): ` +
      `monitor ${monitorVsTracker.toFixed(3)}x`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
