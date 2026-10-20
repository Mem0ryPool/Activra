import { dayKey } from '../../../shared/dates'
import type { Translate } from '../../../shared/i18n'
import { addDays } from '../../../shared/recurrence'
import type { Locale, TaskWindow } from '../../../shared/types'
import { formatDateKey } from './recurrenceText'

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local HH:MM of an instant. */
export function clockTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "今天" / "明天" / "10月18日周日" for the local day of an instant, relative to `now`. */
function dayLabel(iso: string, now: number, t: Translate, locale: Locale): string {
  const key = dayKey(new Date(iso))
  const today = dayKey(new Date(now))
  if (key === today) return t('due.today')
  if (key === addDays(today, 1)) return t('due.tomorrow')
  return formatDateKey(key, locale)
}

/**
 * "14:07 – 15:07" when the window is today; otherwise with its day ("明天 00:07 – 01:07"), and the
 * end's day too when the window crosses midnight ("23:30 – 明天 00:30").
 */
export function formatWindow(window: TaskWindow, now: number, t: Translate, locale: Locale): string {
  const today = dayKey(new Date(now))
  const startDay = dayKey(new Date(window.start))
  // The end is exclusive: a window ending at 00:00 belongs to the day before.
  const endDay = dayKey(new Date(Date.parse(window.end) - 1))
  const start = startDay === today ? clockTime(window.start) : `${dayLabel(window.start, now, t, locale)} ${clockTime(window.start)}`
  const end = endDay === startDay ? clockTime(window.end) : `${dayLabel(window.end, now, t, locale)} ${clockTime(window.end)}`
  return `${start} – ${end}`
}

/** "14:07" for an instant today; otherwise with its day ("明天 00:07"). */
export function formatInstant(iso: string, now: number, t: Translate, locale: Locale): string {
  return dayKey(new Date(iso)) === dayKey(new Date(now)) ? clockTime(iso) : `${dayLabel(iso, now, t, locale)} ${clockTime(iso)}`
}
