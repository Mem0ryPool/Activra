import { dayKey } from '../dates'
import { addDays, weekdayOf } from '../recurrence'
import type { Habit, HabitAction, HabitCheckin, HabitPause } from './types'

/**
 * Streak rules for habits. Everything works on local date keys (YYYY-MM-DD) in whole calendar days,
 * so time zones, daylight saving and the time of day never move a check-in to another date.
 *
 * - Daily: the current streak is the run of checked-in days ending today; while today is not checked
 *   in yet it ends yesterday (today is not over, so it does not break anything).
 * - Custom (chosen days of the week): like daily, counted on those days only; the other days are
 *   not scheduled and neither break nor extend the streak. Only scheduled days can be checked in.
 * - Weekly (weeks start on Monday): a week is met with at least `timesPerWeek` checked-in days; the
 *   current week only counts once it is met.
 * - Paused or archived days, and days before the habit started, neither break nor extend a streak. A
 *   check-in on such a day (made before pausing) still counts.
 * - Only today can be checked in (and yesterday in the first minutes after midnight); there is no
 *   checking in for earlier days, so a streak can never be rebuilt after the fact.
 */

/** A click on yesterday this many minutes after midnight still counts for yesterday (as for repeating tasks). */
export const HABIT_MIDNIGHT_GRACE_MIN = 10

export const DAILY_MILESTONES = [3, 7, 14, 21, 30, 50, 100, 200, 365] as const
export const WEEKLY_MILESTONES = [2, 4, 8, 12, 26, 52] as const

export interface HabitStreak {
  /** Days for a daily habit, weeks for a weekly one. */
  unit: 'day' | 'week'
  current: number
  longest: number
  /** Counted check-ins in the current week (weekly habits; for daily habits too, for display). */
  weekCount: number
  /** Whether today has a counted check-in. */
  doneToday: boolean
}

/** Today, or yesterday in the first minutes after midnight; null for any other day. */
export function acceptableCheckinDate(requested: string | null, now: Date): string | null {
  const today = dayKey(now)
  const date = requested ?? today
  const justAfterMidnight = now.getHours() === 0 && now.getMinutes() < HABIT_MIDNIGHT_GRACE_MIN
  return date === today || (justAfterMidnight && date === addDays(today, -1)) ? date : null
}

export function isCountedCheckin(checkin: HabitCheckin): boolean {
  return checkin.undoneAt === null
}

/** The check-in that currently counts for a habit on a date, if any. */
export function countedCheckinOn(
  checkins: readonly HabitCheckin[],
  habitId: string,
  date: string
): HabitCheckin | undefined {
  return checkins.find((c) => c.habitId === habitId && c.date === date && isCountedCheckin(c))
}

/** Dates with a counted check-in for this habit (one per date by construction). */
export function checkedDays(habit: Habit, checkins: readonly HabitCheckin[]): Set<string> {
  const days = new Set<string>()
  for (const c of checkins) if (c.habitId === habit.id && isCountedCheckin(c) && c.date >= habit.startDate) days.add(c.date)
  return days
}

/** Whether the habit expects a check-in on `date` (every day except a custom habit's other days). */
export function isScheduled(habit: Habit, date: string): boolean {
  return habit.frequency.kind !== 'weekdays' || habit.frequency.weekdays.includes(weekdayOf(date))
}

export function isPausedOn(habit: Habit, date: string): boolean {
  return habit.pauses.some((p) => p.from <= date && (p.until === null || date <= p.until))
}

/** The Monday of the week holding `date`. */
export function weekStartOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7))
}

type Mark = 'done' | 'skip' | 'miss'

function dailyMark(habit: Habit, days: Set<string>, date: string): Mark {
  // A day that is not scheduled (e.g. after a change of days) counts for nothing, checked in or not.
  if (!isScheduled(habit, date)) return 'skip'
  if (days.has(date)) return 'done'
  return isPausedOn(habit, date) || date < habit.startDate ? 'skip' : 'miss'
}

function weeklyMark(habit: Habit, days: Set<string>, week: string, currentWeek: string, target: number): Mark {
  let count = 0
  let excused = false
  for (let i = 0; i < 7; i++) {
    const date = addDays(week, i)
    if (days.has(date)) count += 1
    else if (date < habit.startDate || isPausedOn(habit, date)) excused = true
  }
  if (count >= target) return 'done'
  // The current week is still running; a week with paused days or days before the start is excused.
  return week === currentWeek || excused ? 'skip' : 'miss'
}

