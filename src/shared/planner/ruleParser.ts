import { generateAchievement, type PlanLanguage } from './achievements'
import { addDays, daysBetween, endOfMonth, endOfWeek, endOfYear, spanDays, startOfWeek, addMonths } from './dateMath'
import { EN_DATE, parseWeekdayList, resolveDate, ZH_DATE, type ResolvedDate } from './dateExpressions'
import { draftCondition, masterForGoals } from './draft'
import { EN_NUMBER, parseNumber, parseTimesWord, ZH_NUMBER } from './numbers'
import { suggestPlanTitle } from './naming'
import { categorize } from './templates'
import type { DraftGoal, DraftIssue, DraftIssueCode, ParseOptions, PlanDraft, PlanParser, Quantity } from './types'

/**
 * The offline rule-based parser: dictionaries + regular expressions + the local date module.
 * It reads what the text says and nothing more. A number or date the text does not give stays null
 * (the preview then asks for it), and a reading that could go two ways is returned with an issue for
 * the user to confirm. It never decides that anything is achieved.
 *
 * Supported (Chinese and English):
 * - several goals separated by punctuation, "和/并且/同时" or "and"; "然后/接着/之后/再" or
 *   "then/after that" makes the goal a step after the previous one (a chain);
 * - a leading range ("未来30天", "for the next 30 days") applies to every repeating goal without its own;
 *   a range on its own after a goal ("持续30天") belongs to that goal;
 * - ranges: N 天/周/个月/年, 本周/本月/今年/下周/下个月, 从…到…, 从…开始, until …;
 * - deadlines: …之前/前/为止, 截止…, by/before/due …, N 天内 (one-off goals);
 * - frequency: 每天/每晚/每隔N天/工作日/周末/每周N次/每周一三五, daily/every other day/N times a week/on Mondays;
 * - totals (共10次, 10 times), streaks (连续7天, 7 days in a row), quantities (20个单词, 5 km);
 * - vague words (尽量, 多, a few, often) are flagged;
 * - timed windows (Phase 6.1): "接下来4小时每小时喝水", "每小时喝水，持续四小时", "2小时内完成",
 *   "drink water every hour for the next 4 hours", "within 2 hours" become an interval goal of
 *   back-to-back windows placed when the plan is confirmed. Hourly words next to a day rule
 *   ("每天每小时"), a clock time or a start date cannot be placed reliably and are flagged.
 */

const re = (source: string, flags = 'i'): RegExp => new RegExp(source, flags)

type Unit = 'day' | 'week' | 'month' | 'year'

interface Range {
  start: string | null
  days: number | null
  end: string | null
  /** A span in minutes ("接下来4小时", "for 2 hours"): only interval goals can use it. */
  minutes?: number | null
  text: string
  issue: DraftIssueCode | null
}

// ---------------------------------------------------------------------------------------------
// Timed windows (hours / minutes)

/** Minutes and spans of interval goals. */
interface Hourly {
  /** Minutes per window ("每小时" → 60), or null when only a span is given. */
  every: number | null
  /** Total span in minutes ("接下来4小时" → 240), or null when not given. */
  span: number | null
  /** "喝水3次" next to a span: how many windows the span is split into. */
  total: number | null
  /** "每小时喝水2次": more than once per window, which a node cannot express. */
  perWindowExtra: string | null
  text: string
}

const ZH_HOUR_AMOUNT = `(${ZH_NUMBER}|半)\\s*(个)?(半)?\\s*(小时|钟头|分钟)`
const EN_HOUR_UNIT = '(hours?|hrs?|minutes?|mins?)'

/** "4个小时" → 240, "半小时" → 30, "一个半小时" → 90, "30分钟" → 30. */
function zhMinutes(amount: string, half: string | undefined, unit: string): number | null {
  const minutesUnit = unit === '分钟'
  const n = amount === '半' ? 0.5 : num(amount)
  if (n === null) return null
  const value = (n + (half ? 0.5 : 0)) * (minutesUnit ? 1 : 60)
  return Number.isInteger(value) && value > 0 ? value : null
}

function enMinutes(amount: string, unit: string): number | null {
  const half = /^half an?$/i.test(amount)
  const n = half ? 0.5 : num(amount)
  if (n === null) return null
  const value = n * (/^m/i.test(unit) ? 1 : 60)
  return Number.isInteger(value) && value > 0 ? value : null
}

