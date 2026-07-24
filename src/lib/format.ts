/**
 * Display formatting. British English, London local time, plain register.
 *
 * The rules that matter here are honesty rules rather than style rules:
 * figures are rounded to a precision the data can actually support, and
 * times are shown in the clock the settlement day runs on.
 */

const LONDON = 'Europe/London';

/** Whole MW. The derivation is not precise enough to justify decimals. */
export function formatMW(mw: number): string {
  return `${Math.round(mw).toLocaleString('en-GB')} MW`;
}

/**
 * MWh, one decimal below 100 and whole above. Sub-100 periods are usually a
 * handful of units, where the tenth is meaningful; above that it is noise.
 */
export function formatMWh(mwh: number): string {
  const value = mwh < 100 ? Math.round(mwh * 10) / 10 : Math.round(mwh);
  return `${value.toLocaleString('en-GB')} MWh`;
}

/** Whole percent for prose and stat blocks; bars use the raw value. */
export function formatPct(pct: number): string {
  return `${Math.round(pct)}%`;
}

export function formatIntensity(gco2: number | null): string {
  return gco2 === null ? 'unknown' : `${Math.round(gco2)} gCO₂/kWh`;
}

/** Clock time in London local, 24-hour. */
export function formatTime(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** "20:30 to 21:00" — the span a settlement period covers, London local. */
export function formatPeriodSpan(periodStart: string, periodEnd: string): string {
  return `${formatTime(periodStart)} to ${formatTime(periodEnd)}`;
}

/**
 * Age in words. Deliberately coarse: the data moves in half-hours, so
 * second-level precision would imply a liveness the product does not have.
 */
export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'moments ago';
  if (minutes === 1) return 'a minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'an hour ago';
  return `${hours} hours ago`;
}

/** Join a list the way a person would write it. */
export function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Sentence-case a fuel key for display ("gas" → "Gas"). */
export function fuelLabel(fuel: string): string {
  if (fuel === 'imports') return 'Imports';
  return fuel.charAt(0).toUpperCase() + fuel.slice(1);
}
