/**
 * Elexon BMRS — curtailment derivation.
 *
 * Method: for each Scottish wind BMU, compare the physical notification (PN,
 * the unit's own declared intended output) against the bid-offer acceptance
 * level (BOALF, what NESO instructed instead). Where the instruction sits
 * below the declaration, the difference is instructed curtailment.
 *
 * This measures instructed turn-downs through the balancing mechanism. It is
 * a floor, not a total: it cannot see self-curtailment, pre-adjusted
 * declarations, or distribution-connected units. See DECISIONS.md 003 — the
 * lower bound is a design position, not an apology.
 *
 * Two figures, two clocks (DECISIONS.md 006):
 *   - `now`  — instantaneous MW. A true "right now" reading; nothing
 *              accumulates, so a mid-period sample is not an undercount.
 *   - `settled` — MWh over the last *complete* period. Acceptances arrive
 *              throughout a period, so energy only settles once it closes.
 *
 * API quirks, confirmed empirically:
 *   - BOALF's per-unit `bmUnit` filter returns 0 items even for units with
 *     known acceptances. Fetch unfiltered and filter in code. (Spike.)
 *   - BOALF's settlement period filter matches `settlementPeriodFrom` only,
 *     not the declared range. Querying period N therefore misses every
 *     acceptance that began earlier and is still holding a unit down — which
 *     in sustained curtailment is most of them. Fetch a lookback window and
 *     let each record's own time segments decide what is in force.
 *     (Phase 1; see DECISIONS.md 007.)
 *   - PN by settlementDate + settlementPeriod; PN/stream by from/to dates
 *     with an exclusive end. Both return the same units for a given period.
 *
 * Acceptance records are a profile, not a single level: a flat segment
 * holding the unit down, then a ramp releasing it back towards the
 * declaration. Overlapping acceptances chain, each extending the hold, so the
 * live instruction at any instant is the highest-numbered acceptance whose
 * segments cover it.
 */

import { SCOTTISH_WIND_BMUS, SCOTTISH_WIND_SET } from './bmus';
import { fetchJson } from './http';
import { addDays, periodsInDay } from '../../src/lib/settlement';
import type { CurtailedFarm, CurtailedUnit } from '../../src/lib/types';

const BASE = 'https://data.elexon.co.uk/bmrs/api/v1';

/** Resolution at which the settled figure is integrated. */
const SAMPLE_MINUTES = 1;

interface Segment {
  timeFrom: string;
  timeTo: string;
  levelFrom: number;
  levelTo: number;
}

export interface PNItem extends Segment {
  settlementPeriod: number;
  nationalGridBmUnit: string;
}

export interface BOALFItem extends Segment {
  settlementPeriodFrom: number;
  settlementPeriodTo: number;
  nationalGridBmUnit: string;
  acceptanceNumber: number;
  acceptanceTime: string;
  soFlag: boolean;
}

/** Elexon returns either a bare array or a `{ data: [...] }` envelope. */
function unwrap<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

export async function fetchPN(settlementDate: string, period: number): Promise<PNItem[]> {
  const url = `${BASE}/datasets/PN?settlementDate=${settlementDate}&settlementPeriod=${period}`;
  const items = unwrap<PNItem>(await fetchJson(url));
  return items.filter((i) => SCOTTISH_WIND_SET.has(i.nationalGridBmUnit));
}

/**
 * How many periods to look back for acceptances still in force.
 *
 * Observed acceptances run 30–45 minutes and chain with overlap, so two
 * periods would cover it; four is margin at negligible cost, since the
 * response is a few hundred items either way.
 */
const BOALF_LOOKBACK_PERIODS = 4;