/** Words that make a goal a day-based rule; hourly windows next to them are not supported. */
const DAY_RULE = re(
  '每天|每日|天天|每晚|每早|每个?早上|每个?晚上|每个?早晨|每夜|每周|每星期|每个?礼拜|工作日|周末|每隔\\s*\\S{1,3}\\s*天|隔天|连续\\s*\\S{1,3}\\s*(?:天|日)|' +
    '\\b(?:daily|every ?day|each day|every (?:morning|evening|night)|nightly|weekly|every week|a week|per week|weekdays?|weekends?|in a row|every other day|every \\w+ days)\\b'
)
/** An hourly frequency word on its own, used to flag it when it cannot be used. */
const HOURLY_WORD = re('每隔?\\s*(?:\\S{1,3}\\s*)?(?:个)?(?:小时|钟头|分钟)|\\b(?:every|each) (?:\\w+ )?(?:hours?|minutes?)\\b|\\bhourly\\b')
/** A clock time or part of the day: the windows always start when the plan is confirmed. */
const CLOCK_TIME = re('\\d{1,2}\\s*(?:点|:|：)\\s*\\d{0,2}|[一二三四五六七八九十]{1,3}点|上午|下午|中午|晚上|今晚|凌晨|傍晚|\\b\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\b|\\b(?:at|from) \\d{1,2}(?::\\d{2})?\\b|\\b(?:tonight|this (?:morning|afternoon|evening))\\b')

/** Finds an hourly frequency and/or a span in hours or minutes and cuts them out. */
function takeHourly(c: Clause): Hourly | null {
  const texts: string[] = []
  let every: number | null = null
  let m: RegExpExecArray | null
  // Frequency: 每2小时 / 每隔30分钟 / 每半小时 / 每(个)小时 / 一小时一次 / every 2 hours / hourly
  m = c.take(re(`每隔?\\s*${ZH_HOUR_AMOUNT}(?:一次|1次)?`))
  if (m) every = zhMinutes(m[1]!, m[3], m[4]!)
  if (!m) {
    m = c.take(re('每(?:一)?(?:个)?(?:小时|钟头)(?:一次|1次)?')) ?? c.take(re(`(?:一|1)\\s*(?:个)?(?:小时|钟头)\\s*(?:一次|1次)`))
    if (m) every = 60
  }
  if (!m) {
    m = c.take(re(`\\b(?:once )?every (${EN_NUMBER}|half an?) ${EN_HOUR_UNIT}\\b`))
    if (m) every = enMinutes(m[1]!, m[2]!)
  }
  if (!m) {
    m = c.take(re('\\b(?:once (?:an?|per|every) hour|every hour|each hour|hourly)\\b'))
    if (m) every = 60
  }
  if (m) texts.push(m[0])
  const hasEvery = m !== null

  // Span: 接下来(的)4个小时(内) / 持续四小时 / 2小时内 / for the next 4 hours / for 2 hours / within an hour
  let span: number | null = null
  m =
    c.take(re(`(?:在)?(?:未来|接下来|今后|之后|往后|接下去|此后)(?:的)?\\s*${ZH_HOUR_AMOUNT}(?:内|之内|里|中|当中)?`)) ??
    c.take(re(`(?:持续|坚持|为期|一共|总共|共|连续|连着|整整)\\s*${ZH_HOUR_AMOUNT}(?:时间|内|之内|里)?`)) ??
    c.take(re(`${ZH_HOUR_AMOUNT}(?:内|之内|里|当中)`))
  if (m) span = zhMinutes(m[1]!, m[3], m[4]!)
  if (!m) {
    m =
      c.take(re(`\\b(?:(?:for|over|during|in|within) )?(?:the )?(?:next|coming|following) (${EN_NUMBER}|half an?) ${EN_HOUR_UNIT}\\b`)) ??
      c.take(re(`\\b(?:for|within|over) (?:a period of )?(${EN_NUMBER}|half an?) ${EN_HOUR_UNIT}\\b`))
    if (m) span = enMinutes(m[1]!, m[2]!)
  }
  if (!m) {
    m = c.take(re('\\b(?:(?:for|over|during|in|within) )?the (?:next|coming) hour\\b'))
    if (m) span = 60
  }
  if (m) texts.push(m[0])
  if (!hasEvery && span === null) return null

  // "喝一次水" / "once" is the node itself; "2次" with a frequency is more than a node can hold.
  let total: number | null = null
  let perWindowExtra: string | null = null
  if (hasEvery) {
    c.take(re('(?:一|1)\\s*次|\\bonce\\b'))
    const extra = c.find(re(`(${ZH_NUMBER})\\s*(?:次|回|杯)|\\b(${EN_NUMBER}|twice|thrice) times\\b|\\b(twice|thrice)\\b`))
    if (extra && /次|回|times|twice|thrice/i.test(extra[0])) perWindowExtra = extra[0]
  } else {
    total = takeTotal(c)
  }
  return { every, span, total, perWindowExtra, text: texts.join(' ') }
}

const ZH_UNIT = '(天|日|周|个星期|星期|个礼拜|礼拜|个月|月|年)'
const EN_UNIT = '(days?|weeks?|months?|years?)'

