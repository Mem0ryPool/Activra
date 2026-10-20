import type { HabitFeedback } from './feedback'

/**
 * Habits (Phase 6.6, schema 5). A habit is kept apart from tasks and plans: its check-ins are their own
 * records and never count as task completions, so statistics, achievements and plans are unchanged.
 * Streaks, records and the heatmap are derived from the check-ins (see `streak.ts`), never stored.
 */

/**
 * daily: every day. weekly: any days, at least `timesPerWeek` a week. weekdays (custom): only these
 * days of the week (0 = Sunday … 6 = Saturday, sorted, at least one); other days are not scheduled.
 */
export type HabitFrequency =
  | { kind: 'daily' }
  | { kind: 'weekly'; timesPerWeek: number }
  | { kind: 'weekdays'; weekdays: number[] }

export type HabitState = 'active' | 'paused' | 'archived'

/** Days a habit was paused or archived (local dates, both ends included); `until` null while it still is. */
export interface HabitPause {
  from: string
  until: string | null
}

export interface Habit {
  id: string
  name: string
  note: string
  frequency: HabitFrequency
  /** Local day it was created; nothing before it counts. */
  startDate: string
  state: HabitState
  /** Oldest first, never overlapping; paused days neither break nor extend a streak. */
  pauses: HabitPause[]
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

/**
 * One check-in. Its day is decided by the main process when it is made and never recomputed (a later
 * time-zone change keeps it on the same date). Cancelling marks it, like an undone task completion.
 */
export interface HabitCheckin {
  id: string
  habitId: string
  /** Local date (YYYY-MM-DD) the check-in belongs to. */
  date: string
  checkedAt: string
  undoneAt: string | null
}

export interface HabitInput {
  name: string
  note?: string
  frequency: HabitFrequency
}

export interface HabitPatch {
  name?: string
  note?: string
  frequency?: HabitFrequency
}

export type HabitAction = 'pause' | 'resume' | 'archive' | 'unarchive'
export const HABIT_ACTIONS = ['pause', 'resume', 'archive', 'unarchive'] as const satisfies readonly HabitAction[]

export const HABIT_NAME_MAX_LENGTH = 100
export const HABIT_NOTE_MAX_LENGTH = 500
export const HABIT_TIMES_PER_WEEK_MAX = 7

export interface HabitCheckinResult {
  habit: Habit
  /** False when nothing was recorded (already checked in, paused, or not a day that can be checked in). */
  checkedIn: boolean
  checkin: HabitCheckin | null
  /** The streak milestone this check-in reached (e.g. 7 days), or null. */
  milestone: number | null
  /** What the check-in is answered with (Phase 6.6.1); null when nothing was recorded. */
  feedback: HabitFeedback | null
}

export interface HabitUndoResult {
  habit: Habit | null
  undone: boolean
}
