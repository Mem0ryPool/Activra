import { countedCompletionFor } from './completions'
import { dayKey } from './dates'
import { instanceId, occursOn } from './recurrence'
import { windowState } from './timeWindow'
import type { CompletionEvent, Task } from './types'

const byNewest = (a: string, b: string): number => b.localeCompare(a)

/**
 * Active tasks, newest first. The order the Tasks page and the desktop widget both use. Timed steps
 * of one plan are created together; among them the earlier window comes first.
 */
export function sortActive(tasks: readonly Task[]): Task[] {
  return tasks
    .filter((x) => x.status === 'active')
    .sort(
      (a, b) =>
        byNewest(a.createdAt, b.createdAt) ||
        (a.window && b.window ? a.window.start.localeCompare(b.window.start) : 0)
    )
}

/** Completed tasks, most recently unlocked first. */
export function sortCompleted(tasks: readonly Task[]): Task[] {
  return tasks
    .filter((x) => x.status === 'completed')
    .sort((a, b) => byNewest(a.completedAt ?? '', b.completedAt ?? ''))
}

function isSameLocalDay(iso: string, now: number): boolean {
  const a = new Date(iso)
  const b = new Date(now)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** One row of "today": a one-off task, or today's occurrence of a repeating task. */
export interface TodayItem {
  /** Task id, or `${taskId}@${date}` for an occurrence. */
  key: string
  task: Task
  /** The occurrence's date for a repeating task; null for a one-off task. */
  occurrence: string | null
  done: boolean
  /** The completion that made it done, if any. */
  event: CompletionEvent | null
}

export interface TodayTasks {
  /** Still to do (newest first), then done today (most recent first). */
  items: TodayItem[]
  completed: number
  total: number
}

/**
 * "Today" means every one-off task still in progress, today's occurrence of each repeating task
 * (unless skipped), and whatever was completed on the current local day. Older completed tasks
 * and other days' occurrences drop out; a missed occurrence is never carried over as done.
 * A timed plan step is "to do" only while its window is open: before that it cannot be completed,
 * and once missed it never can (the Tasks page still shows both).
 */
export function selectTodayTasks(
  tasks: readonly Task[],
  completions: readonly CompletionEvent[],
  now: number
): TodayTasks {
  const today = dayKey(new Date(now))
  const pending: TodayItem[] = []
  const done: TodayItem[] = []
  for (const task of sortActive(tasks)) {
    if (task.window && windowState(task.window, now) !== 'open') continue
    if (!task.recurrence) {
      pending.push({ key: task.id, task, occurrence: null, done: false, event: null })
      continue
    }
    if (!occursOn(task, today)) continue
    const event = countedCompletionFor(completions, task.id, today) ?? null
    const item = { key: instanceId(task.id, today), task, occurrence: today, done: !!event, event }
    ;(event ? done : pending).push(item)
  }
  for (const task of sortCompleted(tasks)) {
    if (task.completedAt && isSameLocalDay(task.completedAt, now)) {
      done.push({
        key: task.id,
        task,
        occurrence: null,
        done: true,
        event: countedCompletionFor(completions, task.id) ?? null
      })
    }
  }
  const doneAt = (item: TodayItem): string => item.event?.completedAt ?? item.task.completedAt ?? ''
  done.sort((a, b) => byNewest(doneAt(a), doneAt(b)))
  return { items: [...pending, ...done], completed: done.length, total: pending.length + done.length }
}
