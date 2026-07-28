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

import type { GridResponse, SourceHealth } from '../src/lib/types.js';
import type { ApiRequest, ApiResponse } from './_lib/handler.js';
import { fetchForecast, fetchNational, fetchRegions } from './_lib/carbon.js';
import { errorMessage, overallHealth, setCacheHeaders } from './_lib/http.js';
import { settlementAt } from '../src/lib/settlement.js';

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
      // The 24-hour forecast is fetched but deliberately not drawn
      // (DECISIONS 011), so a forecast-only outage must not downgrade the
      // source: it would report Carbon Intensity as partly answering while
      // every visible element on the page is fine. Each element owns its own
      // health, and nothing owns this one yet.
      overall: overallHealth([nationalHealth, regionalHealth]),
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
