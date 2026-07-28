/**
 * NESO Carbon Intensity API — fetch and normalise.
 *
 * Keyless and CORS-friendly, so the proxy exists for caching and for
 * collapsing four upstream calls into one client request, not for access.
 *
 * Shapes confirmed during the phase 0 spike (DECISIONS.md 002). Two
 * corrections to the project plan carried here: the forecast endpoint is
 * `/intensity/fw24h` (fw48h returns 400), and regional data nests under
 * `data[0].regions`.
 */

import type {
  ForecastPoint,
  Fuel,
  Intensity,
  NationalState,
  RegionState,
  RegionalState,
} from '../../src/lib/types.js';
import { fetchJson } from './http.js';

const BASE = 'https://api.carbonintensity.org.uk';

interface RawIntensity {
  forecast?: number | null;
  actual?: number | null;
  index?: string | null;
}

interface RawPeriod {
  from: string;
  to: string;
  intensity: RawIntensity;
}

interface RawRegion {
  regionid: number;
  shortname: string;
  intensity: RawIntensity;
  generationmix: Fuel[];
}

function normaliseIntensity(raw: RawIntensity | undefined): Intensity {
  return {
    forecast: raw?.forecast ?? null,
    actual: raw?.actual ?? null,
    index: raw?.index ?? null,
  };
}

function fuelPct(mix: Fuel[], fuel: string): number {
  return mix.find((f) => f.fuel === fuel)?.perc ?? 0;
}

export async function fetchNational(): Promise<NationalState> {
  const [intensityBody, generationBody] = await Promise.all([
    fetchJson<{ data: RawPeriod[] }>(`${BASE}/intensity`),
    fetchJson<{ data: { generationmix: Fuel[] } }>(`${BASE}/generation`),
  ]);

  const mix = generationBody.data?.generationmix ?? [];
  return {
    intensity: normaliseIntensity(intensityBody.data?.[0]?.intensity),
    generationMix: mix,
    windPct: fuelPct(mix, 'wind'),
    gasPct: fuelPct(mix, 'gas'),
  };
}

function normaliseRegion(raw: RawRegion | undefined): RegionState | null {
  if (!raw) return null;
  const mix = raw.generationmix ?? [];
  return {
    regionId: raw.regionid,
    name: raw.shortname,
    intensity: normaliseIntensity(raw.intensity),
    generationMix: mix,
    windPct: fuelPct(mix, 'wind'),
    gasPct: fuelPct(mix, 'gas'),
  };
}

export async function fetchRegions(): Promise<RegionalState> {
  const body = await fetchJson<{ data: { regions: RawRegion[] }[] }>(`${BASE}/regional`);
  const regions = body.data?.[0]?.regions ?? [];

  const byName = (name: string) =>
    regions.find((r) => r.shortname?.toLowerCase() === name.toLowerCase());

  return {
    scotland: normaliseRegion(byName('Scotland')),
    northScotland: normaliseRegion(byName('North Scotland')),
    southScotland: normaliseRegion(byName('South Scotland')),
    southEngland: normaliseRegion(byName('South England')),
    southEastEngland: normaliseRegion(byName('South East England')),
  };
}

export async function fetchForecast(): Promise<ForecastPoint[]> {
  const body = await fetchJson<{ data: RawPeriod[] }>(`${BASE}/intensity/fw24h`);
  return (body.data ?? []).map((p) => ({
    from: p.from,
    to: p.to,
    forecast: p.intensity?.forecast ?? null,
    index: p.intensity?.index ?? null,
  }));
}
