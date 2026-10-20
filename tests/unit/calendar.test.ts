import { describe, expect, it } from 'vitest'
import { resolveAppearance } from '../../src/shared/appearance'
import { activityLevel, completionsByDay, dayKey, monthGrid, yearColumns } from '../../src/shared/calendar'
import { computeStats } from '../../src/shared/stats'
import type { CompletionEvent, Task } from '../../src/shared/types'

function done(id: string, completedAt: Date): Task {
  const iso = completedAt.toISOString()
  return {
    id,
    title: id,
    description: '',
    createdAt: iso,
    updatedAt: iso,
    completedAt: iso,
    status: 'completed',
    timerConfig: null,
    themeOverride: null,
    recurrence: null,
    recurrenceHistory: [],
    skippedOccurrences: [],
    due: null,
    reminderMinutes: null,
    window: null
  }
}

const eventOf = (task: Task): CompletionEvent => ({
  id: task.id,
  taskId: task.id,
  occurrence: null,
  completedAt: task.completedAt as string,
  undoneAt: null,
  title: task.title
})

describe('dayKey and completionsByDay', () => {
  it('uses the local date, zero padded', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(dayKey(new Date(2026, 0, 6, 0, 0, 1))).toBe('2026-01-06')
  })

  it('groups completions by local day across midnight and ignores undone ones', () => {
    const events: CompletionEvent[] = [
      eventOf(done('late', new Date(2026, 9, 14, 23, 59, 30))),
      eventOf(done('early', new Date(2026, 9, 15, 0, 0, 10))),
      eventOf(done('noon', new Date(2026, 9, 15, 12, 0))),
      { ...eventOf(done('undone', new Date(2026, 9, 15, 9))), undoneAt: new Date(2026, 9, 15, 9, 0, 3).toISOString() }
    ]
    const byDay = completionsByDay(events)
    expect(byDay.get('2026-10-14')?.map((t) => t.id)).toEqual(['late'])
    expect(byDay.get('2026-10-15')?.map((t) => t.id)).toEqual(['early', 'noon'])
    expect(byDay.size).toBe(2)
  })

  it('agrees with the streak on the Statistics cards', () => {
    const now = new Date(2026, 9, 15, 10).getTime()
    const tasks = [done('a', new Date(2026, 9, 14, 23, 59)), done('b', new Date(2026, 9, 15, 0, 1))]
    const events = tasks.map(eventOf)
    expect(computeStats(tasks, events, now).streakDays).toBe(2)
    expect([...completionsByDay(events).keys()]).toEqual(['2026-10-14', '2026-10-15'])
  })
})

describe('monthGrid', () => {
  it('fills whole weeks starting on Monday or Sunday', () => {
    // October 2026 starts on a Thursday and has 31 days.
    const monday = monthGrid(2026, 9, 1)
    expect(monday[0]?.key).toBe('2026-09-28')
    expect(monday.length % 7).toBe(0)
    expect(monday.filter((d) => d.inMonth)).toHaveLength(31)
    const sunday = monthGrid(2026, 9, 0)
    expect(sunday[0]?.key).toBe('2026-09-27')
    expect(sunday.at(-1)?.key).toBe('2026-10-31')
  })

  it('handles February in leap and normal years', () => {
    expect(monthGrid(2028, 1, 1).filter((d) => d.inMonth)).toHaveLength(29)
    expect(monthGrid(2026, 1, 1).filter((d) => d.inMonth)).toHaveLength(28)
  })

  it('has every date exactly once across a daylight-saving change', () => {
    // March and November contain DST switches in many time zones; day keys must stay unique and consecutive.
    for (const month of [2, 9, 10]) {
      const keys = monthGrid(2026, month, 1).map((d) => d.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})

describe('yearColumns', () => {
  it('ends with the week of today and covers 53 whole weeks', () => {
    const today = new Date(2026, 9, 15) // Thursday
    const cols = yearColumns(today, 1)
    expect(cols).toHaveLength(53)
    expect(cols.every((c) => c.length === 7)).toBe(true)
    expect(cols.at(-1)?.[0]?.key).toBe('2026-10-12') // Monday of this week
    expect(cols.at(-1)?.some((d) => d.key === '2026-10-15')).toBe(true)
    expect(cols[0]?.[0]?.key).toBe('2025-10-13')
    const keys = cols.flat().map((d) => d.key)
    expect(new Set(keys).size).toBe(53 * 7)
  })
})

describe('activityLevel', () => {
  it('maps counts to five shades', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(activityLevel)).toEqual([0, 1, 2, 3, 3, 4, 4])
  })
})

describe('resolveAppearance', () => {
  it('follows the system only when asked to', () => {
    expect(resolveAppearance('system', true)).toBe('dark')
    expect(resolveAppearance('system', false)).toBe('light')
    expect(resolveAppearance('light', true)).toBe('light')
    expect(resolveAppearance('dark', false)).toBe('dark')
  })
})