function zhUnit(u: string): Unit {
  if (u === '天' || u === '日') return 'day'
  if (u.includes('周') || u.includes('星期') || u.includes('礼拜')) return 'week'
  if (u.includes('月')) return 'month'
  return 'year'
}

function enUnit(u: string): Unit {
  return u.toLowerCase().replace(/s$/, '') as Unit
}

/** Full-width letters, digits and punctuation → ASCII; whitespace collapsed. */
export function normalizeText(text: string): string {
  return text
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/[“”"]/g, '"')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** A mutable clause: matched parts are cut out, and what is left becomes the title. */
class Clause {
  rest: string
  constructor(readonly text: string) {
    this.rest = text
  }
  take(re: RegExp): RegExpExecArray | null {
    const m = re.exec(this.rest)
    if (!m) return null
    this.rest = `${this.rest.slice(0, m.index)} ${this.rest.slice(m.index + m[0].length)}`
    return m
  }
  find(re: RegExp): RegExpExecArray | null {
    return re.exec(this.rest)
  }
}

function num(raw: string | undefined): number | null {
  if (raw === undefined) return null
  return parseTimesWord(raw) ?? parseNumber(raw)
}


/** Finds a time range in the clause and cuts it out. */
function takeRange(c: Clause, today: string): Range | null {
  let m: RegExpExecArray | null
  // From … to …
  m = c.take(re(`(?:从|自)?\\s*(${ZH_DATE})\\s*(?:开始)?\\s*(?:到|至|~|-|—)\\s*(${ZH_DATE})\\s*(?:为止|结束)?`))
  if (!m) m = c.take(re(`\\bfrom (${EN_DATE}) (?:to|until|till|through|-) (${EN_DATE})`))
  if (m) {
    const a = resolveDate(m[1]!, today)
    const b = resolveDate(m[2]!, today)
    if (a && b) {
      const issue = a.issue ?? b.issue
      return { start: a.date, end: b.date, days: daysBetween(a.date, b.date) + 1, text: m[0], issue }
    }
  }
  // Next N units / for N units
  m = c.take(re(`(?:在)?(?:未来|接下来|今后|之后|往后|接下去|此后)(?:的)?\\s*(${ZH_NUMBER}|半)\\s*${ZH_UNIT}(?:内|之内|里|中)?`))
  if (!m) m = c.take(re(`(?:持续|坚持|为期|一共|总共|共|连着|整整)\\s*(${ZH_NUMBER}|半)\\s*${ZH_UNIT}(?:时间|内|之内|里)?`))
  if (!m) m = c.take(re(`(${ZH_NUMBER}|半)\\s*${ZH_UNIT}(?:内|之内|里)`))
  if (m) {
    const half = m[1] === '半'
    const unit = zhUnit(m[2]!)
    const amount = half ? 0.5 : num(m[1])
    if (amount !== null) {
      const days = half ? (unit === 'month' ? 15 : unit === 'year' ? 182 : unit === 'week' ? 4 : 1) : spanDays(today, amount, unit)
      return { start: null, days, end: null, text: m[0], issue: null }
    }
  }
  m = c.take(re(`\\b(?:(?:for|over|during|in|within) )?(?:the )?(?:next|coming|following) (${EN_NUMBER}) ${EN_UNIT}\\b`))
  if (!m) m = c.take(re(`\\b(?:for|within|over) (?:a period of )?(${EN_NUMBER}) ${EN_UNIT}\\b`))
  if (!m) m = c.take(re(`\\b(?:a |an )?(\\d+)-(day|week|month)\\b(?: challenge| plan| program)?`))
  if (m) {
    const amount = num(m[1])
    if (amount !== null) return { start: null, days: spanDays(today, amount, enUnit(m[2]!)), end: null, text: m[0], issue: null }
  }
  // This week / month / year, next week / month
  m = c.take(re('(?:在)?(本周|这周|这个星期|本星期|这一周)(?:内|之内|里)?(?![一二三四五六日天末])'))
  if (!m) m = c.take(re('\\b(this week)\\b'))
  if (m) return { start: null, end: endOfWeek(today), days: daysBetween(today, endOfWeek(today)) + 1, text: m[0], issue: null }
  m = c.take(re('(?:在)?(本月|这个月|这一个月)(?:内|之内|里)?(?![底末])')) ?? c.take(re('\\b(this month)\\b'))
  if (m) return { start: null, end: endOfMonth(today), days: daysBetween(today, endOfMonth(today)) + 1, text: m[0], issue: null }
  m = c.take(re('(?:在)?(今年|本年)(?:内|之内|里)?(?![底末])')) ?? c.take(re('\\b(this year)\\b'))
  if (m) return { start: null, end: endOfYear(today), days: daysBetween(today, endOfYear(today)) + 1, text: m[0], issue: null }
  m = c.take(re('(?:在)?(下周|下个星期|下星期)(?:内|之内|里)?(?![一二三四五六日天末])')) ?? c.take(re('\\b(next week)\\b'))
  if (m) {
    const start = startOfWeek(addDays(today, 7))
    return { start, end: addDays(start, 6), days: 7, text: m[0], issue: null }
  }
  m = c.take(re('(?:在)?(下个月|下月)(?:内|之内|里)?(?![底末])')) ?? c.take(re('\\b(next month)\\b'))
  if (m) {
    const start = `${addMonths(today, 1).slice(0, 8)}01`
    return { start, end: endOfMonth(start), days: daysBetween(start, endOfMonth(start)) + 1, text: m[0], issue: null }
  }
  return null
}

/** "从下周一开始" / "starting Monday": a start date only. */
function takeStart(c: Clause, today: string): ResolvedDate & { text: string } | null {
  const m =
    c.take(re(`(?:从|自)\\s*(${ZH_DATE})\\s*(?:开始|起)|(${ZH_DATE})\\s*(?:开始|起)`)) ??
    c.take(re(`\\b(?:starting|beginning|from|start)(?: on| from)? (${EN_DATE})`))
  if (!m) return null
  const resolved = resolveDate((m[1] ?? m[2])!, today)
  return resolved ? { ...resolved, text: m[0] } : null
}

/** "周五之前", "by Friday", "截止10月20日", "3天内完成" (one-off goals). */
function takeDeadline(c: Clause, today: string): (ResolvedDate & { onTime: boolean }) | null {
  let m =
    c.take(re(`(?:在|于)?\\s*(${ZH_DATE})\\s*(?:之前|以前|前|为止|截止|截至)`)) ??
    c.take(re(`(?:截止|截至|最晚|最迟|不晚于)(?:到|日期|时间)?\\s*(${ZH_DATE})`)) ??
    c.take(re(`\\b(?:by|before|due|no later than|until|till) (?:the )?(${EN_DATE})`))
  if (m) {
    const r = resolveDate(m[1]!, today)
    if (r) return { ...r, onTime: true }
  }
  m = c.take(re(`(${ZH_NUMBER})\\s*(天|日|周|个星期|星期|个月)(?:内|之内)`)) ?? c.take(re(`\\bwithin (${EN_NUMBER}) ${EN_UNIT}`))
  if (m) {
    const amount = num(m[1])
    const unit = /[天日周星期月]/.test(m[2]!) ? zhUnit(m[2]!) : enUnit(m[2]!)
    if (amount !== null) return { date: addDays(today, spanDays(today, amount, unit) - 1), issue: null, onTime: true }
  }
  // A plain date ("周六去看牙医", "on Friday") is when it happens: kept as the deadline, but not required.
  m = c.take(re(`(?:在|于)?(${ZH_DATE})`)) ?? c.take(re(`\\b(?:on )?(${EN_DATE})`))
  if (m) {
    const r = resolveDate(m[1]!, today)
    if (r) return { ...r, onTime: false }
  }
  return null
}

function takeStreak(c: Clause): number | null {
  const m =
    c.take(re(`连续(?:打卡)?\\s*(${ZH_NUMBER})\\s*(?:天|日)(?:不间断|不断)?`)) ??
    c.take(re(`\\b(${EN_NUMBER})(?: |-)(?:days? in a row|consecutive days?|day streak|straight days?)\\b`)) ??
    c.take(re(`\\b(?:a )?streak of (${EN_NUMBER}) days?\\b`))
  return m ? num(m[1]) : null
}

interface Frequency {
  every: number | null
  weekly: boolean
  perWeek: number | null
  weekdays: number[] | null
  text: string
}

function takeFrequency(c: Clause): Frequency | null {
  let m: RegExpExecArray | null
  // Working days / weekends
  m = c.take(re('(?:每个?|所有)?工作日(?:每天)?|周一(?:到|至|-)周五|\\b(?:every |on )?weekdays\\b|\\bevery weekday\\b|monday (?:to|through|-) friday'))
  if (m) return { every: null, weekly: true, perWeek: 5, weekdays: [1, 2, 3, 4, 5], text: m[0] }
  m = c.take(re('每个?周末|\\b(?:every |on )?weekends?\\b'))
  if (m) return { every: null, weekly: true, perWeek: 2, weekdays: [0, 6], text: m[0] }
  // Explicit weekdays: 每周一三五 / 每周一、周三和周五 / every Monday and Thursday / on Mondays
  m = c.take(
    re('每(?:个)?(?:周|星期|礼拜)(?=[一二三四五六日天](?![次天回个]))([一二三四五六日天](?:\\s*(?:[、,和及与/]|以及)?\\s*(?:周|星期|礼拜)?[一二三四五六日天](?![次天回个]))*)')
  )
  if (m) {
    const days = parseWeekdayList(m[1]!)
    return { every: null, weekly: true, perWeek: days.length, weekdays: days, text: m[0] }
  }
  const DAY = '(?:mon|tues|wednes|thurs|fri|satur|sun)days?'
  m = c.take(re(`\\b(?:every|on|each) (${DAY}(?:(?:,|, and| and| &|/| or) ${DAY})*)\\b`))
  if (m) {
    const days = parseWeekdayList(m[1]!)
    if (days.length) return { every: null, weekly: true, perWeek: days.length, weekdays: days, text: m[0] }
  }
  // Per-week counts: 每周3次 / 每周健身3次 / 一周跑三天 / 3 times a week / twice a week
  m = c.take(re(`\\b(${EN_NUMBER}|once|twice|thrice)(?: times?| days?)? (?:a|per|each|every) week\\b|\\b(${EN_NUMBER}) times weekly\\b`))
  if (m) return { every: null, weekly: true, perWeek: num(m[1] ?? m[2]), weekdays: null, text: m[0] }
  const weekMarker = c.find(re('(?:每|一)(?:个)?(?:周|星期|礼拜)(?![一二三四五六日天末](?![次天回个]))'))
  if (weekMarker) {
    c.take(re('(?:每|一)(?:个)?(?:周|星期|礼拜)(?![一二三四五六日天末](?![次天回个]))'))
    const count = c.take(re(`(${ZH_NUMBER})\\s*(?:次|回|天|趟|练)(?!内|之内|里)`))
    return { every: null, weekly: true, perWeek: count ? num(count[1]) : 1, weekdays: null, text: weekMarker[0] }
  }
  m = c.take(re('\\b(?:every week|weekly)\\b'))
  if (m) return { every: null, weekly: true, perWeek: 1, weekdays: null, text: m[0] }
  // Every N days
  m = c.take(re(`每隔\\s*(${ZH_NUMBER})\\s*天`))
  if (m) {
    const n = num(m[1])
    return { every: n === null ? null : n + 1, weekly: false, perWeek: null, weekdays: null, text: m[0] }
  }
  m = c.take(re(`每\\s*(${ZH_NUMBER})\\s*天`)) ?? c.take(re(`\\bevery (${EN_NUMBER}) days\\b`))
  if (m) return { every: num(m[1]), weekly: false, perWeek: null, weekdays: null, text: m[0] }
  m = c.take(re('隔天|隔一天|\\bevery other day\\b|\\bevery second day\\b'))
  if (m) return { every: 2, weekly: false, perWeek: null, weekdays: null, text: m[0] }
  // Daily
  m = c.take(re('每天|每日|天天|日日|每晚|每早|每个?早上|每个?晚上|每个?早晨|每夜|\\b(?:every ?day|daily|each day|every morning|every evening|every night|nightly|per day)\\b|\\ba day\\b'))
  if (m) return { every: 1, weekly: false, perWeek: null, weekdays: null, text: m[0] }
  return null
}

function takeTotal(c: Clause): number | null {
  const m =
    c.take(re(`(?:共|总共|一共|累计|合计)?\\s*(${ZH_NUMBER})\\s*(?:次|回|趟)`)) ??
    c.take(re(`\\b(${EN_NUMBER}) times\\b|\\b(twice|thrice)\\b`))
  return m ? num(m[1] ?? m[2]) : null
}

const ZH_QTY_UNITS = '个小时|小时|分钟|公里|千米|个|页|章|篇|道|题|杯|组|节|遍|首|步|课|集|本|次课|套'
const EN_QTY_UNITS = 'words?|pages?|chapters?|minutes?|mins?|hours?|hrs?|km|kilometers?|kilometres?|miles?|cups?|glasses?|sets?|reps?|push-?ups?|sit-?ups?|squats?|problems?|exercises?|lessons?|songs?|steps?|books?|questions?'

/** "20个英语单词", "30分钟", "5 km": kept in the title, recorded as the goal's quantity. */
function findQuantity(text: string): Quantity | null {
  let m = re(`(\\d+(?:\\.\\d+)?|${ZH_NUMBER})\\s*(${ZH_QTY_UNITS})([\\u4e00-\\u9fa5]{0,4})`).exec(text)
  if (m) {
    const amount = /^\d/.test(m[1]!) ? Number(m[1]) : num(m[1])
    // "个" alone is a counter; the noun after it ("单词") is the unit worth showing.
    const unit = m[2] === '个' && m[3] ? m[3] : m[2]!
    if (amount !== null && amount > 0) return { amount, unit }
  }
  m = re(`\\b(\\d+(?:\\.\\d+)?|${EN_NUMBER}) (?:\\w+ )?(${EN_QTY_UNITS})\\b`).exec(text)
  if (m) {
    const amount = /^\d/.test(m[1]!) ? Number(m[1]) : num(m[1])
    if (amount !== null && amount > 0 && !/^(a|an)$/i.test(m[1]!)) return { amount, unit: m[2]! }
  }
  return null
}

const VAGUE = re('尽量|尽可能|多(?=读|做|练|喝|吃|运动|锻炼|学|写|看)|一些|几次|几个|几天|经常|偶尔|有空|有时间|适当|大概|左右|\\b(?:some|a few|several|often|sometimes|more|regularly|occasionally|when possible|try to|a bit)\\b')

const CHAIN_PREFIX = re('^\\s*(?:然后再|然后|之后再|之后|接着|随后|紧接着|再|最后|完成后|做完后|结束后|完成之后|以后|and then|then|after that|afterwards|afterward|next|finally|followed by|once (?:that is|that\'s|this is) done)[\\s,]*')
const INDEPENDENT_PREFIX = re('^\\s*(?:同时|并且|另外|还要|还有|以及|并|也要|和|and also|and|also|plus|as well as|meanwhile)[\\s,]+|^\\s*(?:同时|并且|另外|还要|还有|以及|也要)')
const FIRST_PREFIX = re('^\\s*(?:首先|先|first(?:ly)?,?)\\s*')

function cleanTitle(text: string, language: PlanLanguage): string {
  let t = text
    .replace(/\s+/g, ' ')
    // A cut-out phrase leaves a space between Chinese characters ("喝 水" from "喝一次水").
    .replace(/(?<=[\u4e00-\u9fa5]) (?=[\u4e00-\u9fa5])/g, '')
    .replace(/\s*([、,])\s*$/g, '')
    .trim()
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/^(?:我要|我想|我打算|我得|我会|我需要|打算|计划|争取|坚持|需要|要|得|的|地|在|并|和|且|之|都|还|也)\s*/u, '')
      .replace(/^(?:i want to|i'd like to|i will|i'll|i need to|i should|to|and|also|then|try to|please)\s+/i, '')
      .replace(/\s*(?:的|了|吧|呢|啊|之|一下|都要|也要|for|in|on|at|of|and|the)\s*$/iu, '')
      .replace(/^[\s,、:：\-—]+|[\s,、:：\-—.]+$/g, '')
      .trim()
  }
  if (language === 'en' && t) t = t[0]!.toUpperCase() + t.slice(1)
  return t
}

