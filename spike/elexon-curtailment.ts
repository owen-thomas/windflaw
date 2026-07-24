/**
 * Spike: Elexon BMRS curtailment derivation
 *
 * Method: for each Scottish wind BMU and settlement period,
 *   curtailment = PN (declared output) - BOA (instructed output)
 *   where the acceptance reduces output below the notification.
 *
 * Ground-truth: 20 June 2026 — public tracker reports 56.45 GWh curtailed.
 * This script should land in the same order of magnitude.
 *
 * API notes discovered during spike:
 *   - PN/stream: date range is inclusive-from, exclusive-to
 *   - BOALF: per-unit bmUnit filter is broken; fetch unfiltered, filter in code
 */

const BASE = 'https://data.elexon.co.uk/bmrs/api/v1';
const SPIKE_DATE = '2026-06-20';
const SPIKE_DATE_NEXT = '2026-06-21';

// Curated Scottish wind BMUs (transmission-connected).
// Major capacity subject to B6 boundary constraints.
const SCOTTISH_WIND_BMUS: Record<string, { name: string; capacityMW: number }> = {
  'ABRBO-1': { name: 'Aberdeen Offshore', capacityMW: 99 },
  'BEATO-1': { name: 'Beatrice 1', capacityMW: 184 },
  'BEATO-2': { name: 'Beatrice 2', capacityMW: 166 },
  'BEATO-3': { name: 'Beatrice 3', capacityMW: 166 },
  'BEATO-4': { name: 'Beatrice 4', capacityMW: 165.5 },
  'MOWEO-1': { name: 'Moray East 1', capacityMW: 300 },
  'MOWEO-2': { name: 'Moray East 2', capacityMW: 300 },
  'MOWEO-3': { name: 'Moray East 3', capacityMW: 300 },
  'MOWWO-1': { name: 'Moray West 1', capacityMW: 215 },
  'MOWWO-2': { name: 'Moray West 2', capacityMW: 215 },
  'MOWWO-3': { name: 'Moray West 3', capacityMW: 143 },
  'MOWWO-4': { name: 'Moray West 4', capacityMW: 287 },
  'NNGAO-1': { name: 'Neart Na Gaoithe 1', capacityMW: 224 },
  'NNGAO-2': { name: 'Neart Na Gaoithe 2', capacityMW: 224 },
  'SGRWO-1': { name: 'Seagreen 1', capacityMW: 431 },
  'SGRWO-2': { name: 'Seagreen 2', capacityMW: 220 },
  'SGRWO-3': { name: 'Seagreen 3', capacityMW: 375 },
  'SGRWO-4': { name: 'Seagreen 4', capacityMW: 140 },
  'SGRWO-5': { name: 'Seagreen 5', capacityMW: 300 },
  'SGRWO-6': { name: 'Seagreen 6', capacityMW: 525 },
  'BHLAW-1': { name: 'Bhlaraidh', capacityMW: 108 },
  'CLDCW-1': { name: 'Clyde Central', capacityMW: 200 },
  'CLDNW-1': { name: 'Clyde North', capacityMW: 200 },
  'CLDSW-1': { name: 'Clyde South', capacityMW: 150 },
  'CGTHW-1': { name: 'Corriegarth', capacityMW: 69 },
  'CRYRW-2': { name: 'Crystal Rig II', capacityMW: 151 },
  'CRYRW-3': { name: 'Crystal Rig III', capacityMW: 14 },
  'CRYRW-4': { name: 'Crystal Rig IV', capacityMW: 48 },
  'DOREW-1': { name: 'Dorenell 1', capacityMW: 157 },
  'DOREW-2': { name: 'Dorenell 2', capacityMW: 157 },
  'DUNGW-1': { name: 'Dunmaglass', capacityMW: 100 },
  'FALGW-1': { name: 'Fallago Rig', capacityMW: 144 },
  'FAARW-1': { name: 'Farr 1', capacityMW: 92 },
  'FAARW-2': { name: 'Farr 2', capacityMW: 92 },
  'GORDW-2': { name: 'Gordonbush Ext', capacityMW: 59 },
  'GRIFW-1': { name: 'Griffin 1', capacityMW: 102 },
  'GRIFW-2': { name: 'Griffin 2', capacityMW: 104 },
  'HADHW-1': { name: 'Hadyard Hill', capacityMW: 130 },
  'KLGLW-1': { name: 'Kilgallioch', capacityMW: 253 },
  'STLGW-1': { name: 'Stronelairg 1', capacityMW: 108 },
  'STLGW-2': { name: 'Stronelairg 2', capacityMW: 108 },
  'STLGW-3': { name: 'Stronelairg 3', capacityMW: 108 },
  'VKNGW-1': { name: 'Viking 1', capacityMW: 122 },
  'VKNGW-2': { name: 'Viking 2', capacityMW: 122 },
  'VKNGW-3': { name: 'Viking 3', capacityMW: 122 },
  'VKNGW-4': { name: 'Viking 4', capacityMW: 122 },
  'WHILW-2': { name: 'Whitelee Ext', capacityMW: 206 },
  'RREW-1':  { name: 'Robin Rigg East', capacityMW: 114 },
  'RRWW-1':  { name: 'Robin Rigg West', capacityMW: 91 },
  'EDINW-1': { name: 'Edinbane (Skye)', capacityMW: 41.4 },
};

