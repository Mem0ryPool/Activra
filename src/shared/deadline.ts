import type { Task, TaskDue } from './types'

/**
 * Deadlines. A deadline never completes or fails a task: it only says when the task is due,
 * when to remind, and whether it is overdue (shown with how long, never as "failed").
 *
 * - One-off task: `due.date` (required) and an optional `due.time`.
 * - Repeating task: `due.date` is null; each occurrence is due on its own date, at `due.time` if set.
 * - Date only (no time): due by the end of that day, so it is overdue from 00:00 the next day.
 *   Its reminder is counted from the "all-day reminder time" in Settings (default 09:00) on the
 *   due day, a rule the task dialog spells out.
 */

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
/** Reminder offsets are at most a week before. */
export const REMINDER_MAX_MINUTES = 7 * 24 * 60
export const REMINDER_PRESETS_TIMED = [0, 5, 15, 30, 60, 1440] as const
export const REMINDER_PRESETS_DATE_ONLY = [0, 1440] as const

function localDate(key: string, time: string | null, dayOffset = 0): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  const [hh, mm] = (time ?? '00:00').split(':').map(Number) as [number, number]
  // Calendar fields, so a daylight-saving change never moves the date or the wall-clock time.
  return new Date(y, m - 1, d + dayOffset, hh, mm)
}

/** The date a task (or occurrence) is due on, or null without a deadline. */
export function dueDateOf(task: Task, occurrence: string | null): string | null {
  if (!task.due) return null
  return task.recurrence ? occurrence : task.due.date
}

/**
 * The moment it becomes overdue: the due time, or for a date-only deadline the start of the next
 * day. Null without a deadline.
 */
export function overdueFrom(task: Task, occurrence: string | null): number | null {
  const date = dueDateOf(task, occurrence)
  if (!date || !task.due) return null
  return task.due.time ? localDate(date, task.due.time).getTime() : localDate(date, null, 1).getTime()
}

export function isOverdue(task: Task, occurrence: string | null, now: number): boolean {
  const from = overdueFrom(task, occurrence)
  return from !== null && now >= from
}

/**
 * When to remind: `reminderMinutes` before the due time, or before the all-day reminder time on
 * the due date for a date-only deadline. Whole days are counted on the calendar ("1 day before"
 * is the same wall-clock time the day before, also across a daylight-saving change).
 */
export function reminderAt(task: Task, occurrence: string | null, allDayTime: string): number | null {
  const date = dueDateOf(task, occurrence)
  if (!date || !task.due || task.reminderMinutes === null) return null
  const days = Math.floor(task.reminderMinutes / 1440)
  const rest = task.reminderMinutes % 1440
  return localDate(date, task.due.time ?? allDayTime, -days).getTime() - rest * 60_000
}

/**
 * Identifies one reminder. It changes when the deadline or the offset changes, so an edited
 * deadline gets a new reminder, and it never repeats for the same deadline and offset.
 */
export function reminderKey(task: Task, occurrence: string | null): string | null {
  const date = dueDateOf(task, occurrence)
  if (!date || !task.due || task.reminderMinutes === null) return null
  return `${task.id}@${occurrence ?? 'once'}@${date}T${task.due.time ?? 'day'}@${task.reminderMinutes}`
}

/** Keeps a deadline consistent with whether the task repeats. */
export function normalizeDue(due: TaskDue | null, repeating: boolean): TaskDue | null {
  if (!due) return null
  if (repeating) return { date: null, time: due.time }
  return due.date ? due : null
}

export interface DurationParts {
  days: number
  hours: number
  minutes: number
}

/** Splits a length of time for "overdue by 2 h 5 min" style text. */
export function splitOverdue(ms: number): DurationParts {
  const total = Math.max(1, Math.floor(ms / 60_000))
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 }
}
