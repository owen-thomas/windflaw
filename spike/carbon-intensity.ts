/**
 * Spike: Carbon Intensity API verification
 * Confirms endpoint paths, response shapes, regional data availability,
 * and latency for the three endpoints the product needs.
 *
 * Ground-truth date: 20 June 2026 (known high-curtailment day, 56.45 GWh).
 */

const BASE = 'https://api.carbonintensity.org.uk';
const SPIKE_DATE = '2026-06-20';

interface TimingResult {
  endpoint: string;
  status: number;
  latencyMs: number;
  shape: string;
  notes: string;
}

async function probe(label: string, path: string): Promise<{ status: number; latencyMs: number; body: unknown }> {
  const url = `${BASE}${path}`;
  console.log(`\n--- ${label} ---`);
  console.log(`GET ${url}`);

  const start = performance.now();
  const res = await fetch(url);
  const latencyMs = Math.round(performance.now() - start);
  const body = await res.json();

  console.log(`Status: ${res.status} | Latency: ${latencyMs}ms`);
  return { status: res.status, latencyMs, body };
}

function summariseShape(obj: unknown, depth = 0, maxDepth = 3): string {
  if (depth >= maxDepth) return '...';
  if (obj === null) return 'null';
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return `Array(${obj.length})[${summariseShape(obj[0], depth + 1, maxDepth)}]`;
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>).map(
      ([k, v]) => `${k}: ${summariseShape(v, depth + 1, maxDepth)}`
    );
    return `{ ${entries.join(', ')} }`;
  }
  return typeof obj;
}

async function main() {
  const results: TimingResult[] = [];

  // 1. Current national intensity
  {
    const { status, latencyMs, body } = await probe(
      '1. National intensity (current)',
      '/intensity'
    );
    const data = (body as { data: unknown[] }).data;
    console.log('Shape:', summariseShape(data));
    console.log('Sample:', JSON.stringify(data?.[0], null, 2));
    results.push({ endpoint: '/intensity', status, latencyMs, shape: summariseShape(data), notes: '' });
  }

  // 2. Regional intensity (current, all regions)
  {
    const { status, latencyMs, body } = await probe(
      '2. Regional intensity (current)',
      '/regional'
    );
    const data = (body as { data: unknown[] }).data;
    console.log('Shape:', summariseShape(data));

    // Find Scotland regions
    const regions = (data as { data?: unknown[] }[])
      .flatMap(d => d.data || []) as { shortname?: string; regionid?: number; dnoregion?: string; intensity?: unknown; generationmix?: unknown[] }[];
    const scottish = regions.filter(r =>
      r.shortname?.toLowerCase().includes('scotland') ||
      r.dnoregion?.toLowerCase().includes('scotland')
    );
    console.log(`\nScottish regions found: ${scottish.length}`);
    for (const r of scottish) {
      console.log(`  Region ${r.regionid}: ${r.shortname}`);
      console.log(`    Intensity:`, JSON.stringify(r.intensity));
      console.log(`    Generation mix (first 3):`, JSON.stringify(r.generationmix?.slice(0, 3)));
    }

    // Find South East England for contrast
    const south = regions.filter(r =>
      r.shortname?.toLowerCase().includes('south') &&
      r.shortname?.toLowerCase().includes('england')
    );
    console.log(`\nSouth England regions found: ${south.length}`);
    for (const r of south) {
      console.log(`  Region ${r.regionid}: ${r.shortname}`);
      console.log(`    Intensity:`, JSON.stringify(r.intensity));
    }

    results.push({ endpoint: '/regional', status, latencyMs, shape: summariseShape(data), notes: `${scottish.length} Scottish regions` });
  }

  // 3. Generation mix (current)
  {
    const { status, latencyMs, body } = await probe(
      '3. National generation mix (current)',
      '/generation'
    );
    const data = (body as { data: unknown }).data;
    console.log('Shape:', summariseShape(data));
    const gen = (data as { generationmix?: { fuel: string; perc: number }[] })?.generationmix;
    if (gen) {
      console.log('\nGeneration mix:');
      for (const g of gen) {
        const bar = '█'.repeat(Math.round(g.perc / 2));
        console.log(`  ${g.fuel.padEnd(12)} ${String(g.perc).padStart(5)}%  ${bar}`);
      }
    }
    results.push({ endpoint: '/generation', status, latencyMs, shape: summariseShape(data), notes: '' });
  }

  // 4. Historical data for ground-truth date (intensity by half-hour)
  {
    const { status, latencyMs, body } = await probe(
      '4. Intensity for ground-truth date (2026-06-20)',
      `/intensity/date/${SPIKE_DATE}`
    );
    const data = (body as { data: unknown[] }).data;
    console.log(`Periods returned: ${Array.isArray(data) ? data.length : 'N/A'}`);
    if (Array.isArray(data) && data.length > 0) {
      console.log('First period:', JSON.stringify(data[0], null, 2));
      console.log('Last period:', JSON.stringify(data[data.length - 1], null, 2));
    }
    results.push({ endpoint: `/intensity/date/${SPIKE_DATE}`, status, latencyMs, shape: summariseShape(data), notes: `${Array.isArray(data) ? data.length : 0} periods` });
  }

  // 5. Regional data for ground-truth date (to see Scotland vs South East that day)
  {
    const { status, latencyMs, body } = await probe(
      '5. Regional intensity for ground-truth date',
      `/regional/intensity/${SPIKE_DATE}T12:00Z/${SPIKE_DATE}T12:30Z`
    );
    const data = (body as { data: unknown }).data;
    console.log('Shape:', summariseShape(data));
    results.push({ endpoint: `/regional/intensity/${SPIKE_DATE}T12:00Z/...`, status, latencyMs, shape: summariseShape(data), notes: '' });
  }

  // 6. 48h forecast (current)
  {
    const { status, latencyMs, body } = await probe(
      '6. Intensity forecast (48h)',
      '/intensity/date/fw48h'
    );
    const data = (body as { data: unknown[] }).data;
    console.log(`Forecast periods: ${Array.isArray(data) ? data.length : 'N/A'}`);
    results.push({ endpoint: '/intensity/date/fw48h', status, latencyMs, shape: summariseShape(data), notes: `${Array.isArray(data) ? data.length : 0} periods` });
  }

  // Summary
  console.log('\n\n=== SUMMARY ===');
  console.log('Endpoint'.padEnd(45), 'Status', 'Latency', 'Notes');
  console.log('-'.repeat(80));
  for (const r of results) {
    console.log(r.endpoint.padEnd(45), String(r.status).padEnd(7), `${r.latencyMs}ms`.padEnd(8), r.notes);
  }
}

main().catch(console.error);
