/**
 * GET /api/grid
 *
 * Carbon Intensity, collapsed into one cached response: national mix and
 * intensity, the regions the paradox needs, and the 24h forecast.
 *
 * Each of the three concerns reports its own health. A failure in one leaves
 * the others intact and still returns 200 — the client degrades that element
 * alone rather than blanking the screen. See types.ts.
 */

import type { GridResponse, SourceHealth } from '../src/lib/types';
import type { ApiRequest, ApiResponse } from './_lib/handler';
import { fetchForecast, fetchNational, fetchRegions } from './_lib/carbon';
import { errorMessage, overallHealth, setCacheHeaders } from './_lib/http';
import { settlementAt } from '../src/lib/settlement';

export default async function handler(_req: ApiRequest, res: ApiResponse) {
  const [national, regions, forecast] = await Promise.allSettled([
    fetchNational(),
    fetchRegions(),
    fetchForecast(),
  ]);

  const errors: string[] = [];
  const health = (result: PromiseSettledResult<unknown>, label: string): SourceHealth => {
    if (result.status === 'fulfilled') return 'ok';
    errors.push(`${label}: ${errorMessage(result.reason)}`);
    return 'failed';
  };

  const nationalHealth = health(national, 'national');
  const regionalHealth = health(regions, 'regional');
  const forecastHealth = health(forecast, 'forecast');

  const body: GridResponse = {
    fetchedAt: new Date().toISOString(),
    settlement: settlementAt(),
    health: {
      overall: overallHealth([nationalHealth, regionalHealth, forecastHealth]),
      national: nationalHealth,
      regional: regionalHealth,
      forecast: forecastHealth,
    },
    errors,
    national: national.status === 'fulfilled' ? national.value : null,
    regions: regions.status === 'fulfilled' ? regions.value : null,
    forecast: forecast.status === 'fulfilled' ? forecast.value : null,
  };

  setCacheHeaders(res);
  return res.status(200).json(body);
}
