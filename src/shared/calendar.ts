import { completionDay, countedCompletions } from './completions'
import { dayKey } from './dates'
import type { CompletionEvent } from './types'

export { dayKey }

/**
 * Calendar helpers for the Statistics page. Everything works on local calendar
 * fields (year/month/day), never on fixed 24-hour steps, so daylight-saving
 * days and midnight boundaries land on the right date.
 */

export type WeekStart = 0 | 1 // 0 = Sunday, 1 = Monday

export interface CalendarDay {
  /** Local date as YYYY-MM-DD. */
  key: string
  year: number
  /** 0–11 */
  month: number
  day: number
  /** Inside the month being shown (month view) — always true in the year view. */
  inMonth: boolean
}

function toDay(date: Date, inMonth = true): CalendarDay {
  return { key: dayKey(date), year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), inMonth }
}

/** Completions that count, grouped by their day (see `completionDay`), each day in completion order. */
export function completionsByDay(events: readonly CompletionEvent[]): Map<string, CompletionEvent[]> {
  const byDay = new Map<string, CompletionEvent[]>()
  const done = countedCompletions(events).sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt))
  for (const event of done) {
    const key = completionDay(event)
    const list = byDay.get(key)
    if (list) list.push(event)
    else byDay.set(key, [event])
  }
  return byDay
}

/** Whole weeks covering a month, starting on `weekStart`. Days from neighbouring months have inMonth false. */
export function monthGrid(year: number, month: number, weekStart: WeekStart): CalendarDay[] {
  const first = new Date(year, month, 1)
  const lead = (first.getDay() - weekStart + 7) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7
  const days: CalendarDay[] = []
  for (let i = 0; i < cells; i++) {
    const date = new Date(year, month, 1 - lead + i)
    days.push(toDay(date, date.getMonth() === month))
  }
  return days
}

/** 0 = nothing, then 1, 2, 3–4 and 5+ completions. */
export function activityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count === 2) return 2
  if (count <= 4) return 3
  return 4
}

/**
 * The last `weeks` weeks as columns (oldest first), the last column holding today,
 * like a contributions graph. Days after today are included so columns stay whole.
 */
export function yearColumns(today: Date, weekStart: WeekStart, weeks = 53): CalendarDay[][] {
  const lead = (today.getDay() - weekStart + 7) % 7
  const firstColumnStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - lead - (weeks - 1) * 7)
  const columns: CalendarDay[][] = []
  for (let w = 0; w < weeks; w++) {
    const column: CalendarDay[] = []
    for (let d = 0; d < 7; d++) {
      column.push(
        toDay(
          new Date(firstColumnStart.getFullYear(), firstColumnStart.getMonth(), firstColumnStart.getDate() + w * 7 + d)
        )
      )
    }
    columns.push(column)
  }
  return columns
}