/** Marks a clause that starts with "then"; never typed by the user. */
const STEP = '\u0001'

/** Splits text into clauses, keeping whether each one was introduced as a next step. */
export function splitClauses(text: string): { text: string; chained: boolean }[] {
  const pieces: { text: string; chained: boolean }[] = []
  // Inside one sentence "…然后…" / "… then …" also start a new step.
  const marked = text
    .replace(/(然后再|然后|接着|随后|紧接着|之后再)/g, '\n\u0001$1')
    .replace(/(?<=[a-z0-9)])\s+(?=(?:and then|then|after that|afterwards|followed by)\b)/gi, '\n\u0001')
    .replace(/(?:和|并且|同时|还要|以及|另外)(?=每|天天|一周|周[一二三四五六日天]|星期|下周|本周|这周|连续|在|从|\d)/g, '\n')
    .replace(/(?<=\b(?:\w+ ){1,}\w+) and (?=(?!(?:mon|tues|wednes|thurs|fri|satur|sun)day)[a-z]+ )/gi, (match, offset: number, whole: string) => {
      const before = whole.slice(Math.max(0, whole.lastIndexOf('\n', offset)), offset)
      return /\d|every|daily|week|day|month|by |before /i.test(before) ? '\n' : match
    })
  for (const raw of marked.split(/[\n,;!?。；！？]+|\.(?=\s|$)/)) {
    const chained = raw.includes(STEP)
    const t = raw.split(STEP).join('').trim()
    if (t) pieces.push({ text: t, chained })
  }
  return pieces
}

