/**
 * Scottish wind BMUs, transmission-connected.
 *
 * 112 units, ~13,105 MW registered capacity, derived from Elexon's BM unit
 * registry (`/reference/bmunits/all`): every unit with `bmUnitType` T and
 * `fuelType` WIND whose farm is in Scotland or Scottish waters. Capacities
 * are the registry's `generationCapacity` verbatim, so the total on screen is
 * traceable to a published figure rather than to a hand-kept number.
 *
 * It replaces the 50-unit list curated in the phase 0 spike, which was
 * validated on 20 June 2026 — a light day. Re-deriving 13 June 2026, a
 * heavily constrained one, showed 18.45 GWh of instructed curtailment at
 * transmission-connected Scottish wind units the old list did not contain:
 * ~36% of the headline on the kind of day the product is about, and ~0% on
 * an ordinary one. A gap that only opens on the days that matter is not a
 * gap a light-day check can find. See DECISIONS.md 015.
 *
 * Membership is still a maintained static list, which is the fallback the
 * project plan named: the registry carries no usable location field for
 * transmission units (`gspGroupId` is populated only for embedded ones), so
 * "in Scotland" is a judgement made once, here, and not derived at runtime.
 *
 * Still out of scope, and still a reason the figure is a floor: embedded and
 * distribution-connected Scottish wind, which does not bid into the balancing
 * mechanism as a T unit at all. Baillie (BABAW-1) is the nearest miss —
 * Caithness, but registered E.
 */

export interface BmuInfo {
  name: string;
  capacityMW: number;
  /** Display name of the wind farm the unit belongs to. */
  farm: string;
}

