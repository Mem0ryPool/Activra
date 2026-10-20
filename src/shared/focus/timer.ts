import type { FocusDurations, FocusPhase, FocusRun, FocusSession, FocusTimerState } from './types'

export const DEFAULT_FOCUS_DURATIONS: FocusDurations = { focusMin: 25, shortBreakMin: 5, longBreakMin: 15 }
export const FOCUS_LIMITS: Record<keyof FocusDurations, { min: number; max: number }> = {
  focusMin: { min: 1, max: 180 },
  shortBreakMin: { min: 1, max: 60 },
  longBreakMin: { min: 1, max: 90 }
}
/** Every this many completed focus sessions, the next break is a long one. */
export const LONG_BREAK_EVERY = 4
/** A focus ended early with less than this is dropped, not recorded (an accidental start). */
export const MIN_RECORDED_SEC = 60
/**
 * Wall clock and monotonic clock may disagree by this much between two ticks before it counts as a
 * change of the system time (ticks themselves can be late by a second or more on a busy PC).
 */
export const CLOCK_JUMP_MS = 3000

export const INITIAL_FOCUS_STATE: FocusTimerState = { run: null, nextPhase: 'focus', taskId: null, cycle: 0 }

export function phaseSeconds(phase: FocusPhase, durations: FocusDurations): number {
  const min =
    phase === 'focus' ? durations.focusMin : phase === 'short-break' ? durations.shortBreakMin : durations.longBreakMin
  return min * 60
}

/** Time counted so far: never negative (a clock set back counts as no time), never more than planned. */
export function runElapsedMs(run: FocusRun, now: number): number {
  const stretch = run.resumedAt === null ? 0 : Math.max(0, now - Date.parse(run.resumedAt))
  return Math.min(run.plannedSec * 1000, Math.max(0, run.elapsedMs + stretch))
}

export function runRemainingMs(run: FocusRun, now: number): number {
  return run.plannedSec * 1000 - runElapsedMs(run, now)
}

/** A running run whose time is up. A paused run is never due. */
export function isRunDue(run: FocusRun, now: number): boolean {
  return run.resumedAt !== null && runRemainingMs(run, now) <= 0
}

/** The instant a running run's time is (or was) up; NaN while paused. */
export function runDueAt(run: FocusRun): number {
  if (run.resumedAt === null) return Number.NaN
  return Date.parse(run.resumedAt) + (run.plannedSec * 1000 - run.elapsedMs)
}

export function newRun(
  id: string,
  phase: FocusPhase,
  task: { id: string; title: string } | null,
  durations: FocusDurations,
  now: number
): FocusRun {
  const at = new Date(now).toISOString()
  return {
    id,
    phase,
    taskId: phase === 'focus' ? (task?.id ?? null) : null,
    taskTitle: phase === 'focus' ? (task?.title ?? '') : '',
    plannedSec: phaseSeconds(phase, durations),
    startedAt: at,
    resumedAt: at,
    elapsedMs: 0
  }
}

export function pauseRun(run: FocusRun, now: number): FocusRun {
  if (run.resumedAt === null) return run
  return { ...run, elapsedMs: runElapsedMs(run, now), resumedAt: null }
}

export function resumeRun(run: FocusRun, now: number): FocusRun {
  if (run.resumedAt !== null) return run
  return { ...run, resumedAt: new Date(now).toISOString() }
}

/**
 * Starts the current running stretch again from `now`, crediting `creditMs` for the time since the
 * last trusted moment. Used when the system time changed: the stretch is re-based on the new clock
 * and only the time that really passed is counted.
 */
export function reanchorRun(run: FocusRun, now: number, creditMs: number): FocusRun {
  if (run.resumedAt === null) return run
  const elapsedMs = Math.min(run.plannedSec * 1000, Math.max(0, run.elapsedMs + Math.max(0, creditMs)))
  return { ...run, elapsedMs, resumedAt: new Date(now).toISOString() }
}

export interface ClockSample {
  wall: number
  mono: number
}

/**
 * Whether the system time changed between two ticks, and how much time really passed if so.
 * Without sleep in between, wall and monotonic time advance together; a disagreement beyond
 * CLOCK_JUMP_MS is a change of the system time, and the monotonic difference is what passed.
 * After sleep the monotonic clock cannot be trusted, so a forward wall difference counts as real
 * (the user was away) and a backward one counts as nothing. Returns null when nothing changed.
 */
export function clockJumpCredit(last: ClockSample, next: ClockSample, sleptInBetween: boolean): number | null {
  const wall = next.wall - last.wall
  if (sleptInBetween) return wall < 0 ? 0 : null
  const mono = Math.max(0, next.mono - last.mono)
  return wall < 0 || Math.abs(wall - mono) > CLOCK_JUMP_MS ? mono : null
}

/** The record a focus run ends in; null for a break, or for a focus ended early under MIN_RECORDED_SEC. */
export function sessionFor(run: FocusRun, outcome: FocusSession['outcome'], endedAt: number): FocusSession | null {
  if (run.phase !== 'focus') return null
  const focusedSec = outcome === 'completed' ? run.plannedSec : Math.floor(runElapsedMs(run, endedAt) / 1000)
  if (outcome === 'ended-early' && focusedSec < MIN_RECORDED_SEC) return null
  return {
    id: run.id,
    ...(run.origin ? { origin: { ...run.origin } } : {}),
    taskId: run.taskId,
    taskTitle: run.taskTitle,
    plannedSec: run.plannedSec,
    focusedSec,
    startedAt: run.startedAt,
    endedAt: new Date(endedAt).toISOString(),
    outcome
  }
}

/**
 * The state after a run ends. A completed focus moves on to a break (a long one every
 * LONG_BREAK_EVERY sessions); a break, a focus ended early, or a reset goes back to focus
 * (a reset keeps the phase it was in).
 */
export function stateAfter(
  state: FocusTimerState,
  run: FocusRun,
  how: 'completed' | 'ended-early' | 'reset'
): FocusTimerState {
  const taskId = run.phase === 'focus' ? run.taskId : state.taskId
  if (how === 'reset') return { ...state, run: null, nextPhase: run.phase, taskId }
  if (run.phase === 'focus' && how === 'completed') {
    const cycle = (state.cycle + 1) % LONG_BREAK_EVERY
    return { run: null, nextPhase: cycle === 0 ? 'long-break' : 'short-break', taskId, cycle }
  }
  return { ...state, run: null, nextPhase: 'focus', taskId }
}

/** Seconds focused today (local day of `now`) and completed sessions today, newest first. */
export function focusToday(
  sessions: readonly FocusSession[],
  now: number
): { focusedSec: number; completed: number; sessions: FocusSession[] } {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
  const today = sessions
    .filter((s) => {
      const at = Date.parse(s.endedAt)
      return at >= start && at < end
    })
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
  return {
    focusedSec: today.reduce((sum, s) => sum + s.focusedSec, 0),
    completed: today.filter((s) => s.outcome === 'completed').length,
    sessions: today
  }
}

/** Total seconds focused on one task over every record (each record counted once). */
export function focusedOnTask(sessions: readonly FocusSession[], taskId: string): number {
  return sessions.reduce((sum, s) => (s.taskId === taskId ? sum + s.focusedSec : sum), 0)
}
