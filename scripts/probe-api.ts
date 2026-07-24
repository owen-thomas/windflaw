/**
 * Invoke the serverless handlers directly against live upstreams.
 *
 * Faster than driving the dev server, and it exercises exactly the code that
 * deploys. Run with `npm run probe`.
 */

import grid from '../api/grid';
import curtailment from '../api/curtailment';
import type { ApiHandler } from '../api/_lib/handler';
import { settlementAt, previousPeriod } from '../src/lib/settlement';

function collect(): { res: Parameters<ApiHandler>[1]; body: () => unknown; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  let captured: unknown = null;
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
      return res;
    },
    status(_code: number) {
      return res;
    },
    json(body: unknown) {
      captured = body;
      return res;
    },
  };
  return { res, body: () => captured, headers };
}

async function run(label: string, handler: ApiHandler) {
  const { res, body, headers } = collect();
  const start = performance.now();
  await handler({ query: {} }, res);
  const ms = Math.round(performance.now() - start);
  console.log(`\n=== ${label} (${ms}ms) ===`);
  console.log(`Cache-Control: ${headers['Cache-Control']}`);
  return body();
}

async function main() {
  const now = settlementAt();
  console.log(`Current settlement: ${now.date} period ${now.period}`);
  console.log(`  window ${now.periodStart} → ${now.periodEnd}`);
  const prev = previousPeriod(now);
  console.log(`Last complete:      ${prev.date} period ${prev.period}`);
  console.log(`  window ${prev.periodStart} → ${prev.periodEnd}`);

  const gridBody = (await run('/api/grid', grid)) as any;
  console.log('health:', JSON.stringify(gridBody.health));
  console.log('errors:', gridBody.errors);
  console.log(
    'national:',
    `${gridBody.national?.intensity?.actual ?? gridBody.national?.intensity?.forecast} gCO2/kWh,`,
    `wind ${gridBody.national?.windPct}%, gas ${gridBody.national?.gasPct}%`
  );
  for (const key of ['scotland', 'northScotland', 'southEngland', 'southEastEngland']) {
    const r = gridBody.regions?.[key];
    if (r) {
      console.log(
        `  ${r.name.padEnd(22)} ${String(r.intensity.forecast).padStart(4)} gCO2/kWh   wind ${String(r.windPct).padStart(5)}%  gas ${String(r.gasPct).padStart(5)}%`
      );
    } else {
      console.log(`  ${key.padEnd(22)} MISSING`);
    }
  }
  console.log('forecast points:', gridBody.forecast?.length);

  const curtBody = (await run('/api/curtailment', curtailment)) as any;
  console.log('health:', JSON.stringify(curtBody.health));
  console.log('errors:', curtBody.errors);
  console.log(
    `now:     ${curtBody.now?.curtailedMW} MW across ${curtBody.now?.unitsCurtailed} units`
  );
  for (const u of (curtBody.now?.units ?? []).slice(0, 8)) {
    console.log(`  ${u.id.padEnd(10)} ${u.name.padEnd(22)} ${String(u.curtailedMW).padStart(8)} MW / ${u.capacityMW} MW`);
  }
  console.log(
    `settled: ${curtBody.settled?.curtailedMWh} MWh across ${curtBody.settled?.unitsCurtailed} units` +
      ` (period ${curtBody.settled?.settlement?.period})`
  );
  for (const f of curtBody.settled?.farms ?? []) {
    console.log(`  ${f.name.padEnd(22)} ${String(f.curtailedMWh).padStart(8)} MWh`);
  }
  console.log(`method: ${curtBody.method.unitsTracked} units, ${curtBody.method.capacityMW} MW tracked`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
