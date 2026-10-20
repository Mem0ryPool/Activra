import { countedCompletionFor } from '../shared/completions'
import { dayKey } from '../shared/dates'
import { reminderAt, reminderKey, overdueFrom } from '../shared/deadline'
import { addDays, occursOn } from '../shared/recurrence'
import type { CompletionEvent, ReminderSettings, Task } from '../shared/types'

/**
 * Which deadline reminders are due right now. Free of Electron so the rules can be unit tested;
 * `ReminderService` (src/main/reminders.ts) runs it on a short timer, on wake from sleep, on
 * unlock and after every change.
 *
 * Catch-up policy (after sleep, a closed app or a clock change):
 * - a reminder whose time passed at most CATCH_UP_MS ago is still sent;
 * - an older one is recorded as skipped without a notification, so no flood of stale reminders;
 * - more than SUMMARY_OVER reminders at once become a single summary notification.
 * Every reminder is recorded before it is shown, so it is never sent twice.
 */

export const CATCH_UP_MS = 30 * 60_000
export const SUMMARY_OVER = 3
/** How far back and ahead to look at occurrences of repeating tasks (reminders up to 7 days early). */
const OCCURRENCE_WINDOW = { back: 1, ahead: 8 }

export interface DueReminder {
  key: string
  taskId: string
  occurrence: string | null
  title: string
  /** When it was meant to be sent. */
  fireAt: number
  /** When the task becomes overdue (due time, or the next day's start for a date-only deadline). */
  overdueAt: number
  /** Due date and time as set (time null = date only). */
  date: string
  time: string | null
}

/** Reminders whose time has come (fireAt ≤ now) for tasks and occurrences not yet completed. */
export function remindersDue(
  tasks: readonly Task[],
  completions: readonly CompletionEvent[],
  settings: ReminderSettings,
  now: number
): DueReminder[] {
  const due: DueReminder[] = []
  const add = (task: Task, occurrence: string | null): void => {
    const key = reminderKey(task, occurrence)
    const fireAt = reminderAt(task, occurrence, settings.allDayTime)
    const overdueAt = overdueFrom(task, occurrence)
    if (!key || fireAt === null || overdueAt === null || fireAt > now) return
    const date = occurrence ?? (task.due?.date as string)
    due.push({
      key,
      taskId: task.id,
      occurrence,
      title: task.title,
      fireAt,
      overdueAt,
      date,
      time: task.due?.time ?? null
    })
  }
  const today = dayKey(new Date(now))
  for (const task of tasks) {
    if (!task.due || task.reminderMinutes === null || task.status !== 'active') continue
    if (!task.recurrence) {
      add(task, null)
      continue
    }
    for (let i = -OCCURRENCE_WINDOW.back; i <= OCCURRENCE_WINDOW.ahead; i++) {
      const date = addDays(today, i)
      if (occursOn(task, date) && !countedCompletionFor(completions, task.id, date)) add(task, date)
    }
  }
  return due.sort((a, b) => a.fireAt - b.fireAt)
}

export interface ReminderDecision {
  /** Shown one by one. */
  send: DueReminder[]
  /** Shown as one summary notification. */
  summary: DueReminder[]
  /** Too old: recorded without a notification. */
  skip: DueReminder[]
}

export function decideReminders(
  due: readonly DueReminder[],
  alreadyHandled: (key: string) => boolean,
  now: number
): ReminderDecision {
  const fresh = due.filter((r) => !alreadyHandled(r.key))
  const recent = fresh.filter((r) => now - r.fireAt <= CATCH_UP_MS)
  const skip = fresh.filter((r) => now - r.fireAt > CATCH_UP_MS)
  if (recent.length > SUMMARY_OVER) return { send: [], summary: recent, skip }
  return { send: recent, summary: [], skip }
}

/**
 * Which shown notifications should be taken back: those none of whose reminders is still due.
 * A reminder stops being due when its task is completed or deleted, or when its deadline or
 * reminder offset changes (that gives it a new key).
 */
export function staleShown<T>(shown: Iterable<readonly [T, readonly string[]]>, dueKeys: ReadonlySet<string>): T[] {
  const stale: T[] = []
  for (const [item, keys] of shown) if (!keys.some((key) => dueKeys.has(key))) stale.push(item)
  return stale
}
