import { completionDay, countedCompletions } from '../completions'
import { dayKey } from '../dates'
import type { FocusSession } from '../focus/types'
import { checkedDays, isPausedOn, isScheduled, weekStartOf } from '../habits/streak'
import type { Habit, HabitCheckin } from '../habits/types'
import { PLAN_TARGET, type Plan } from '../planner/types'
import { addDays } from '../recurrence'
import type { CompletionEvent, Task } from '../types'

/**
 * Weekly report (Phase 6.8). Offline and rule-based: every number is derived from the stored records
 * (counted completions, focus sessions, habit check-ins, plan unlocks), weeks start on Monday, and the
 * insights are fixed rules over those numbers, never guesses. Nothing is stored; nothing here changes a
 * task, achievement, habit or plan.
 */

export interface WeeklyInput {
  tasks: readonly Task[]
  completions: readonly CompletionEvent[]
  plans: readonly Plan[]
  habits: readonly Habit[]
  habitCheckins: readonly HabitCheckin[]
  focusSessions: readonly FocusSession[]
}

export interface HabitWeek {
  habitId: string
  name: string
  kind: Habit['frequency']['kind']
  /** Days checked in (weekly habits: days this week, toward `due`). */
  done: number
  /** Days that were due so far this week (weekly habits: the weekly target). */
  due: number
  /** done / due, 0–1; null when nothing was due yet. */
  rate: number | null
}

export type WeeklyInsight =
  | { kind: 'best-day'; weekday: number; count: number }
  | { kind: 'tasks-up' | 'tasks-down'; percent: number; previous: number; current: number }
  | { kind: 'tasks-first'; current: number }
  | { kind: 'focus-up' | 'focus-down'; percent: number; previousMin: number; currentMin: number }
  | { kind: 'habit-perfect'; name: string }
  | { kind: 'habit-attention'; name: string; done: number; due: number }
  | { kind: 'focus-unfinished'; endedEarly: number; completed: number }
  | { kind: 'quiet-week' }

export interface WeeklyReport {
  /** Monday and Sunday of the week (local date keys). */
  start: string
  end: string
  /** The week holding `now`: days after today are not over yet. */
  current: boolean
  tasks: {
    completed: number
    previous: number
    /** Completions per day, Monday first. */
    perDay: number[]
    activeDays: number
    /** The most completed task titles this week (repeats grouped), most first. */
    top: { title: string; count: number }[]
  }
  focus: {
    focusedSec: number
    previousSec: number
    completed: number
    endedEarly: number
    /** Focused time per day, Monday first, seconds. */
    perDay: number[]
    top: { title: string; focusedSec: number }[]
  }
  habits: HabitWeek[]
  plans: {
    goals: { planTitle: string; name: string }[]
    plansCompleted: { planTitle: string; name: string }[]
  }
  insights: WeeklyInsight[]
}

/** Local midnight of a date key, as a timestamp. */
function startOfDay(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).getTime()
}

function inWeek(instant: string, start: string): boolean {
  const t = Date.parse(instant)
  return t >= startOfDay(start) && t < startOfDay(addDays(start, 7))
}

function weekdayIndex(day: string, start: string): number {
  return Math.round((startOfDay(day) - startOfDay(start)) / 86_400_000)
}

function topBy<T>(items: readonly T[], key: (item: T) => string, weight: (item: T) => number, limit: number): { key: string; value: number }[] {
  const totals = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    if (!k) continue
    totals.set(k, (totals.get(k) ?? 0) + weight(item))
  }
  return [...totals.entries()]
    .map(([k, value]) => ({ key: k, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
    .slice(0, limit)
}

function percentChange(previous: number, current: number): number {
  return Math.round((Math.abs(current - previous) / previous) * 100)
}

function habitWeek(habit: Habit, checkins: readonly HabitCheckin[], start: string, today: string): HabitWeek | null {
  const end = addDays(start, 6)
  if (habit.startDate > end) return null
  if (habit.archivedAt && dayKey(new Date(habit.archivedAt)) < start) return null
  const days = checkedDays(habit, checkins)
  const lastDue = end < today ? end : today
  let done = 0
  let due = 0
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i)
    if (days.has(date)) done += 1
    if (habit.frequency.kind === 'weekly' || date > lastDue || date < habit.startDate) continue
    if (isScheduled(habit, date) && !isPausedOn(habit, date)) due += 1
  }
  if (habit.frequency.kind === 'weekly') due = habit.frequency.timesPerWeek
  else done = Math.min(done, due)
  return {
    habitId: habit.id,
    name: habit.name,
    kind: habit.frequency.kind,
    done,
    due,
    rate: due > 0 ? Math.min(1, done / due) : null
  }
}

