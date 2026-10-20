import { dayKey, isDateKey } from './dates'
import type { CompletionEvent, Task } from './types'

/**
 * Repeating tasks. A task with a `recurrence` rule is a template: it is never "completed" itself.
 * Each day it occurs on is an occurrence (instance id `${taskId}@${date}`), derived from the rule
 * when needed and never stored ahead of time; completing one stores a completion record with that
 * date as `occurrence`. All date math here works on YYYY-MM-DD keys in whole calendar days, so time
 * zones, daylight saving and the time of day never move an occurrence to another date.
 */

export type RecurrencePreset = 'daily' | 'weekly' | 'weekdays' | 'custom'
export type RecurrenceUnit = 'day' | 'week'

export const RECURRENCE_PRESETS = [
  'daily',
  'weekly',
  'weekdays',
  'custom'
] as const satisfies readonly RecurrencePreset[]
export const RECURRENCE_UNITS = ['day', 'week'] as const satisfies readonly RecurrenceUnit[]
export const RECURRENCE_INTERVAL_MAX: Record<RecurrenceUnit, number> = { day: 365, week: 52 }

/** An earlier version of a series' rule and the last day it decided (the day before it was edited). */
export interface RecurrenceSegment {
  rule: RecurrenceRule
  until: string
}

export interface RecurrenceRule {
  preset: RecurrencePreset
  /** Custom only matters for 'custom'; the presets fill these in themselves. */
  unit: RecurrenceUnit
  /** Every N days or weeks. */
  interval: number
  /** 0 = Sunday … 6 = Saturday, sorted. Used when `unit` is 'week' (never empty then). */
  weekdays: number[]
  /** First date it can occur on. */
  startDate: string
  /** Last date it can occur on (inclusive), or null for never ending. */
  endDate: string | null
}

const DAY_MS = 24 * 3600 * 1000

/** Whole days since 1970-01-01 for a date key, ignoring time zones entirely. */
function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

function keyFromDayNumber(n: number): string {
  const date = new Date(n * DAY_MS)
  const pad = (x: number): string => String(x).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function addDays(key: string, days: number): string {
  return keyFromDayNumber(dayNumber(key) + days)
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekdayOf(key: string): number {
  return (((dayNumber(key) + 4) % 7) + 7) % 7
}

/** Index of the Monday-based week containing the date. */
function weekNumber(key: string): number {
  return Math.floor((dayNumber(key) + 3) / 7)
}

export const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5]

/** Fills in what a preset implies, so the stored rule always describes itself completely. */
export function normalizeRule(rule: RecurrenceRule): RecurrenceRule {
  switch (rule.preset) {
    case 'daily':
      return { ...rule, unit: 'day', interval: 1, weekdays: [] }
    case 'weekly':
      return { ...rule, unit: 'week', interval: 1, weekdays: [weekdayOf(rule.startDate)] }
    case 'weekdays':
      return { ...rule, unit: 'week', interval: 1, weekdays: [...WEEKDAYS_MON_FRI] }
    case 'custom': {
      const weekdays = [...new Set(rule.weekdays)].sort((a, b) => a - b)
      return {
        ...rule,
        weekdays: rule.unit === 'week' ? (weekdays.length ? weekdays : [weekdayOf(rule.startDate)]) : []
      }
    }
  }
}

/** Does the rule (on its own) put an occurrence on this date? */
export function ruleOccursOn(rule: RecurrenceRule, key: string): boolean {
  if (key < rule.startDate || (rule.endDate !== null && key > rule.endDate)) return false
  if (rule.unit === 'day') return (dayNumber(key) - dayNumber(rule.startDate)) % rule.interval === 0
  if (!rule.weekdays.includes(weekdayOf(key))) return false
  return (weekNumber(key) - weekNumber(rule.startDate)) % rule.interval === 0
}

export function isRecurring(task: Task): boolean {
  return task.recurrence !== null
}

/** Never before the day the task was created: past days are not given an invented plan. */
function firstPossibleDay(task: Task): string {
  return dayKey(new Date(task.createdAt))
}

/**
 * The rule that decides a date. Each edit of a series keeps the old rule for the days up to the
 * day before the edit (`recurrenceHistory`, oldest first), so editing never changes past plans.
 */
function governingRule(task: Task, key: string): RecurrenceRule | null {
  for (const segment of task.recurrenceHistory) if (key <= segment.until) return segment.rule
  return task.recurrence
}

/** Was (or is) an occurrence planned on this date, ignoring "Skip this time"? */
export function plannedOn(task: Task, key: string): boolean {
  if (key < firstPossibleDay(task)) return false
  const rule = governingRule(task, key)
  return !!rule && ruleOccursOn(rule, key)
}

/** Does the task have an occurrence on this date? A skipped occurrence ("Skip this time") does not. */
export function occursOn(task: Task, key: string): boolean {
  return plannedOn(task, key) && !task.skippedOccurrences.includes(key)
}

/** The longest gap between two occurrences of any rule (every 52 weeks), plus a week. */
const SEARCH_DAYS = 52 * 7 + 7

/** The first occurrence on or after `fromKey`, or null if the series has ended. */
export function nextOccurrence(task: Task, fromKey: string): string | null {
  const rule = task.recurrence
  if (!rule) return null
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const key = addDays(fromKey, i)
    if (rule.endDate !== null && key > rule.endDate) return null
    if (occursOn(task, key)) return key
  }
  return null
}

