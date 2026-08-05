import type { Source } from './types';

/**
 * The seven V1 sources: the five from the map screenshot plus Clyde and
 * Whitelee. Coordinates are approximate — fine for V1, this is not a data
 * product yet. Two sit off the mainland polygon (Edinbane on Skye, Seagreen
 * offshore) and carry an `anchor` snapping them to the nearest mainland
 * coast point, so every emitted line lives in one connected landmass.
 */
export const SOURCES: Source[] = [
  {
    id: 'edinbane',
    name: 'Edinbane Wind Farm',
    latLon: [57.47, -6.42],
    anchor: [57.28, -5.65], // Kyle of Lochalsh
    type: 'wind',
    rate: 12,
    palette: 'a',
  },
  {
    id: 'seagreen',
    name: 'Seagreen Offshore',
    latLon: [56.6, -1.9],
    anchor: [56.65, -2.42], // Angus coast
    type: 'wind',
    rate: 12,
    palette: 'b',
  },
  {
    id: 'cumberhead',
    name: 'Cumberhead Wind Farm',
    latLon: [55.55, -3.92],
    type: 'wind',
    rate: 12,
    palette: 'c',
  },
  {
    id: 'hagshawhill',
    name: 'Hagshaw Hill Wind Farm',
    latLon: [55.57, -3.88],
    type: 'wind',
    rate: 12,
    palette: 'd',
  },
  {
    id: 'northkyle',
    name: 'North Kyle Wind Farm',
    latLon: [55.3517, -4.3597],
    type: 'wind',
    rate: 12,
    palette: 'e',
  },
  {
    id: 'clyde',
    name: 'Clyde Wind Farm',
    latLon: [55.46, -3.95],
    type: 'wind',
    rate: 12,
    palette: 'f',
  },
  {
    id: 'whitelee',
    name: 'Whitelee Wind Farm',
    latLon: [55.68, -4.28],
    type: 'wind',
    rate: 12,
    palette: 'g',
  },
];

/** The point a source actually emits from: its anchor if it has one. */
export function originOf(source: Source): [number, number] {
  return source.anchor ?? source.latLon;
}