export const SCOTTISH_WIND_BMUS: Record<string, BmuInfo> = {
  // Offshore, Scottish waters
  'ABRBO-1': { name: 'Aberdeen Offshore', capacityMW: 99, farm: 'Aberdeen Offshore' },
  'BEATO-1': { name: 'Beatrice 1', capacityMW: 184, farm: 'Beatrice' },
  'BEATO-2': { name: 'Beatrice 2', capacityMW: 166, farm: 'Beatrice' },
  'BEATO-3': { name: 'Beatrice 3', capacityMW: 166, farm: 'Beatrice' },
  'BEATO-4': { name: 'Beatrice 4', capacityMW: 165.526, farm: 'Beatrice' },
  'MOWEO-1': { name: 'Moray East 1', capacityMW: 300, farm: 'Moray East' },
  'MOWEO-2': { name: 'Moray East 2', capacityMW: 300, farm: 'Moray East' },
  'MOWEO-3': { name: 'Moray East 3', capacityMW: 300, farm: 'Moray East' },
  'MOWWO-1': { name: 'Moray West 1', capacityMW: 215, farm: 'Moray West' },
  'MOWWO-2': { name: 'Moray West 2', capacityMW: 215, farm: 'Moray West' },
  'MOWWO-3': { name: 'Moray West 3', capacityMW: 143, farm: 'Moray West' },
  'MOWWO-4': { name: 'Moray West 4', capacityMW: 287, farm: 'Moray West' },
  'NNGAO-1': { name: 'Neart Na Gaoithe 1', capacityMW: 224, farm: 'Neart Na Gaoithe' },
  'NNGAO-2': { name: 'Neart Na Gaoithe 2', capacityMW: 224, farm: 'Neart Na Gaoithe' },
  'SGRWO-1': { name: 'Seagreen 1', capacityMW: 431.132, farm: 'Seagreen' },
  'SGRWO-2': { name: 'Seagreen 2', capacityMW: 220, farm: 'Seagreen' },
  'SGRWO-3': { name: 'Seagreen 3', capacityMW: 374.618, farm: 'Seagreen' },
  'SGRWO-4': { name: 'Seagreen 4', capacityMW: 140, farm: 'Seagreen' },
  'SGRWO-5': { name: 'Seagreen 5', capacityMW: 300, farm: 'Seagreen' },
  'SGRWO-6': { name: 'Seagreen 6', capacityMW: 525.302, farm: 'Seagreen' },
  'RREW-1': { name: 'Robin Rigg East', capacityMW: 114.293, farm: 'Robin Rigg' },
  'RRWW-1': { name: 'Robin Rigg West', capacityMW: 90.838, farm: 'Robin Rigg' },

  // Highland, Moray, Caithness, Sutherland, Shetland and Skye
  'BDCHW-1': { name: 'Bad a Cheo', capacityMW: 270, farm: 'Bad a Cheo' },
  'BEINW-1': { name: 'Beinneun', capacityMW: 108.8, farm: 'Beinneun' },
  'BHLAW-1': { name: 'Bhlaraidh', capacityMW: 108, farm: 'Bhlaraidh' },
  'CGTHW-1': { name: 'Corriegarth', capacityMW: 69, farm: 'Corriegarth' },
  'CREAW-1': { name: 'Creag Riabhach', capacityMW: 93, farm: 'Creag Riabhach' },
  'CRMLW-1': { name: 'Corriemoillie', capacityMW: 48, farm: 'Corriemoillie' },
  'DOREW-1': { name: 'Dorenell 1', capacityMW: 156.92, farm: 'Dorenell' },
  'DOREW-2': { name: 'Dorenell 2', capacityMW: 156.92, farm: 'Dorenell' },
  'DUNGW-1': { name: 'Dunmaglass', capacityMW: 100, farm: 'Dunmaglass' },
  'EDINW-1': { name: 'Edinbane (Skye)', capacityMW: 41.4, farm: 'Edinbane' },
  'FAARW-1': { name: 'Farr 1', capacityMW: 92, farm: 'Farr' },
  'FAARW-2': { name: 'Farr 2', capacityMW: 92, farm: 'Farr' },
  'GLNKW-1': { name: 'Glen Kyllachy', capacityMW: 52, farm: 'Glen Kyllachy' },
  'GORDW-1': { name: 'Gordonbush', capacityMW: 86.764, farm: 'Gordonbush' },
  'GORDW-2': { name: 'Gordonbush Ext', capacityMW: 58.733, farm: 'Gordonbush' },
  'HALSW-1': { name: 'Halsary', capacityMW: 30, farm: 'Halsary' },
  'KILBW-1': { name: 'Kilbraur', capacityMW: 68.51, farm: 'Kilbraur' },
  'LCLTW-1': { name: 'Lochluichart', capacityMW: 69, farm: 'Lochluichart' },
  'LIMKW-1': { name: 'Limekiln', capacityMW: 106, farm: 'Limekiln' },
  'MILWW-1': { name: 'Millennium', capacityMW: 65, farm: 'Millennium' },
  'STLGW-1': { name: 'Stronelairg 1', capacityMW: 108, farm: 'Stronelairg' },
  'STLGW-2': { name: 'Stronelairg 2', capacityMW: 108, farm: 'Stronelairg' },
  'STLGW-3': { name: 'Stronelairg 3', capacityMW: 108, farm: 'Stronelairg' },
  'STRNW-1': { name: 'Strathy North', capacityMW: 70, farm: 'Strathy North' },
  'VKNGW-1': { name: 'Viking 1', capacityMW: 121.8, farm: 'Viking' },
  'VKNGW-2': { name: 'Viking 2', capacityMW: 121.8, farm: 'Viking' },
  'VKNGW-3': { name: 'Viking 3', capacityMW: 121.8, farm: 'Viking' },
  'VKNGW-4': { name: 'Viking 4', capacityMW: 121.8, farm: 'Viking' },

  // Argyll and Perthshire
  'ACHRW-1': { name: 'A’Chruach', capacityMW: 42.6, farm: 'A’Chruach' },
  'ANSUW-1': { name: 'An Suidhe', capacityMW: 19.36, farm: 'An Suidhe' },
  'CRGHW-1': { name: 'Carraig Gheal', capacityMW: 46, farm: 'Carraig Gheal' },
  'COUWW-1': { name: 'Cour', capacityMW: 20.5, farm: 'Cour' },
  'FSDLW-1': { name: 'Freasdail', capacityMW: 22.2, farm: 'Freasdail' },
  'GRIFW-1': { name: 'Griffin 1', capacityMW: 102, farm: 'Griffin' },
  'GRIFW-2': { name: 'Griffin 2', capacityMW: 104, farm: 'Griffin' },

  // Lanarkshire and the central belt
  'BLLA-1': { name: 'Black Law', capacityMW: 118, farm: 'Black Law' },
  'BLLA-2': { name: 'Black Law Ext', capacityMW: 69, farm: 'Black Law' },
  'BROCW-1': { name: 'Broken Cross', capacityMW: 48, farm: 'Broken Cross' },
  'CLDCW-1': { name: 'Clyde Central', capacityMW: 200, farm: 'Clyde' },
  'CLDNW-1': { name: 'Clyde North', capacityMW: 200, farm: 'Clyde' },
  'CLDSW-1': { name: 'Clyde South', capacityMW: 150, farm: 'Clyde' },
  'CUMHW-1': { name: 'Cumberhead', capacityMW: 52, farm: 'Cumberhead' },
  'CUMHW-2': { name: 'Cumberhead West', capacityMW: 126, farm: 'Cumberhead' },
  'DALQW-1': { name: 'Dalquhandy', capacityMW: 42.846, farm: 'Dalquhandy' },
  'DOUGW-1': { name: 'Douglas West', capacityMW: 45, farm: 'Douglas West' },
  'DWEXW-1': { name: 'Douglas West Ext', capacityMW: 65.51, farm: 'Douglas West' },
  'GLWSW-1': { name: 'Galawhistle', capacityMW: 55.2, farm: 'Galawhistle' },
  'HAHAW-1': { name: 'Hagshaw Hill', capacityMW: 30.258, farm: 'Hagshaw Hill' },
  'KENNW-1': { name: 'Kennoxhead', capacityMW: 60, farm: 'Kennoxhead' },
  'KPMRW-1': { name: 'Kype Muir', capacityMW: 89, farm: 'Kype Muir' },
  'KYPEW-1': { name: 'Kype Muir Ext', capacityMW: 67, farm: 'Kype Muir' },
  'MIDMW-1': { name: 'Middle Muir', capacityMW: 51, farm: 'Middle Muir' },
  'WHILW-1': { name: 'Whitelee', capacityMW: 309, farm: 'Whitelee' },
  'WHILW-2': { name: 'Whitelee Ext', capacityMW: 206, farm: 'Whitelee' },

  // Borders and Lothians
  'AKGLW-2': { name: 'Aikengall II', capacityMW: 63.84, farm: 'Aikengall' },
  'AKGLW-3': { name: 'Aikengall IIa', capacityMW: 163.4, farm: 'Aikengall' },
  'CRYRW-2': { name: 'Crystal Rig II', capacityMW: 150.62, farm: 'Crystal Rig' },
  'CRYRW-3': { name: 'Crystal Rig III', capacityMW: 13.8, farm: 'Crystal Rig' },
  'CRYRW-4': { name: 'Crystal Rig IV', capacityMW: 48.2, farm: 'Crystal Rig' },
  'DNLWW-1': { name: 'Dun Law Ext', capacityMW: 29.75, farm: 'Dun Law' },
  'FALGW-1': { name: 'Fallago Rig', capacityMW: 144, farm: 'Fallago Rig' },
  'PGBIW-1': { name: 'Pogbie', capacityMW: 10, farm: 'Pogbie' },
  'TDBNW-1': { name: 'Toddleburn', capacityMW: 31.6, farm: 'Toddleburn' },

  // Ayrshire, Dumfries and Galloway
  'AFTOW-1': { name: 'Afton', capacityMW: 50, farm: 'Afton' },
  'ARCHW-1': { name: 'Arecleoch', capacityMW: 114, farm: 'Arecleoch' },
  'BENBW-1': { name: 'Benbrack', capacityMW: 67, farm: 'Benbrack' },
  'BLKWW-1': { name: 'Blackcraig', capacityMW: 56.216, farm: 'Blackcraig' },
  'CRDEW-1': { name: 'Crossdykes 1', capacityMW: 24, farm: 'Crossdykes' },
  'CRDEW-2': { name: 'Crossdykes 2', capacityMW: 24, farm: 'Crossdykes' },
  'DRSLW-1': { name: 'Dersalloch', capacityMW: 70.9, farm: 'Dersalloch' },
  'ENHLW-1': { name: 'Enoch Hill', capacityMW: 70, farm: 'Enoch Hill' },
  'EWHLW-1': { name: 'Ewe Hill II', capacityMW: 38, farm: 'Ewe Hill' },
  'GNAPW-1': { name: 'Glen App', capacityMW: 22, farm: 'Glen App' },
  'HADHW-1': { name: 'Hadyard Hill', capacityMW: 130, farm: 'Hadyard Hill' },
  'HRSTW-1': { name: 'Harestanes', capacityMW: 142.3, farm: 'Harestanes' },
  'KLGLW-1': { name: 'Kilgallioch', capacityMW: 252.66, farm: 'Kilgallioch' },
  'KTHLW-1': { name: 'Keith Hill', capacityMW: 4.54, farm: 'Keith Hill' },
  'MKHLW-1': { name: 'Mark Hill', capacityMW: 53.84, farm: 'Mark Hill' },
  'MYGPW-1': { name: 'Minnygap', capacityMW: 25, farm: 'Minnygap' },
  'NOKYW-1': { name: 'North Kyle 1', capacityMW: 106, farm: 'North Kyle' },
  'NOKYW-2': { name: 'North Kyle 2', capacityMW: 106, farm: 'North Kyle' },
  'PLOEW-1': { name: 'Pencloe', capacityMW: 81, farm: 'Pencloe' },
  'SAKNW-1': { name: 'Sandy Knowe', capacityMW: 87, farm: 'Sandy Knowe' },
  'SANQW-1': { name: 'Sanquhar', capacityMW: 32.08, farm: 'Sanquhar' },
  'SOKYW-1': { name: 'South Kyle', capacityMW: 426.916, farm: 'South Kyle' },
  'TRLGW-1': { name: 'Tralorg', capacityMW: 18.742, farm: 'Tralorg' },
  'TWSHW-1': { name: 'Twentyshilling', capacityMW: 37.8, farm: 'Twentyshilling' },
  'WDRGW-1': { name: 'Windy Rig', capacityMW: 42.8, farm: 'Windy Rig' },
  'WHIHW-1': { name: 'Whiteside Hill', capacityMW: 27.52, farm: 'Whiteside Hill' },
  'WISTW-2': { name: 'Brockloch Rig II', capacityMW: 61.5, farm: 'Windy Standard' },
};

export const SCOTTISH_WIND_IDS = Object.keys(SCOTTISH_WIND_BMUS);
export const SCOTTISH_WIND_SET = new Set(SCOTTISH_WIND_IDS);

export const TRACKED_CAPACITY_MW = Object.values(SCOTTISH_WIND_BMUS).reduce(
  (sum, unit) => sum + unit.capacityMW,
  0
);
