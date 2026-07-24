/**
 * Scottish wind BMUs, transmission-connected.
 *
 * Curated during the phase 0 spike: 50 units, ~8,533 MW registered capacity.
 * On the validation date (20 June 2026), 19 of the 20 units with balancing
 * acceptances were already in this list; the twentieth (Edinbane, Skye) was
 * added. See DECISIONS.md 002.
 *
 * This is a maintained static list, which is the fallback the project plan
 * named: BMU geography metadata is not reliable enough to derive membership
 * at runtime. The limitation is stated in the product's method note —
 * distribution-connected and embedded Scottish wind is not represented here,
 * which is one of the reasons the figure is a floor.
 */

export interface BmuInfo {
  name: string;
  capacityMW: number;
  /** Display name of the wind farm the unit belongs to. */
  farm: string;
}

export const SCOTTISH_WIND_BMUS: Record<string, BmuInfo> = {
  'ABRBO-1': { name: 'Aberdeen Offshore', capacityMW: 99, farm: 'Aberdeen Offshore' },
  'BEATO-1': { name: 'Beatrice 1', capacityMW: 184, farm: 'Beatrice' },
  'BEATO-2': { name: 'Beatrice 2', capacityMW: 166, farm: 'Beatrice' },
  'BEATO-3': { name: 'Beatrice 3', capacityMW: 166, farm: 'Beatrice' },
  'BEATO-4': { name: 'Beatrice 4', capacityMW: 165.5, farm: 'Beatrice' },
  'MOWEO-1': { name: 'Moray East 1', capacityMW: 300, farm: 'Moray East' },
  'MOWEO-2': { name: 'Moray East 2', capacityMW: 300, farm: 'Moray East' },
  'MOWEO-3': { name: 'Moray East 3', capacityMW: 300, farm: 'Moray East' },
  'MOWWO-1': { name: 'Moray West 1', capacityMW: 215, farm: 'Moray West' },
  'MOWWO-2': { name: 'Moray West 2', capacityMW: 215, farm: 'Moray West' },
  'MOWWO-3': { name: 'Moray West 3', capacityMW: 143, farm: 'Moray West' },
  'MOWWO-4': { name: 'Moray West 4', capacityMW: 287, farm: 'Moray West' },
  'NNGAO-1': { name: 'Neart Na Gaoithe 1', capacityMW: 224, farm: 'Neart Na Gaoithe' },
  'NNGAO-2': { name: 'Neart Na Gaoithe 2', capacityMW: 224, farm: 'Neart Na Gaoithe' },
  'SGRWO-1': { name: 'Seagreen 1', capacityMW: 431, farm: 'Seagreen' },
  'SGRWO-2': { name: 'Seagreen 2', capacityMW: 220, farm: 'Seagreen' },
  'SGRWO-3': { name: 'Seagreen 3', capacityMW: 375, farm: 'Seagreen' },
  'SGRWO-4': { name: 'Seagreen 4', capacityMW: 140, farm: 'Seagreen' },
  'SGRWO-5': { name: 'Seagreen 5', capacityMW: 300, farm: 'Seagreen' },
  'SGRWO-6': { name: 'Seagreen 6', capacityMW: 525, farm: 'Seagreen' },
  'BHLAW-1': { name: 'Bhlaraidh', capacityMW: 108, farm: 'Bhlaraidh' },
  'CLDCW-1': { name: 'Clyde Central', capacityMW: 200, farm: 'Clyde' },
  'CLDNW-1': { name: 'Clyde North', capacityMW: 200, farm: 'Clyde' },
  'CLDSW-1': { name: 'Clyde South', capacityMW: 150, farm: 'Clyde' },
  'CGTHW-1': { name: 'Corriegarth', capacityMW: 69, farm: 'Corriegarth' },
  'CRYRW-2': { name: 'Crystal Rig II', capacityMW: 151, farm: 'Crystal Rig' },
  'CRYRW-3': { name: 'Crystal Rig III', capacityMW: 14, farm: 'Crystal Rig' },
  'CRYRW-4': { name: 'Crystal Rig IV', capacityMW: 48, farm: 'Crystal Rig' },
  'DOREW-1': { name: 'Dorenell 1', capacityMW: 157, farm: 'Dorenell' },
  'DOREW-2': { name: 'Dorenell 2', capacityMW: 157, farm: 'Dorenell' },
  'DUNGW-1': { name: 'Dunmaglass', capacityMW: 100, farm: 'Dunmaglass' },
  'FALGW-1': { name: 'Fallago Rig', capacityMW: 144, farm: 'Fallago Rig' },
  'FAARW-1': { name: 'Farr 1', capacityMW: 92, farm: 'Farr' },
  'FAARW-2': { name: 'Farr 2', capacityMW: 92, farm: 'Farr' },
  'GORDW-2': { name: 'Gordonbush Ext', capacityMW: 59, farm: 'Gordonbush' },
  'GRIFW-1': { name: 'Griffin 1', capacityMW: 102, farm: 'Griffin' },
  'GRIFW-2': { name: 'Griffin 2', capacityMW: 104, farm: 'Griffin' },
  'HADHW-1': { name: 'Hadyard Hill', capacityMW: 130, farm: 'Hadyard Hill' },
  'KLGLW-1': { name: 'Kilgallioch', capacityMW: 253, farm: 'Kilgallioch' },
  'STLGW-1': { name: 'Stronelairg 1', capacityMW: 108, farm: 'Stronelairg' },
  'STLGW-2': { name: 'Stronelairg 2', capacityMW: 108, farm: 'Stronelairg' },
  'STLGW-3': { name: 'Stronelairg 3', capacityMW: 108, farm: 'Stronelairg' },
  'VKNGW-1': { name: 'Viking 1', capacityMW: 122, farm: 'Viking' },
  'VKNGW-2': { name: 'Viking 2', capacityMW: 122, farm: 'Viking' },
  'VKNGW-3': { name: 'Viking 3', capacityMW: 122, farm: 'Viking' },
  'VKNGW-4': { name: 'Viking 4', capacityMW: 122, farm: 'Viking' },
  'WHILW-2': { name: 'Whitelee Ext', capacityMW: 206, farm: 'Whitelee' },
  'RREW-1': { name: 'Robin Rigg East', capacityMW: 114, farm: 'Robin Rigg' },
  'RRWW-1': { name: 'Robin Rigg West', capacityMW: 91, farm: 'Robin Rigg' },
  'EDINW-1': { name: 'Edinbane (Skye)', capacityMW: 41.4, farm: 'Edinbane' },
};

export const SCOTTISH_WIND_IDS = Object.keys(SCOTTISH_WIND_BMUS);
export const SCOTTISH_WIND_SET = new Set(SCOTTISH_WIND_IDS);

export const TRACKED_CAPACITY_MW = Object.values(SCOTTISH_WIND_BMUS).reduce(
  (sum, unit) => sum + unit.capacityMW,
  0
);