/** True once the rule's end date has passed: there are no occurrences left. */
export function seriesEnded(task: Task, todayKey: string): boolean {
  return !!task.recurrence && task.recurrence.endDate !== null && task.recurrence.endDate < todayKey
}

export function instanceId(taskId: string, occurrence: string): string {
  return `${taskId}@${occurrence}`
}

/**
 * Occurrences that were planned but not completed, by day, for days in [fromKey, toKey] that are
 * already over (before `todayKey`). Today is never "missed" yet. Nothing here completes anything;
 * it only tells "planned but not done" apart from "nothing planned".
 */
export function missedByDay(
  tasks: readonly Task[],
  completions: readonly CompletionEvent[],
  fromKey: string,
  toKey: string,
  todayKey: string
): Map<string, Task[]> {
  const done = new Set(
    completions
      .filter((e) => e.occurrence !== null && e.undoneAt === null)
      .map((e) => instanceId(e.taskId, e.occurrence as string))
  )
  const last = toKey < todayKey ? toKey : addDays(todayKey, -1)
  const result = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.recurrence && task.recurrenceHistory.length === 0) continue
    const start = [fromKey, firstPossibleDay(task)].sort().at(-1) as string
    for (let key = start; key <= last; key = addDays(key, 1)) {
      if (!occursOn(task, key) || done.has(instanceId(task.id, key))) continue
      const list = result.get(key)
      if (list) list.push(task)
      else result.set(key, [task])
    }
  }
  return result
}

/**
 * The rule and history after the series is edited on `todayKey`: changes apply from today on.
 * The rule in force so far keeps deciding every day up to yesterday (it moves into the history);
 * the new rule (or none) decides today and later. Its start date stays as given, so "every 3 days"
 * keeps counting from where it started.
 */
export function applyRuleChange(
  task: Pick<Task, 'recurrence' | 'recurrenceHistory' | 'createdAt'>,
  next: RecurrenceRule | null,
  todayKey: string
): Pick<Task, 'recurrence' | 'recurrenceHistory'> {
  const history = [...task.recurrenceHistory]
  const yesterday = addDays(todayKey, -1)
  // Days after the last edit and before today that the old rule decided (none if it was set today).
  const decidedFrom = [history.at(-1) ? addDays(history.at(-1)!.until, 1) : '', dayKey(new Date(task.createdAt))]
    .sort()
    .at(-1)!
  if (task.recurrence && decidedFrom <= yesterday) history.push({ rule: task.recurrence, until: yesterday })
  return { recurrence: next ? normalizeRule(next) : null, recurrenceHistory: history }
}

export function sameRule(a: RecurrenceRule | null, b: RecurrenceRule | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export { isDateKey }