export async function fetchBOALF(settlementDate: string, period: number): Promise<BOALFItem[]> {
  // Two filters are unreliable upstream, so both are applied here instead:
  // bmUnit returns nothing, and the period filter matches only the start
  // period of an acceptance. Hence a lookback window, unfiltered by unit.
  const windows = lookbackWindows(settlementDate, period, BOALF_LOOKBACK_PERIODS);

  const responses = await Promise.all(
    windows.map((w) =>
      fetchJson(
        `${BASE}/datasets/BOALF?from=${w.date}&to=${w.date}` +
          `&settlementPeriodFrom=${w.from}&settlementPeriodTo=${w.to}`
      )
    )
  );

  const seen = new Set<string>();
  const items: BOALFItem[] = [];
  for (const body of responses) {
    for (const item of unwrap<BOALFItem>(body)) {
      if (!SCOTTISH_WIND_SET.has(item.nationalGridBmUnit)) continue;
      // Windows can overlap at a date boundary; segments are identified by
      // acceptance plus their own time span.
      const key = `${item.nationalGridBmUnit}:${item.acceptanceNumber}:${item.timeFrom}:${item.timeTo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

/**
 * The period ranges to query so that `period` and the preceding `lookback`
 * periods are all covered, split across dates where the window crosses
 * midnight.
 */
function lookbackWindows(
  settlementDate: string,
  period: number,
  lookback: number
): { date: string; from: number; to: number }[] {
  const earliest = period - lookback;
  if (earliest >= 1) {
    return [{ date: settlementDate, from: earliest, to: period }];
  }

  const previousDate = addDays(settlementDate, -1);
  const previousLength = periodsInDay(previousDate);
  return [
    { date: previousDate, from: Math.max(1, previousLength + earliest), to: previousLength },
    { date: settlementDate, from: 1, to: period },
  ];
}

/**
 * Interpolate a piecewise-linear profile at an instant. Null if uncovered.
 *
 * Exported for the Stream C cross-check, which measures what the clamp in
 * `deriveSettled` excludes. That diagnostic has to share these exact
 * interpolation semantics or it would be comparing against a third method
 * rather than isolating one difference.
 */
export function levelAt(segments: Segment[], at: number): number | null {
  for (const seg of segments) {
    const from = Date.parse(seg.timeFrom);
    const to = Date.parse(seg.timeTo);
    if (at < from || at > to) continue;
    if (to === from) return seg.levelTo;
    const fraction = (at - from) / (to - from);
    return seg.levelFrom + fraction * (seg.levelTo - seg.levelFrom);
  }
  return null;
}

/**
 * The instructed level at an instant, where acceptances overlap.
 *
 * A unit can hold several live acceptances in one period. The spike took the
 * single highest acceptance number for the whole period; here the highest
 * number wins *per instant*, so a later instruction supersedes an earlier one
 * only for the time it actually covers. This is closer to how the instruction
 * stack behaves and it is what the instantaneous figure needs anyway.
 */
export function instructedLevelAt(items: BOALFItem[], at: number): number | null {
  let winner: { acceptance: number; level: number } | null = null;
  for (const item of items) {
    const level = levelAt([item], at);
    if (level === null) continue;
    if (!winner || item.acceptanceNumber > winner.acceptance) {
      winner = { acceptance: item.acceptanceNumber, level };
    }
  }
  return winner?.level ?? null;
}

function groupByUnit<T extends { nationalGridBmUnit: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const existing = grouped.get(item.nationalGridBmUnit);
    if (existing) existing.push(item);
    else grouped.set(item.nationalGridBmUnit, [item]);
  }
  return grouped;
}

/**
 * Instantaneous curtailment across all tracked units, in MW.
 * Units with no acceptance covering the instant are not curtailed.
 */
export function deriveNow(
  pn: PNItem[],
  boalf: BOALFItem[],
  at: Date
): { curtailedMW: number; units: CurtailedUnit[] } {
  const pnByUnit = groupByUnit(pn);
  const boaByUnit = groupByUnit(boalf);
  const instant = at.getTime();
  const units: CurtailedUnit[] = [];
  let curtailedMW = 0;

  for (const [id, acceptances] of boaByUnit) {
    const declared = levelAt(pnByUnit.get(id) ?? [], instant);
    if (declared === null) continue;

    const instructed = instructedLevelAt(acceptances, instant);
    if (instructed === null || instructed >= declared) continue;

    const shortfall = declared - instructed;
    const info = SCOTTISH_WIND_BMUS[id];
    units.push({
      id,
      name: info.name,
      farm: info.farm,
      capacityMW: info.capacityMW,
      curtailedMW: round(shortfall, 1),
    });
    curtailedMW += shortfall;
  }

  units.sort((a, b) => b.curtailedMW - a.curtailedMW);
  return { curtailedMW: round(curtailedMW, 1), units };
}

/**
 * Settled curtailment over a closed period, in MWh.
 *
 * Integrated by sampling rather than solved analytically: overlapping
 * acceptances make the effective instruction profile a piecewise function
 * that is fiddly to integrate in closed form, and at minute resolution over
 * thirty minutes the cost is trivial (50 units x 30 samples).
 *
 * Shortfalls are clamped at zero per sample, so a unit instructed *above* its
 * declaration for part of a period does not net off curtailment elsewhere in
 * it. The spike compared whole-period energy totals, which allowed that
 * netting; this is the stricter reading of "instructed to switch off".
 */
export function deriveSettled(
  pn: PNItem[],
  boalf: BOALFItem[],
  periodStart: Date,
  periodEnd: Date
): { curtailedMWh: number; unitsCurtailed: number; farms: CurtailedFarm[] } {
  const pnByUnit = groupByUnit(pn);
  const boaByUnit = groupByUnit(boalf);
  const stepMs = SAMPLE_MINUTES * 60_000;
  const stepHours = SAMPLE_MINUTES / 60;
  const start = periodStart.getTime();
  const end = periodEnd.getTime();

  const byFarm = new Map<string, number>();
  let curtailedMWh = 0;
  let unitsCurtailed = 0;

  for (const [id, acceptances] of boaByUnit) {
    const declaredSegments = pnByUnit.get(id) ?? [];
    if (declaredSegments.length === 0) continue;

    let unitMWh = 0;
    // Sample at the midpoint of each step so partial coverage at the period
    // boundaries is not double-counted with the neighbouring period.
    for (let t = start + stepMs / 2; t < end; t += stepMs) {
      const declared = levelAt(declaredSegments, t);
      if (declared === null) continue;
      const instructed = instructedLevelAt(acceptances, t);
      if (instructed === null || instructed >= declared) continue;
      unitMWh += (declared - instructed) * stepHours;
    }

    if (unitMWh <= 0) continue;
    unitsCurtailed += 1;
    curtailedMWh += unitMWh;
    const farm = SCOTTISH_WIND_BMUS[id].farm;
    byFarm.set(farm, (byFarm.get(farm) ?? 0) + unitMWh);
  }

  const farms: CurtailedFarm[] = [...byFarm.entries()]
    .map(([farm, mwh]) => ({ farm, name: farm, curtailedMWh: round(mwh, 1) }))
    .sort((a, b) => b.curtailedMWh - a.curtailedMWh);

  return { curtailedMWh: round(curtailedMWh, 1), unitsCurtailed, farms };
}

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}
