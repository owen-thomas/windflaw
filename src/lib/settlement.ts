/**
 * Settlement period maths.
 *
 * Britain's electricity settlement day runs on London local time, not UTC:
 * period 1 begins at 00:00 local. Under BST that is 23:00 UTC the previous
 * day, so a naive UTC calculation is an hour out for half the year.
 * Clock-change days have 46 or 50 periods rather than 48.
 *
 * Shared by the serverless functions (which query Elexon by settlement date
 * and period) and the client (which needs to know when rollover is due).
 */

export interface SettlementRef {
  /** Settlement date, YYYY-MM-DD, London local. */
  date: string;
  /** 1-based settlement period within that date. */
  period: number;
  /** ISO instant the period opens. */
  periodStart: string;
  /** ISO instant the period closes. */
  periodEnd: string;
}

const MS_PER_PERIOD = 30 * 60 * 1000;

/**
 * Minutes London is ahead of UTC at the given instant (0 or 60).
 * Derived by formatting the instant in London and diffing against UTC —
 * avoids shipping a timezone table.
 */
export function londonOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // en-GB with hour12:false renders midnight as 24; normalise.
  const asIfUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second')
  );

  // Drop sub-second precision on both sides so the difference is a clean offset.
  const instant = Math.floor(at.getTime() / 1000) * 1000;
  return (asIfUTC - instant) / 60_000;
}

/** London local date of the given instant, YYYY-MM-DD. */
export function londonDateISO(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * The UTC instant at which the given London local date begins.
 * Guess-and-correct: the offset at UTC midnight may differ from the offset
 * at true local midnight on a clock-change day, so we re-check once.
 */
export function londonMidnight(dateISO: string): Date {
  const [year, month, day] = dateISO.split('-').map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);

  const firstGuess = utcMidnight - londonOffsetMinutes(new Date(utcMidnight)) * 60_000;
  const corrected = utcMidnight - londonOffsetMinutes(new Date(firstGuess)) * 60_000;
  return new Date(corrected);
}

/** Number of settlement periods in a London local date (46, 48 or 50). */
export function periodsInDay(dateISO: string): number {
  const start = londonMidnight(dateISO).getTime();
  const end = londonMidnight(addDays(dateISO, 1)).getTime();
  return Math.round((end - start) / MS_PER_PERIOD);
}

/** Shift a YYYY-MM-DD string by whole days. */
export function addDays(dateISO: string, days: number): string {
  const [year, month, day] = dateISO.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Bounds of a given settlement date and period. */
export function periodBounds(dateISO: string, period: number): { start: Date; end: Date } {
  const midnight = londonMidnight(dateISO).getTime();
  const start = midnight + (period - 1) * MS_PER_PERIOD;
  return { start: new Date(start), end: new Date(start + MS_PER_PERIOD) };
}

/** The settlement date and period containing the given instant. */
export function settlementAt(at: Date = new Date()): SettlementRef {
  const date = londonDateISO(at);
  const midnight = londonMidnight(date).getTime();
  const period = Math.floor((at.getTime() - midnight) / MS_PER_PERIOD) + 1;
  const { start, end } = periodBounds(date, period);
  return {
    date,
    period,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  };
}

/** The settlement period immediately before the given one. */
export function previousPeriod(ref: Pick<SettlementRef, 'date' | 'period'>): SettlementRef {
  const date = ref.period > 1 ? ref.date : addDays(ref.date, -1);
  const period = ref.period > 1 ? ref.period - 1 : periodsInDay(date);
  const { start, end } = periodBounds(date, period);
  return {
    date,
    period,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  };
}

/** Milliseconds until the given period closes. Negative once it has. */
export function msUntilRollover(ref: SettlementRef, now: Date = new Date()): number {
  return Date.parse(ref.periodEnd) - now.getTime();
}
