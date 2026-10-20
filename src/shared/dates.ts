/**
 * Local calendar dates as "YYYY-MM-DD" keys. Day arithmetic works on calendar fields, never on
 * fixed 24-hour steps, so daylight-saving days and midnight land on the right date.
 */

const pad = (n: number): string => String(n).padStart(2, '0')

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** The local date of `date` as YYYY-MM-DD. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** True for a real calendar date in YYYY-MM-DD form (rejects e.g. 2026-02-30). */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}
