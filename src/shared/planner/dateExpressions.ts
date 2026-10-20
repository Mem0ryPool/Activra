import { isDateKey } from '../dates'
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  endOfYear,
  makeKey,
  nextWeekday,
  splitKey,
  weekdayInWeek,
  weekdayOf
} from './dateMath'
import type { DraftIssueCode } from './types'

/**
 * Date words in Chinese and English → a local date key, counted from `today`. Each expression is
 * matched by the regex sources below (embedded by the parser into larger patterns) and resolved by
 * `resolveDate`. A reading that could be two different days is returned with an issue, never silently.
 */

const ZH_WEEKDAY = '[一二三四五六日天1-7]'
const ZH_WEEK_WORD = '(?:周|星期|礼拜)'

/** Chinese date expressions (no capture groups). */
export const ZH_DATE = [
  '大后天',
  '后天',
  '明天',
  '明日',
  '今天',
  '今日',
  '今晚',
  `(?:下个?|本|这个?)?${ZH_WEEK_WORD}${ZH_WEEKDAY}`,
  '(?:下个?|本|这个?)?周末',
  '(?:下个?|本|这个)?月(?:底|末)',
  '(?:今|本)?年(?:底|末)',
  '\\d{4}\\s*[年./-]\\s*\\d{1,2}\\s*[月./-]\\s*\\d{1,2}\\s*[日号]?',
  '\\d{1,2}\\s*月\\s*\\d{1,2}\\s*[日号]?',
  '\\d{1,2}/\\d{1,2}(?![\\d/])',
  '(?:本|这|下)(?:个)?(?:周|星期)(?![一二三四五六日天1-7末])'
].join('|')

const EN_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const EN_DAY = '(?:mon|tues|tue|wednes|wed|thurs|thu|fri|satur|sat|sun)(?:day)?'
const EN_MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?'

/** English date expressions (no capture groups). Matched case-insensitively. */
export const EN_DATE = [
  'the day after tomorrow',
  'tomorrow',
  'today',
  'tonight',
  `(?:this |next |coming )?${EN_DAY}\\b`,
  '(?:this |next )?weekend',
  '(?:the )?end of (?:the |this |next )?(?:week|month|year)',
  'month end',
  `${EN_MONTH} \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?`,
  `\\d{1,2}(?:st|nd|rd|th)? (?:of )?${EN_MONTH}(?:,? \\d{4})?`,
  '\\d{4}-\\d{1,2}-\\d{1,2}',
  '\\d{1,2}/\\d{1,2}(?:/\\d{4})?'
].join('|')

export interface ResolvedDate {
  date: string
  issue: DraftIssueCode | null
}

function zhWeekday(ch: string): number {
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, '7': 0 }
  return map[ch] ?? Number(ch)
}

function enWeekday(word: string): number {
  return EN_DAYS.findIndex((d) => d.startsWith(word.slice(0, 3)))
}

function enMonth(word: string): number {
  return EN_MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1
}

/** A month/day without a year: this year, or next year if that date has passed (flagged). */
function monthDay(today: string, month: number, day: number, year: number | null): ResolvedDate | null {
  const thisYear = splitKey(today)[0]
  const key = makeKey(year ?? thisYear, month, day)
  if (!isDateKey(key)) return null
  if (year !== null || key >= today) return { date: key, issue: null }
  const next = makeKey(thisYear + 1, month, day)
  return isDateKey(next) ? { date: next, issue: 'year-assumed' } : null
}

/** A bare weekday ("周五", "Friday"): the next one on or after today; said on that very day it is ambiguous. */
function bareWeekday(today: string, weekday: number): ResolvedDate {
  const date = nextWeekday(today, weekday)
  return { date, issue: date === today ? 'ambiguous-date' : null }
}