/** The week starting on Monday `start` (any day of it is accepted), as of `now`. */
export function buildWeeklyReport(input: WeeklyInput, anyDay: string, now: number): WeeklyReport {
  const start = weekStartOf(anyDay)
  const end = addDays(start, 6)
  const previousStart = addDays(start, -7)
  const today = dayKey(new Date(now))
  const counted = countedCompletions(input.completions)

  const dayOf = (e: CompletionEvent): string => completionDay(e)
  const thisWeek = counted.filter((e) => dayOf(e) >= start && dayOf(e) <= end)
  const lastWeek = counted.filter((e) => dayOf(e) >= previousStart && dayOf(e) < start)
  const perDay = Array.from({ length: 7 }, () => 0)
  for (const e of thisWeek) perDay[weekdayIndex(dayOf(e), start)] = (perDay[weekdayIndex(dayOf(e), start)] ?? 0) + 1
  const titleOf = (e: CompletionEvent): string => input.tasks.find((t) => t.id === e.taskId)?.title ?? e.title

  const sessions = input.focusSessions.filter((s) => inWeek(s.endedAt, start))
  const previousSessions = input.focusSessions.filter((s) => inWeek(s.endedAt, previousStart))
  const focusPerDay = Array.from({ length: 7 }, () => 0)
  for (const s of sessions) {
    const i = weekdayIndex(dayKey(new Date(s.endedAt)), start)
    focusPerDay[i] = (focusPerDay[i] ?? 0) + s.focusedSec
  }
  const focusedSec = sessions.reduce((sum, s) => sum + s.focusedSec, 0)
  const previousSec = previousSessions.reduce((sum, s) => sum + s.focusedSec, 0)
  const completedFocus = sessions.filter((s) => s.outcome === 'completed').length
  const endedEarly = sessions.length - completedFocus

  const habits = input.habits
    .map((h) => habitWeek(h, input.habitCheckins, start, today))
    .filter((h): h is HabitWeek => h !== null)
    .sort((a, b) => a.name.localeCompare(b.name))

  const goals: WeeklyReport['plans']['goals'] = []
  const plansCompleted: WeeklyReport['plans']['plansCompleted'] = []
  for (const plan of input.plans) {
    for (const unlock of plan.unlocks) {
      if (unlock.revokedAt !== null || !inWeek(unlock.unlockedAt, start)) continue
      if (unlock.target === PLAN_TARGET) plansCompleted.push({ planTitle: plan.title, name: plan.master?.name ?? plan.title })
      else {
        const goal = plan.goals.find((g) => g.id === unlock.target)
        if (goal) goals.push({ planTitle: plan.title, name: goal.achievement.name })
      }
    }
  }

  const report: WeeklyReport = {
    start,
    end,
    current: today >= start && today <= end,
    tasks: {
      completed: thisWeek.length,
      previous: lastWeek.length,
      perDay,
      activeDays: perDay.filter((n) => n > 0).length,
      top: topBy(thisWeek, titleOf, () => 1, 3).map((x) => ({ title: x.key, count: x.value }))
    },
    focus: {
      focusedSec,
      previousSec,
      completed: completedFocus,
      endedEarly,
      perDay: focusPerDay,
      top: topBy(sessions, (s) => s.taskTitle, (s) => s.focusedSec, 3).map((x) => ({ title: x.key, focusedSec: x.value }))
    },
    habits,
    plans: { goals, plansCompleted },
    insights: []
  }
  report.insights = weeklyInsights(report)
  return report
}

/** At most this many insights, in the order below. */
export const MAX_INSIGHTS = 4
/** A habit is judged only once this many check-ins were due. */
const HABIT_MIN_DUE = 3

/**
 * Fixed rules over the report's own numbers. A rule speaks only when its numbers support it (a trend
 * needs a previous week with data, a best day needs a clear winner), so an empty or thin week gets few
 * or no insights rather than invented ones.
 */
export function weeklyInsights(r: WeeklyReport): WeeklyInsight[] {
  const out: WeeklyInsight[] = []
  const t = r.tasks
  const checkins = r.habits.reduce((sum, h) => sum + h.done, 0)
  if (t.completed === 0 && r.focus.focusedSec === 0 && checkins === 0) return [{ kind: 'quiet-week' }]

  const max = Math.max(...t.perDay)
  if (t.completed >= 2 && max >= 2 && t.perDay.filter((n) => n === max).length === 1) {
    out.push({ kind: 'best-day', weekday: t.perDay.indexOf(max), count: max })
  }
  if (t.previous > 0 && t.completed !== t.previous) {
    out.push({ kind: t.completed > t.previous ? 'tasks-up' : 'tasks-down', percent: percentChange(t.previous, t.completed), previous: t.previous, current: t.completed })
  } else if (t.previous === 0 && t.completed > 0 && !r.current) {
    out.push({ kind: 'tasks-first', current: t.completed })
  }
  const prevMin = Math.round(r.focus.previousSec / 60)
  const curMin = Math.round(r.focus.focusedSec / 60)
  if (prevMin > 0 && curMin !== prevMin) {
    out.push({ kind: curMin > prevMin ? 'focus-up' : 'focus-down', percent: percentChange(prevMin, curMin), previousMin: prevMin, currentMin: curMin })
  }
  const judged = r.habits.filter((h) => h.rate !== null && h.due >= HABIT_MIN_DUE)
  const perfect = judged.find((h) => h.rate === 1)
  if (perfect) out.push({ kind: 'habit-perfect', name: perfect.name })
  const weakest = [...judged].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))[0]
  if (weakest && (weakest.rate ?? 1) < 0.5 && !(r.current && weakest.kind === 'weekly')) {
    out.push({ kind: 'habit-attention', name: weakest.name, done: weakest.done, due: weakest.due })
  }
  if (r.focus.endedEarly >= 2 && r.focus.endedEarly >= r.focus.completed) {
    out.push({ kind: 'focus-unfinished', endedEarly: r.focus.endedEarly, completed: r.focus.completed })
  }
  return out.slice(0, MAX_INSIGHTS)
}
