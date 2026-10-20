import { describe, expect, it } from 'vitest'
import { createTranslator, matchLocale, resolveLocale } from '../../src/shared/i18n'
import { en } from '../../src/shared/i18n/en'
import { zhCN } from '../../src/shared/i18n/zh-CN'
import { computeStats } from '../../src/shared/stats'
import { formatCountdown, getRemainingMs } from '../../src/shared/timer'
import type { CompletionEvent, Task } from '../../src/shared/types'

describe('timer', () => {
  const timer = { kind: 'countdown' as const, durationSec: 90, startedAt: '2026-10-15T10:00:00.000Z' }
  const start = Date.parse(timer.startedAt)

  it('counts down and stops at zero', () => {
    expect(getRemainingMs(timer, start)).toBe(90_000)
    expect(getRemainingMs(timer, start + 89_500)).toBe(500)
    expect(getRemainingMs(timer, start + 200_000)).toBe(0)
  })

  it('formats', () => {
    expect(formatCountdown(90_000)).toBe('1:30')
    expect(formatCountdown(500)).toBe('0:01')
    expect(formatCountdown(3_723_000)).toBe('1:02:03')
    expect(formatCountdown(0)).toBe('0:00')
  })
})

describe('i18n', () => {
  it('has the same keys in every locale', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort())
  })
  it('resolves locales and interpolates', () => {
    expect(matchLocale('zh-Hans-CN')).toBe('zh-CN')
    expect(matchLocale('en-US')).toBe('en')
    expect(matchLocale(undefined)).toBe('en')
    expect(resolveLocale('system', 'zh-CN')).toBe('zh-CN')
    expect(resolveLocale('en', 'zh-CN')).toBe('en')
    expect(createTranslator('zh-CN')('achievements.subtitle', { count: 3 })).toBe('已解锁 3 项')
  })
})

describe('computeStats', () => {
  const base: Omit<Task, 'id' | 'status' | 'completedAt'> = {
    title: 't',
    description: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    timerConfig: null,
    themeOverride: null,
    recurrence: null,
    recurrenceHistory: [],
    skippedOccurrences: [],
    due: null,
    reminderMinutes: null,
    window: null
  }
  const day = (offset: number): string => new Date(2026, 9, 15 + offset, 12).toISOString()
  const tasks: Task[] = [
    { ...base, id: '1', status: 'completed', completedAt: day(0) },
    { ...base, id: '2', status: 'completed', completedAt: day(-1) },
    { ...base, id: '3', status: 'completed', completedAt: day(-3) },
    { ...base, id: '4', status: 'completed', completedAt: day(-20) },
    { ...base, id: '5', status: 'active', completedAt: null }
  ]

  const events: CompletionEvent[] = tasks
    .filter((x) => x.completedAt)
    .map((x) => ({
      id: `e${x.id}`,
      taskId: x.id,
      occurrence: null,
      completedAt: x.completedAt as string,
      undoneAt: null,
      title: x.title
    }))

  it('counts unlocks, recent unlocks and the current streak', () => {
    const stats = computeStats(tasks, events, new Date(2026, 9, 15, 18).getTime())
    expect(stats).toEqual({ unlocked: 4, active: 1, unlockedLast7Days: 3, streakDays: 2 })
  })

  it('leaves undone completions out of every number', () => {
    const now = new Date(2026, 9, 15, 18).getTime()
    // Undo today's completion: the task is in progress again, and today no longer extends the streak.
    const undone = events.map((e) => (e.taskId === '1' ? { ...e, undoneAt: day(0) } : e))
    const reopened = tasks.map((x) => (x.id === '1' ? { ...x, status: 'active' as const, completedAt: null } : x))
    expect(computeStats(reopened, undone, now)).toEqual({ unlocked: 3, active: 2, unlockedLast7Days: 2, streakDays: 1 })
  })
})
