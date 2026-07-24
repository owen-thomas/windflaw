/**
 * GET /api/curtailment
 *
 * Scottish wind instructed off the system, on two clocks:
 *
 *   now     — MW currently instructed below declared output. Instantaneous,
 *             so it is honest at any point inside a period.
 *   settled — MWh over the last complete period. Only meaningful once the
 *             period has closed and every acceptance has landed.
 *
 * Both are floors. See DECISIONS.md 003 and 006, and _lib/elexon.ts for the
 * derivation itself.
 */

import type { CurtailmentResponse, SourceHealth } from '../src/lib/types';
import type { ApiRequest, ApiResponse } from './_lib/handler';
import { deriveNow, deriveSettled, fetchBOALF, fetchPN } from './_lib/elexon';
import { SCOTTISH_WIND_IDS, TRACKED_CAPACITY_MW } from './_lib/bmus';
import { errorMessage, overallHealth, setCacheHeaders } from './_lib/http';
import { previousPeriod, settlementAt } from '../src/lib/settlement';

const METHOD_BASIS =
  'Instructed turn-downs of transmission-connected Scottish wind via the ' +
  'balancing mechanism: declared output (PN) minus accepted level (BOALF). ' +
  'Excludes self-curtailment, pre-adjusted declarations and ' +
  'distribution-connected units, so the figure is a floor.';

export default async function handler(_req: ApiRequest, res: ApiResponse) {
  const sampledAt = new Date();
  const current = settlementAt(sampledAt);
  const settled = previousPeriod(current);

  const [currentData, settledData] = await Promise.allSettled([
    Promise.all([fetchPN(current.date, current.period), fetchBOALF(current.date, current.period)]),
    Promise.all([fetchPN(settled.date, settled.period), fetchBOALF(settled.date, settled.period)]),
  ]);

  const errors: string[] = [];
  const health = (result: PromiseSettledResult<unknown>, label: string): SourceHealth => {
    if (result.status === 'fulfilled') return 'ok';
    errors.push(`${label}: ${errorMessage(result.reason)}`);
    return 'failed';
  };

  const nowHealth = health(currentData, 'now');
  const settledHealth = health(settledData, 'settled');

  const body: CurtailmentResponse = {
    fetchedAt: new Date().toISOString(),
    health: {
      overall: overallHealth([nowHealth, settledHealth]),
      now: nowHealth,
      settled: settledHealth,
    },
    errors,
    now: null,
    settled: null,
    method: {
      basis: METHOD_BASIS,
      unitsTracked: SCOTTISH_WIND_IDS.length,
      capacityMW: TRACKED_CAPACITY_MW,
    },
  };

  if (currentData.status === 'fulfilled') {
    const [pn, boalf] = currentData.value;
    const { curtailedMW, units } = deriveNow(pn, boalf, sampledAt);
    body.now = {
      settlement: current,
      sampledAt: sampledAt.toISOString(),
      curtailedMW,
      unitsCurtailed: units.length,
      units,
    };
  }

  if (settledData.status === 'fulfilled') {
    const [pn, boalf] = settledData.value;
    const derived = deriveSettled(
      pn,
      boalf,
      new Date(settled.periodStart),
      new Date(settled.periodEnd)
    );
    body.settled = { settlement: settled, ...derived };
  }

  setCacheHeaders(res);
  return res.status(200).json(body);
}