function runs(marks: Mark[]): { current: number; longest: number } {
  let longest = 0
  let run = 0
  for (const mark of marks) {
    if (mark === 'done') longest = Math.max(longest, ++run)
    else if (mark === 'miss') run = 0
  }
  return { current: run, longest }
}

/** Current and longest streak as of `today`. */
export function habitStreak(habit: Habit, checkins: readonly HabitCheckin[], today: string): HabitStreak {
  const days = checkedDays(habit, checkins)
  const currentWeek = weekStartOf(today)
  let weekCount = 0
  for (let i = 0; i < 7; i++) if (days.has(addDays(currentWeek, i))) weekCount += 1
  const doneToday = days.has(today)
  if (today < habit.startDate) return { unit: habit.frequency.kind === 'weekly' ? 'week' : 'day', current: 0, longest: 0, weekCount, doneToday }

  const marks: Mark[] = []
  if (habit.frequency.kind !== 'weekly') {
    for (let date = habit.startDate; date <= today; date = addDays(date, 1)) {
      // Today without a check-in is not over yet: it neither counts nor breaks the run.
      marks.push(date === today && !doneToday ? 'skip' : dailyMark(habit, days, date))
    }
    return { unit: 'day', ...runs(marks), weekCount, doneToday }
  }
  const target = habit.frequency.timesPerWeek
  for (let week = weekStartOf(habit.startDate); week <= currentWeek; week = addDays(week, 7)) {
    marks.push(weeklyMark(habit, days, week, currentWeek, target))
  }
  return { unit: 'week', ...runs(marks), weekCount, doneToday }
}

/** The milestone a check-in reached, given the current streak before and after it; null if none. */
export function reachedMilestone(habit: Habit, before: number, after: number): number | null {
  const list: readonly number[] = habit.frequency.kind === 'weekly' ? WEEKLY_MILESTONES : DAILY_MILESTONES
  return after > before && list.includes(after) ? after : null
}

export type HabitDayStatus = 'done' | 'paused' | 'empty' | 'off' | 'outside'

/**
 * What the heatmap shows for one day: checked in, paused, nothing, not scheduled (custom habits), or
 * outside the habit's life (before it, or ahead).
 */
export function habitDayStatus(habit: Habit, days: Set<string>, date: string, today: string): HabitDayStatus {
  if (date > today) return 'outside'
  if (days.has(date)) return 'done'
  if (date < habit.startDate) return 'outside'
  if (isPausedOn(habit, date)) return 'paused'
  return isScheduled(habit, date) ? 'empty' : 'off'
}

function closeOpenPause(pauses: HabitPause[], today: string): HabitPause[] {
  const last = pauses.at(-1)
  if (!last || last.until !== null) return pauses
  const yesterday = addDays(today, -1)
  // Paused and resumed on the same day: today was never really paused.
  if (last.from > yesterday) return pauses.slice(0, -1)
  return [...pauses.slice(0, -1), { from: last.from, until: yesterday }]
}

function openPause(pauses: HabitPause[], today: string): HabitPause[] {
  const last = pauses.at(-1)
  if (last && last.until === null) return pauses
  // Resumed yesterday or today and paused again: continue that pause instead of starting a new one.
  if (last && last.until !== null && last.until >= addDays(today, -1)) {
    return [...pauses.slice(0, -1), { from: last.from, until: null }]
  }
  return [...pauses, { from: today, until: null }]
}

/**
 * The habit after pause / resume / archive / unarchive on `today`, or null when the action does not
 * apply to its state. Pausing and archiving both open a pause from today; resuming and unarchiving
 * close it at yesterday, so today can be checked in again.
 */
export function applyHabitAction(habit: Habit, action: HabitAction, today: string, now: string): Habit | null {
  const pauses = habit.pauses.map((p) => ({ ...p }))
  switch (action) {
    case 'pause':
      if (habit.state !== 'active') return null
      return { ...habit, state: 'paused', pauses: openPause(pauses, today), updatedAt: now }
    case 'resume':
      if (habit.state !== 'paused') return null
      return { ...habit, state: 'active', pauses: closeOpenPause(pauses, today), updatedAt: now }
    case 'archive':
      if (habit.state === 'archived') return null
      return { ...habit, state: 'archived', pauses: openPause(pauses, today), archivedAt: now, updatedAt: now }
    case 'unarchive':
      if (habit.state !== 'archived') return null
      return { ...habit, state: 'active', pauses: closeOpenPause(pauses, today), archivedAt: null, updatedAt: now }
  }
}
