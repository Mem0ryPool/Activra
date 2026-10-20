import { dayKey } from './dates'
import type { CompletionEvent } from './types'

/** How long the "Task completed · Undo" toast stays. Undoing later is still possible from the task's menu. */
export const UNDO_WINDOW_MS = 6000

/** A completion counts (achievements, statistics, calendar) unless it was undone. */
export function isCounted(event: CompletionEvent): boolean {
  return event.undoneAt === null
}

export function countedCompletions(events: readonly CompletionEvent[]): CompletionEvent[] {
  return events.filter(isCounted)
}

/**
 * The local day a completion belongs to: the occurrence it completes for a repeating task,
 * otherwise the day it was completed. Statistics, the calendar and the streak all use this.
 */
export function completionDay(event: CompletionEvent): string {
  return event.occurrence ?? dayKey(new Date(event.completedAt))
}

/** The completion that currently counts for a task (and occurrence), if any. */
export function countedCompletionFor(
  events: readonly CompletionEvent[],
  taskId: string,
  occurrence: string | null = null
): CompletionEvent | undefined {
  return events.find((e) => e.taskId === taskId && e.occurrence === occurrence && isCounted(e))
}

/** Newest first. */
export function sortCompletions(events: readonly CompletionEvent[]): CompletionEvent[] {
  return [...events].sort((a, b) => b.completedAt.localeCompare(a.completedAt))
}