function isOnlyRange(c: Clause): boolean {
  return cleanTitle(c.rest, 'zh').replace(/[\s,、]/g, '') === ''
}

let keySeq = 0

/** The rule-based parser (default implementation of `PlanParser`). */
export function parsePlanText(input: string, options: ParseOptions): PlanDraft {
  const { today } = options
  const text = normalizeText(input)
  const language: PlanLanguage = /[一-鿿]/.test(text) ? 'zh' : 'en'
  const goals: DraftGoal[] = []
  const unparsed: string[] = []
  let global: Range | null = null

  const clauses = splitClauses(text)
  clauses.forEach((piece, index) => {
    const c = new Clause(piece.text)
    const chained = piece.chained || CHAIN_PREFIX.test(c.rest)
    c.rest = c.rest.replace(CHAIN_PREFIX, '').replace(FIRST_PREFIX, '').replace(INDEPENDENT_PREFIX, '')

    // Hourly windows first, so "4个小时" is never read as a quantity. Next to a day rule they are
    // not used: the goal follows the day rule and the hourly words are flagged for the user.
    const dayRule = DAY_RULE.test(c.rest)
    const hourly = dayRule ? null : takeHourly(c)
    const hourlyLeft = dayRule ? HOURLY_WORD.exec(c.rest) : null
    if (hourly && hourly.every === null && hourly.total === null && hourly.span !== null && isOnlyRange(c)) {
      // A clause that is only a span ("持续四小时", "for the next 4 hours").
      const r: Range = { start: null, days: null, end: null, minutes: hourly.span, text: hourly.text, issue: null }
      const previous = goals.at(-1)
      if (previous && index > 0) applyRange(previous, r, today, language)
      else global = r
      return
    }

    const range = takeRange(c, today)
    const start = takeStart(c, today)
    // A clause that is only a range: a leading one sets the default for all goals,
    // one after a goal belongs to that goal ("每天背单词，坚持30天").
    if ((range || start) && isOnlyRange(c)) {
      const previous = goals.at(-1)
      const r: Range = range ?? { start: null, days: null, end: null, text: '', issue: null }
      if (start) {
        r.start = start.date
        r.issue ??= start.issue
      }
      if (previous && index > 0) applyRange(previous, r, today, language)
      else global = r
      return
    }
    // "未来30天每天背单词，…": a range at the very start of the text is the default for every goal.
    if (index === 0 && range && !hourly && piece.text.trimStart().startsWith(range.text.trim())) global = range
    const streak = hourly ? null : takeStreak(c)
    const frequency = hourly ? null : takeFrequency(c)
    const total = hourly ? null : frequency?.perWeek === null || !frequency ? takeTotal(c) : null
    const isOnce = !hourly && !streak && !frequency && total === null
    const deadline = isOnce ? takeDeadline(c, today) : null
    const clock = hourly ? CLOCK_TIME.exec(c.rest) : null
    const vague = VAGUE.exec(c.rest)
    const title = cleanTitle(c.rest, language)
    if (!title || !/[\p{L}\p{N}]/u.test(title)) {
      unparsed.push(piece.text)
      return
    }
    const issues: DraftIssue[] = []
    const goal: DraftGoal = {
      key: `g${++keySeq}`,
      title,
      source: piece.text,
      category: categorize(title),
      quantity: findQuantity(title),
      kind: 'once',
      startDate: null,
      days: null,
      required: null,
      every: 1,
      intervalMinutes: null,
      slots: null,
      weeks: null,
      perWeek: null,
      weekdays: null,
      due: null,
      onTime: false,
      afterPrevious: chained && goals.length > 0,
      issues,
      achievement: { name: '', description: '', icon: 'target', rarity: 'common' }
    }
    if (vague) issues.push({ code: 'vague', text: vague[0] })
    if (hourlyLeft) issues.push({ code: 'hourly-unsupported', text: hourlyLeft[0] })

    if (hourly) {
      goal.kind = 'interval'
      const { every, span, total } = hourly
      if (every !== null && span !== null) {
        goal.intervalMinutes = every
        if (span % every === 0) goal.slots = span / every
        else issues.push({ code: 'inconsistent', text: hourly.text })
      } else if (every !== null) {
        // "每小时喝水" alone: how long is left empty (or taken from a span elsewhere), never endless.
        goal.intervalMinutes = every
      } else if (span !== null && total !== null && total > 1) {
        // "4小时内喝水3次": split evenly, which the user must confirm.
        goal.slots = total
        goal.intervalMinutes = span % total === 0 ? span / total : null
        issues.push({ code: 'interval-assumed', text: piece.text })
      } else if (span !== null) {
        // "2小时内完成作业": one window.
        goal.intervalMinutes = span
        goal.slots = 1
      }
      if (every === null && span === null) issues.push({ code: 'inconsistent', text: hourly.text })
      if (hourly.perWindowExtra) issues.push({ code: 'inconsistent', text: hourly.perWindowExtra })
      if (clock) issues.push({ code: 'hourly-unsupported', text: clock[0] })
      if (range || start) issues.push({ code: 'hourly-unsupported', text: (range ?? start)!.text })
    } else if (streak !== null) {
      goal.kind = 'streak'
      goal.required = streak
    } else if (frequency?.weekly) {
      goal.kind = 'weekly'
      goal.perWeek = frequency.perWeek
      goal.weekdays = frequency.weekdays
    } else if (frequency) {
      goal.kind = 'count'
      goal.every = frequency.every ?? 1
    } else if (total !== null) {
      goal.kind = 'count'
      goal.every = 1
      goal.required = total
    } else {
      goal.kind = 'once'
      if (deadline) {
        goal.due = deadline.date
        goal.onTime = deadline.onTime
        if (deadline.issue) issues.push({ code: deadline.issue, text: piece.text })
      } else if (range && (range.end !== null || range.days !== null)) {
        // "这个月读完一本书": the range's end is the deadline.
        goal.due = range.end ?? addDays(range.start ?? today, (range.days as number) - 1)
        goal.onTime = true
        if (range.issue) issues.push({ code: range.issue, text: range.text })
      }
      if (goal.afterPrevious && goal.due) issues.push({ code: 'chain-date', text: piece.text })
    }

    goals.push(goal)
    if (goal.kind === 'interval') {
      if (goalNeedsLength(goal) && global && !goal.afterPrevious) applyRange(goal, global, today, language)
      else finishGoal(goal, language)
    } else if (goal.kind !== 'once') {
      const local: Range | null = range || start ? { ...(range ?? { start: null, days: null, end: null, text: '', issue: null }) } : null
      if (local && start) {
        local.start = start.date
        local.issue ??= start.issue
      }
      if (local) applyRange(goal, local, today, language)
      else if (global && !goal.afterPrevious) applyRange(goal, global, today, language)
      else finishGoal(goal, language)
    } else {
      finishGoal(goal, language)
    }
  })

  // A goal still missing its length gets the leading range (a range given after all goals counts too).
  if (global) for (const goal of goals) if (goal.kind !== 'once' && goalNeedsLength(goal)) applyRange(goal, global, today, language)

  const master = masterForGoals(goals, language)
  return {
    title: suggestPlanTitle(goals, { language, today, sourceText: text }),
    sourceText: input.trim(),
    goals,
    unparsed,
    master,
    language
  }
}

