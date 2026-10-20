import type { TimerConfig } from './types'

export function getRemainingMs(timer: TimerConfig, now: number): number {
  const end = Date.parse(timer.startedAt) + timer.durationSec * 1000
  return Math.max(0, end - now)
}

/** Formats milliseconds as H:MM:SS (or M:SS under an hour), rounding up so 0 only shows when time is up. */
export function formatCountdown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function splitDuration(totalSec: number): { hours: number; minutes: number } {
  return { hours: Math.floor(totalSec / 3600), minutes: Math.floor((totalSec % 3600) / 60) }
}
