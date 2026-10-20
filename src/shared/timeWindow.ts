import type { Task, TaskWindow } from './types'

/**
 * Time windows of plan nodes (Phase 6.1): "drink water every hour for the next 4 hours" becomes
 * four one-off tasks, each completable only inside its own window. Windows are absolute instants
 * (ISO, UTC), fixed when the plan is confirmed and stored with the task. Everything here is a pure
 * function of the stored window and the current time: no timer decides anything, so a restart, a
 * time-zone change or the clock moving gives the same answer for the same moment.
 */

export const MINUTE_MS = 60_000

/** Where `now` is relative to a window: [start, end) is open. */
export type WindowState = 'upcoming' | 'open' | 'closed'

export function windowState(window: TaskWindow, now: number): WindowState {
  if (now < Date.parse(window.start)) return 'upcoming'
  if (now >= Date.parse(window.end)) return 'closed'
  return 'open'
}

/** True when an instant (ISO) lies inside the window. */
export function inWindow(window: TaskWindow, iso: string): boolean {
  const t = Date.parse(iso)
  return t >= Date.parse(window.start) && t < Date.parse(window.end)
}

/** A task with a window can be completed only while it is open. Tasks without one are unaffected. */
export function isWindowOpen(task: Pick<Task, 'window'>, now: number): boolean {
  return task.window === null || windowState(task.window, now) === 'open'
}

/** The start of the minute `now` is in, so stored and displayed times agree to the minute. */
export function floorToMinute(now: number): number {
  return Math.floor(now / MINUTE_MS) * MINUTE_MS
}

/** The windows of `count` back-to-back nodes of `minutes` each, starting at `startIso`. */
export function intervalWindows(startIso: string, minutes: number, count: number): TaskWindow[] {
  const start = Date.parse(startIso)
  return Array.from({ length: count }, (_, i) => ({
    start: new Date(start + i * minutes * MINUTE_MS).toISOString(),
    end: new Date(start + (i + 1) * minutes * MINUTE_MS).toISOString()
  }))
}

/** A window read back from disk, or null if malformed (start must be before end). */
export function reviveWindow(raw: unknown): TaskWindow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { start, end } = raw as Record<string, unknown>
  if (typeof start !== 'string' || typeof end !== 'string') return null
  const s = Date.parse(start)
  const e = Date.parse(end)
  if (Number.isNaN(s) || Number.isNaN(e) || s >= e) return null
  return { start: new Date(s).toISOString(), end: new Date(e).toISOString() }
}