function goalNeedsLength(goal: DraftGoal): boolean {
  if (goal.kind === 'interval') return goal.slots === null && !goal.issues.some((i) => i.code === 'inconsistent')
  return goal.kind === 'weekly' ? goal.weeks === null : goal.days === null
}

/** Puts a range on a repeating goal: its start, and its length in days or whole weeks. */
function applyRange(goal: DraftGoal, range: Range, today: string, language: PlanLanguage): void {
  const minutes = range.minutes ?? null
  if (goal.kind === 'interval') {
    if (minutes === null) {
      // "未来30天每小时喝水": windows that repeat for days are not supported.
      if (range.text) goal.issues.push({ code: 'hourly-unsupported', text: range.text })
    } else if (goal.intervalMinutes === null) {
      goal.intervalMinutes = minutes
      goal.slots = 1
    } else if (minutes % goal.intervalMinutes === 0) {
      goal.slots = minutes / goal.intervalMinutes
    } else {
      goal.issues.push({ code: 'inconsistent', text: range.text })
    }
    finishGoal(goal, language)
    return
  }
  if (minutes !== null) {
    if (goal.kind === 'once' && !goal.due) {
      // "完成作业，2小时内": one window of that length.
      goal.kind = 'interval'
      goal.intervalMinutes = minutes
      goal.slots = 1
    } else {
      goal.issues.push({ code: 'hourly-unsupported', text: range.text })
    }
    finishGoal(goal, language)
    return
  }
  if (goal.kind === 'once') {
    const end = range.end ?? (range.days !== null ? addDays(range.start ?? today, range.days - 1) : null)
    if (end && !goal.due) {
      goal.due = end
      goal.onTime = true
    }
    finishGoal(goal, language)
    return
  }
  if (range.start && !goal.afterPrevious) goal.startDate = range.start
  const start = goal.startDate ?? today
  let days = range.days
  if (days === null && range.end) days = daysBetween(start, range.end) + 1
  if (range.issue) goal.issues.push({ code: range.issue, text: range.text })
  if (days !== null && days > 0) {
    if (goal.kind === 'weekly') {
      goal.weeks = Math.max(1, Math.floor(days / 7))
      if (days % 7 !== 0) goal.issues.push({ code: 'weeks-rounded', text: range.text })
    } else {
      goal.days = days
    }
  }
  finishGoal(goal, language)
}

/** Fills what follows from the rule (all days required by default) and generates the achievement. */
function finishGoal(goal: DraftGoal, language: PlanLanguage): void {
  if (goal.kind === 'count' && goal.days !== null && goal.required === null) {
    goal.required = Math.ceil(goal.days / goal.every)
  }
  if (goal.kind === 'streak' && goal.days === null && goal.required !== null) goal.days = goal.required
  const condition = draftCondition(goal)
  goal.achievement = condition
    ? generateAchievement(goal.title, goal.category, condition, language)
    : generateAchievement(goal.title, goal.category, { kind: 'once', due: null, onTime: false }, language)
}

/** The date-based name used before Phase 6.2 (kept for callers of the planner API). */
export function defaultPlanTitle(today: string, language: PlanLanguage): string {
  const [, m, d] = today.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return language === 'zh' ? `${m}月${d}日的计划` : `Plan · ${months[(m ?? 1) - 1]} ${d}`
}

export const ruleBasedParser: PlanParser = { parse: parsePlanText }