interface PNItem {
  settlementPeriod: number;
  timeFrom: string;
  timeTo: string;
  levelFrom: number;
  levelTo: number;
  nationalGridBmUnit: string;
}

interface BOALFItem {
  settlementPeriodFrom: number;
  settlementPeriodTo: number;
  timeFrom: string;
  timeTo: string;
  levelFrom: number;
  levelTo: number;
  nationalGridBmUnit: string;
  acceptanceNumber: number;
  acceptanceTime: string;
  amendmentFlag: string;
  soFlag: boolean;
}

/**
 * Compute energy (MWh) from a piecewise-linear power profile.
 * Each segment: ramp from levelFrom to levelTo over (timeFrom, timeTo).
 */
function energyMWh(segments: { timeFrom: string; timeTo: string; levelFrom: number; levelTo: number }[]): number {
  let total = 0;
  for (const seg of segments) {
    const from = new Date(seg.timeFrom).getTime();
    const to = new Date(seg.timeTo).getTime();
    const durationHours = (to - from) / 3_600_000;
    if (durationHours <= 0) continue;
    const avgMW = (seg.levelFrom + seg.levelTo) / 2;
    total += avgMW * durationHours;
  }
  return total;
}

/**
 * For a given settlement period, compute the average MW from a set of
 * piecewise-linear segments by integrating and dividing by 0.5h.
 */
function averageMW(segments: { timeFrom: string; timeTo: string; levelFrom: number; levelTo: number }[]): number {
  const mwh = energyMWh(segments);
  return mwh / 0.5; // 30-minute settlement period
}