function resolveZh(text: string, today: string): ResolvedDate | null {
  const s = text.replace(/\s+/g, '')
  const fixed: Record<string, number> = { 今天: 0, 今日: 0, 今晚: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3 }
  if (s in fixed) return { date: addDays(today, fixed[s] as number), issue: null }
  let m = /^(下个?|本|这个?)?(?:周|星期|礼拜)([一二三四五六日天1-7])$/.exec(s)
  if (m) {
    const weekday = zhWeekday(m[2]!)
    if (!m[1]) return bareWeekday(today, weekday)
    return { date: weekdayInWeek(m[1].startsWith('下') ? addDays(today, 7) : today, weekday), issue: null }
  }
  m = /^(下个?|本|这个?)?周末$/.exec(s)
  if (m) return { date: endOfWeek(m[1]?.startsWith('下') ? addDays(today, 7) : today), issue: null }
  m = /^(下个?|本|这个)?月(?:底|末)$/.exec(s)
  if (m) return { date: endOfMonth(m[1]?.startsWith('下') ? addMonths(today, 1) : today), issue: null }
  if (/^(?:今|本)?年(?:底|末)$/.test(s)) return { date: endOfYear(today), issue: null }
  m = /^(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})[日号]?$/.exec(s)
  if (m) return monthDay(today, Number(m[2]), Number(m[3]), Number(m[1]))
  m = /^(\d{1,2})月(\d{1,2})[日号]?$/.exec(s) ?? /^(\d{1,2})\/(\d{1,2})$/.exec(s)
  if (m) return monthDay(today, Number(m[1]), Number(m[2]), null)
  m = /^(本|这|下)个?(?:周|星期)$/.exec(s)
  if (m) {
    // "下周" as a deadline: by the end of next week, or before next week starts? Ask.
    return m[1] === '下' ? { date: endOfWeek(addDays(today, 7)), issue: 'ambiguous-date' } : { date: endOfWeek(today), issue: null }
  }
  return null
}

function resolveEn(text: string, today: string): ResolvedDate | null {
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (s === 'today' || s === 'tonight') return { date: today, issue: null }
  if (s === 'tomorrow') return { date: addDays(today, 1), issue: null }
  if (s === 'the day after tomorrow') return { date: addDays(today, 2), issue: null }
  let m = new RegExp(`^(this |next |coming )?(${EN_DAY})$`).exec(s)
  if (m) {
    const weekday = enWeekday(m[2]!)
    if (!m[1] || m[1] === 'coming ') return bareWeekday(today, weekday)
    if (m[1] === 'this ') return { date: weekdayInWeek(today, weekday), issue: null }
    // "next Friday" means the coming Friday to some and the one a week later to others.
    return { date: weekdayInWeek(addDays(today, 7), weekday), issue: 'ambiguous-date' }
  }
  m = /^(this |next )?weekend$/.exec(s)
  if (m) return { date: endOfWeek(m[1] === 'next ' ? addDays(today, 7) : today), issue: null }
  m = /^(?:the )?end of (?:the |this |(next ))?(week|month|year)$/.exec(s)
  if (m) {
    const next = !!m[1]
    if (m[2] === 'week') return { date: endOfWeek(next ? addDays(today, 7) : today), issue: null }
    if (m[2] === 'month') return { date: endOfMonth(next ? addMonths(today, 1) : today), issue: null }
    return { date: next ? endOfYear(addMonths(today, 12)) : endOfYear(today), issue: null }
  }
  if (s === 'month end') return { date: endOfMonth(today), issue: null }
  m = new RegExp(`^(${EN_MONTH}) (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?$`).exec(s)
  if (m) return monthDay(today, enMonth(m[1]!), Number(m[2]), m[3] ? Number(m[3]) : null)
  m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${EN_MONTH})(?:,? (\\d{4}))?$`).exec(s)
  if (m) return monthDay(today, enMonth(m[2]!), Number(m[1]), m[3] ? Number(m[3]) : null)
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return monthDay(today, Number(m[2]), Number(m[3]), Number(m[1]))
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(s)
  if (m) return monthDay(today, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null)
  return null
}

/** Resolves one matched date expression (Chinese or English). Null if it is not a real date. */
export function resolveDate(text: string, today: string): ResolvedDate | null {
  return resolveZh(text, today) ?? resolveEn(text, today)
}

/** Weekdays named in a list such as "一三五", "周一、周三和周五", "Monday and Thursday", "Mon/Wed/Fri". */
export function parseWeekdayList(text: string): number[] {
  const days = new Set<number>()
  const zh = text.replace(/(?:周|星期|礼拜)/g, '')
  for (const ch of zh) if ('一二三四五六日天'.includes(ch)) days.add(zhWeekday(ch))
  for (const m of text.toLowerCase().matchAll(new RegExp(EN_DAY, 'g'))) {
    const index = enWeekday(m[0])
    if (index >= 0) days.add(index)
  }
  return [...days].sort((a, b) => a - b)
}

export { weekdayOf }
