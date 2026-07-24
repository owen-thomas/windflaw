/**
 * Fuel ordering for the mix bars.
 *
 * Segments run zero-carbon first, then the ambiguous middle, then fossil. The
 * order is the point: with both regions drawn on the same scale and the same
 * sequence, the length of the fossil tail is directly comparable north to
 * south, and the paradox is legible before a single number is read.
 *
 * Ordering by carbon rather than by size also keeps a segment in the same
 * place between refreshes, which matters once the bars animate.
 */

export const FUEL_ORDER = [
  'wind',
  'hydro',
  'solar',
  'nuclear',
  'biomass',
  'imports',
  'gas',
  'coal',
  'other',
] as const;

export type Fuel = (typeof FUEL_ORDER)[number];

/** Where the fossil tail begins, for the "carbon-bearing" divider on the bar. */
export const FOSSIL_FUELS = new Set<string>(['gas', 'coal']);

export function orderMix<T extends { fuel: string; perc: number }>(mix: T[]): T[] {
  const rank = (fuel: string) => {
    const index = FUEL_ORDER.indexOf(fuel as Fuel);
    return index === -1 ? FUEL_ORDER.length : index;
  };
  return [...mix].sort((a, b) => rank(a.fuel) - rank(b.fuel));
}