async function main() {
  const unitIds = Object.keys(SCOTTISH_WIND_BMUS);
  const scottishSet = new Set(unitIds);
  const totalCapacity = Object.values(SCOTTISH_WIND_BMUS).reduce((s, u) => s + u.capacityMW, 0);

  console.log(`Scottish wind BMUs: ${unitIds.length}`);
  console.log(`Total registered capacity: ${totalCapacity.toFixed(0)} MW`);
  console.log(`Ground-truth date: ${SPIKE_DATE}`);
  console.log(`Ground-truth target: ~56.45 GWh curtailed\n`);

  // 1. Fetch PN data via stream (supports bmUnit filter, needs exclusive end date)
  console.log('Fetching PN data...');
  let allPN: PNItem[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < unitIds.length; i += BATCH_SIZE) {
    const batch = unitIds.slice(i, i + BATCH_SIZE);
    const params = new URLSearchParams({ from: SPIKE_DATE, to: SPIKE_DATE_NEXT });
    for (const u of batch) params.append('bmUnit', u);

    const res = await fetch(`${BASE}/datasets/PN/stream?${params}`);
    if (!res.ok) throw new Error(`PN fetch failed: ${res.status}`);
    const data: PNItem[] = await res.json();
    allPN = allPN.concat(data);
    process.stdout.write(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${data.length} items\n`);
  }
  console.log(`Total PN items: ${allPN.length}`);

  // 2. Fetch ALL BOALF data for the day (bmUnit filter is broken), filter in code
  console.log('\nFetching BOALF data (all units, will filter)...');
  let allBOALF: BOALFItem[] = [];

  for (let spFrom = 1; spFrom <= 48; spFrom += 6) {
    const spTo = Math.min(spFrom + 5, 48);
    const url = `${BASE}/datasets/BOALF?from=${SPIKE_DATE}&to=${SPIKE_DATE}&settlementPeriodFrom=${spFrom}&settlementPeriodTo=${spTo}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BOALF fetch failed: ${res.status}`);
    const body = await res.json();
    const items: BOALFItem[] = body.data || [];
    allBOALF = allBOALF.concat(items);
    process.stdout.write(`  SP ${spFrom}-${spTo}: ${items.length} items\n`);
  }

  // Filter for Scottish wind units
  const scottishBOALF = allBOALF.filter(b => scottishSet.has(b.nationalGridBmUnit));
  console.log(`Total BOALF items: ${allBOALF.length}`);
  console.log(`Scottish wind BOALF items: ${scottishBOALF.length}`);

  // 3. Group PN by unit and settlement period
  const pnByUnitPeriod = new Map<string, PNItem[]>();
  for (const item of allPN) {
    const key = `${item.nationalGridBmUnit}:${item.settlementPeriod}`;
    if (!pnByUnitPeriod.has(key)) pnByUnitPeriod.set(key, []);
    pnByUnitPeriod.get(key)!.push(item);
  }

  // 4. Group BOALF by unit and settlement period
  // BOALFs span periods via settlementPeriodFrom/To; assign to each period they cover.
  // Multiple acceptances can exist per period; we need the latest one (highest acceptanceNumber).
  const boaByUnitPeriod = new Map<string, BOALFItem[]>();
  for (const item of scottishBOALF) {
    for (let sp = item.settlementPeriodFrom; sp <= item.settlementPeriodTo; sp++) {
      const key = `${item.nationalGridBmUnit}:${sp}`;
      if (!boaByUnitPeriod.has(key)) boaByUnitPeriod.set(key, []);
      boaByUnitPeriod.get(key)!.push(item);
    }
  }

  // 5. Compute curtailment per unit and period
  let totalCurtailmentMWh = 0;
  const curtailmentByUnit = new Map<string, number>();
  const periodsWithCurtailment = new Set<number>();

  for (const unitId of unitIds) {
    let unitCurtailment = 0;

    for (let sp = 1; sp <= 48; sp++) {
      const pnKey = `${unitId}:${sp}`;
      const pnSegments = pnByUnitPeriod.get(pnKey);
      if (!pnSegments || pnSegments.length === 0) continue;

      const boaSegments = boaByUnitPeriod.get(pnKey);
      if (!boaSegments || boaSegments.length === 0) continue;

      // Get the PN energy for this period
      const pnMWh = energyMWh(pnSegments);

      // For BOALFs: group by acceptanceNumber, take the latest one
      const byAcceptance = new Map<number, BOALFItem[]>();
      for (const item of boaSegments) {
        if (!byAcceptance.has(item.acceptanceNumber)) byAcceptance.set(item.acceptanceNumber, []);
        byAcceptance.get(item.acceptanceNumber)!.push(item);
      }

      // The latest acceptance (highest number) represents the final instruction
      const latestAccNum = Math.max(...byAcceptance.keys());
      const latestSegments = byAcceptance.get(latestAccNum)!;
      const boaMWh = energyMWh(latestSegments);

      // Curtailment: what PN declared minus what the acceptance instructed
      if (boaMWh < pnMWh) {
        const curtailed = pnMWh - boaMWh;
        unitCurtailment += curtailed;
        periodsWithCurtailment.add(sp);
      }
    }

    if (unitCurtailment > 0) {
      curtailmentByUnit.set(unitId, unitCurtailment);
      totalCurtailmentMWh += unitCurtailment;
    }
  }

  // 6. Results
  console.log('\n=== CURTAILMENT BY UNIT ===');
  console.log('Unit'.padEnd(12) + 'Name'.padEnd(22) + 'Curtailed (MWh)'.padStart(16) + 'Cap (MW)'.padStart(10));
  console.log('-'.repeat(60));

  const sorted = [...curtailmentByUnit.entries()].sort((a, b) => b[1] - a[1]);
  for (const [unitId, mwh] of sorted) {
    const info = SCOTTISH_WIND_BMUS[unitId];
    console.log(
      unitId.padEnd(12) +
      info.name.padEnd(22) +
      mwh.toFixed(1).padStart(16) +
      info.capacityMW.toFixed(0).padStart(10)
    );
  }

  // Group by farm
  const farmGroups: Record<string, string[]> = {};
  for (const [unitId] of sorted) {
    const farm = unitId.replace(/-\d+$/, '');
    if (!farmGroups[farm]) farmGroups[farm] = [];
    farmGroups[farm].push(unitId);
  }

  console.log('\n=== CURTAILMENT BY FARM ===');
  const farmTotals: [string, number][] = [];
  for (const [farm, units] of Object.entries(farmGroups)) {
    const total = units.reduce((s, u) => s + (curtailmentByUnit.get(u) || 0), 0);
    farmTotals.push([farm, total]);
  }
  farmTotals.sort((a, b) => b[1] - a[1]);
  for (const [farm, total] of farmTotals) {
    console.log(`  ${farm.padEnd(12)} ${total.toFixed(1).padStart(10)} MWh  (${(total / 1000).toFixed(2)} GWh)`);
  }

  const totalGWh = totalCurtailmentMWh / 1000;
  console.log('\n' + '='.repeat(60));
  console.log(`TOTAL CURTAILMENT:     ${totalCurtailmentMWh.toFixed(1)} MWh  (${totalGWh.toFixed(2)} GWh)`);
  console.log(`Ground-truth target:   56,450 MWh  (56.45 GWh)`);
  console.log(`Ratio (derived/target): ${(totalGWh / 56.45).toFixed(3)}`);
  console.log(`Periods with curtailment: ${periodsWithCurtailment.size} / 48`);
  console.log(`Units curtailed: ${curtailmentByUnit.size} / ${unitIds.length}`);

  if (totalGWh >= 20 && totalGWh <= 100) {
    console.log('\nSAME ORDER OF MAGNITUDE — spike exit criterion met.');
  } else if (totalGWh > 0) {
    console.log('\nDIFFERENT ORDER OF MAGNITUDE — method needs investigation.');
    console.log('Possible causes:');
    console.log('  - Missing units from the Scottish list');
    console.log('  - BOA profile integration error');
    console.log('  - Need to include embedded (distribution-connected) units');
  } else {
    console.log('\nNO CURTAILMENT DERIVED — method is broken.');
  }
}

main().catch(console.error);
