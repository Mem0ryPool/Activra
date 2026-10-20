import { addDays, weekdayOf } from '../recurrence'

/**
 * Calendar arithmetic on YYYY-MM-DD keys (local dates, whole days), shared by the parser and the
 * progress rules. Weeks start on Monday, as on the statistics calendar.
 */

export { addDays, weekdayOf }

const pad = (n: number): string => String(n).padStart(2, '0')

export function makeKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

export function splitKey(key: string): [number, number, number] {
  return key.split('-').map(Number) as [number, number, number]
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Number of days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = splitKey(a)
  const [by, bm, bd] = splitKey(b)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Same day `months` later, clamped to the month's end (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(key: string, months: number): string {
  const [y, m, d] = splitKey(key)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return makeKey(year, month, Math.min(d, daysInMonth(year, month)))
}

export function endOfMonth(key: string): string {
  const [y, m] = splitKey(key)
  return makeKey(y, m, daysInMonth(y, m))
}

export function endOfYear(key: string): string {
  return makeKey(splitKey(key)[0], 12, 31)
}

/** Monday of the week containing the date. */
export function startOfWeek(key: string): string {
  return addDays(key, -((weekdayOf(key) + 6) % 7))
}

/** Sunday of the week containing the date. */
export function endOfWeek(key: string): string {
  return addDays(startOfWeek(key), 6)
}

/** The given weekday (0 = Sunday) in the Monday-based week that contains `key`. */
export function weekdayInWeek(key: string, weekday: number): string {
  return addDays(startOfWeek(key), (weekday + 6) % 7)
}

/** The first date on or after `from` that falls on `weekday`. */
export function nextWeekday(from: string, weekday: number): string {
  return addDays(from, (weekday - weekdayOf(from) + 7) % 7)
}

/** Length in days of "N units" starting on `start` (months and years follow the calendar). */
export function spanDays(start: string, amount: number, unit: 'day' | 'week' | 'month' | 'year'): number {
  switch (unit) {
    case 'day':
      return amount
    case 'week':
      return amount * 7
    case 'month':
      return daysBetween(start, addMonths(start, amount))
    case 'year':
      return daysBetween(start, addMonths(start, amount * 12))
  }
}

/** Last day (inclusive) of a window of `days` days starting on `start`. */
export function windowEnd(start: string, days: number): string {
  return addDays(start, days - 1)
}
