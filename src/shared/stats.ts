import { completionDay, countedCompletions } from './completions'
import { dayKey } from './dates'
import { seriesEnded } from './recurrence'
import type { CompletionEvent, Task } from './types'

export interface TaskStats {
  unlocked: number
  active: number
  unlockedLast7Days: number
  /** Consecutive days, ending today or yesterday, with at least one unlock. */
  streakDays: number
}

/** Statistics from completions that count; an undone completion is left out everywhere. */
export function computeStats(tasks: readonly Task[], completions: readonly CompletionEvent[], now: number): TaskStats {
  const counted = countedCompletions(completions)
  const completedTimes = counted.map((e) => Date.parse(e.completedAt))
  const weekAgo = now - 7 * 24 * 3600 * 1000
  // Same day keys as the Statistics calendar, so the streak and the calendar always agree.
  const days = new Set(counted.map(completionDay))

  let streakDays = 0
  const cursor = new Date(now)
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (days.has(dayKey(cursor))) {
    streakDays += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  return {
    unlocked: counted.length,
    // A repeating series counts while it still has days ahead.
    active: tasks.filter((t) => t.status === 'active' && !seriesEnded(t, dayKey(new Date(now)))).length,
    unlockedLast7Days: completedTimes.filter((time) => time >= weekAgo && time <= now).length,
    streakDays
  }
}
