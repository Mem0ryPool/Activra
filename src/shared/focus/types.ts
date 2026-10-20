/**
 * Focus timer (Phase 6.7). Kept in its own file next to the data file (`life-unlocked-focus.json`),
 * apart from tasks, completions, plans and habits: a focus session never completes a task, unlocks an
 * achievement or counts in the statistics, and the main data file and its schema are unchanged.
 */

export type FocusPhase = 'focus' | 'short-break' | 'long-break'

export interface FocusOrigin {
  planId: string
  goalId: string
}

/** Optional execution budget; never changes the plan or creates tasks. */
export interface PlanFocusInput {
  planId: string
  goals: { goalId: string; sessions: number }[]
}

export interface PlanFocusStart extends FocusOrigin {
  taskId: string
}

/** Lengths in whole minutes. */
export interface FocusDurations {
  focusMin: number
  shortBreakMin: number
  longBreakMin: number
}

/**
 * The timer being run (running or paused). Time is counted from wall-clock timestamps, never from
 * ticks: `elapsedMs` holds every earlier running stretch, and the current one runs from `resumedAt`.
 * So a window in the background, a throttled page, sleep or a restart never make it drift.
 */
export interface FocusRun {
  origin?: FocusOrigin
  /** Also the id of the session record it ends in, so a run is recorded at most once. */
  id: string
  phase: FocusPhase
  /** The linked task, or null for focusing without one. Never completed by the timer. */
  taskId: string | null
  /** The task's name when the run started ('' without a task), so the record reads the same later. */
  taskTitle: string
  plannedSec: number
  /** ISO instant of the first start. */
  startedAt: string
  /** ISO instant the current running stretch began; null while paused. */
  resumedAt: string | null
  /** Milliseconds counted before `resumedAt` (0 ≤ elapsedMs ≤ plannedSec × 1000). */
  elapsedMs: number
}

export interface FocusTimerState {
  run: FocusRun | null
  /** The phase the next start uses while no run exists. */
  nextPhase: FocusPhase
  /** The task kept selected for the next focus (null: none). */
  taskId: string | null
  /** Focus sessions completed since the last long break was offered (0…LONG_BREAK_EVERY-1). */
  cycle: number
}

/** One focus run that ended: completed in full, or ended early by the user. Breaks are not recorded. */
export interface FocusSession {
  origin?: FocusOrigin
  id: string
  taskId: string | null
  taskTitle: string
  plannedSec: number
  /** Time actually focused, in whole seconds (never more than planned). */
  focusedSec: number
  startedAt: string
  endedAt: string
  outcome: 'completed' | 'ended-early'
}

export interface FocusSnapshot {
  planTargets?: PlanFocusInput[]
  state: FocusTimerState
  sessions: FocusSession[]
  durations: FocusDurations
}

/** What a page may ask to change while no run exists. */
export interface FocusSelection {
  phase?: FocusPhase
  taskId?: string | null
}

/** A run that just ended on its own (time up), for the notification. */
export interface FocusFinished {
  run: FocusRun
  /** The record written for a focus phase; null for a break. */
  session: FocusSession | null
  /** When the time was up (may be earlier than now if the app was closed or asleep). */
  endedAt: string
}
