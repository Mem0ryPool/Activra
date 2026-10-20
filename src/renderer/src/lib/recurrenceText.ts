import type { Translate } from '../../../shared/i18n'
import { normalizeRule, type RecurrenceRule } from '../../../shared/recurrence'
import type { Locale } from '../../../shared/types'

/** Short weekday name; 2023-01-01 was a Sunday. */
export function weekdayName(day: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2023, 0, 1 + day))
}

/** A date key shown as e.g. "Mon, Oct 19" / "10月19日 周一". */
export function formatDateKey(key: string, locale: Locale): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short' }).format(
    new Date(y, m - 1, d)
  )
}

/** "Every 2 weeks on Mon, Wed until Dec 31" in the current language. */
export function describeRule(input: RecurrenceRule, t: Translate, locale: Locale): string {
  // A rule still being edited may carry the unit of an earlier choice; the preset decides.
  const rule = normalizeRule(input)
  // Monday first in the list, Sunday last.
  const days = [...rule.weekdays]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => weekdayName(d, locale))
    .join(locale === 'zh-CN' ? '、' : ', ')
  let text: string
  if (rule.preset === 'daily') text = t('repeat.daily')
  else if (rule.preset === 'weekdays') text = t('repeat.weekdays')
  else if (rule.unit === 'day')
    text = rule.interval === 1 ? t('repeat.daily') : t('repeat.everyNDays', { n: rule.interval })
  else text = rule.interval === 1 ? t('repeat.weekly', { days }) : t('repeat.everyNWeeks', { n: rule.interval, days })
  if (rule.endDate) text += ` ${t('repeat.until', { date: formatDateKey(rule.endDate, locale) })}`
  return text
}
