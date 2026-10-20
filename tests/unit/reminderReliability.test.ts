import { describe, expect, it } from 'vitest'
import { CATCH_UP_MS, decideReminders, remindersDue, staleShown } from '../../src/main/reminderPlanner'
import { DEFAULT_REMINDER_SETTINGS } from '../../src/shared/constants'
import type { Task } from '../../src/shared/types'

function task(extra: Partial<Task>): Task {
  return {
    id: 't',
    title: 'Essay',
    description: '',
    createdAt: new Date(2026, 9, 1, 8).toISOString(),
    updatedAt: new Date(2026, 9, 1, 8).toISOString(),
    completedAt: null,
    status: 'active',
    timerConfig: null,
    themeOverride: null,
    recurrence: null,
    recurrenceHistory: [],
    skippedOccurrences: [],
    due: null,
    reminderMinutes: null,
    window: null,
    ...extra
  }
}

const at = (y: number, mo: number, d: number, h = 0, mi = 0): number => new Date(y, mo - 1, d, h, mi).getTime()
const settings = DEFAULT_REMINDER_SETTINGS
const essay = task({ id: 'a', due: { date: '2026-10-16', time: '18:00' }, reminderMinutes: 15 })
const keysAt = (tasks: Task[], now: number): Set<string> => new Set(remindersDue(tasks, [], settings, now).map((r) => r.key))

/** Simulates the service: what it would show at each check, remembering what it handled. */
function runChecks(tasks: Task[], times: number[]): { shown: string[][]; skipped: string[] } {
  const handled = new Set<string>()
  const shown: string[][] = []
  const skipped: string[] = []
  for (const now of times) {
    const decision = decideReminders(remindersDue(tasks, [], settings, now), (k) => handled.has(k), now)
    for (const r of [...decision.send, ...decision.summary, ...decision.skip]) handled.add(r.key)
    for (const r of decision.send) shown.push([r.key])
    if (decision.summary.length) shown.push(decision.summary.map((r) => r.key))
    skipped.push(...decision.skip.map((r) => r.key))
  }
  return { shown, skipped }
}

describe('withdrawing shown reminders', () => {
  const shown: [string, string[]][] = [['toast-a', ['a@once@2026-10-16T18:00@15']]]
  const now = at(2026, 10, 16, 17, 50)

  it('keeps a reminder whose task still needs it', () => {
    expect(staleShown(shown, keysAt([essay], now))).toEqual([])
  })

  it('withdraws it after the task is completed', () => {
    expect(staleShown(shown, keysAt([{ ...essay, status: 'completed' }], now))).toEqual(['toast-a'])
  })

  it('withdraws it after the task is deleted', () => {
    expect(staleShown(shown, keysAt([], now))).toEqual(['toast-a'])
  })

  it('withdraws it after the deadline or the reminder offset changes', () => {
    expect(staleShown(shown, keysAt([{ ...essay, due: { date: '2026-10-17', time: '18:00' } }], now))).toEqual(['toast-a'])
    expect(staleShown(shown, keysAt([{ ...essay, reminderMinutes: 5 }], now))).toEqual(['toast-a'])
  })

  it('keeps a summary while any of its tasks still needs it', () => {
    const b = task({ id: 'b', due: { date: '2026-10-16', time: '18:00' }, reminderMinutes: 15 })
    const summary: [string, string[]][] = [['summary', ['a@once@2026-10-16T18:00@15', 'b@once@2026-10-16T18:00@15']]]
    expect(staleShown(summary, keysAt([{ ...essay, status: 'completed' }, b], now))).toEqual([])
    expect(staleShown(summary, keysAt([], now))).toEqual(['summary'])
  })
})

describe('sleep, wake and clock changes', () => {
  it('checks every 20 seconds for an hour: one reminder, once', () => {
    const start = at(2026, 10, 16, 17, 30)
    const times = Array.from({ length: 180 }, (_, i) => start + i * 20_000)
    expect(runChecks([essay], times).shown).toEqual([['a@once@2026-10-16T18:00@15']])
  })

  it('waking after a long sleep shows no storm: old reminders are skipped, recent ones summarized', () => {
    const tasks = Array.from({ length: 8 }, (_, i) =>
      task({ id: `t${i}`, due: { date: '2026-10-16', time: `${String(9 + i).padStart(2, '0')}:00` }, reminderMinutes: 0 })
    )
    // Asleep from 08:00 to 16:10: 09:00–15:00 are long past, 16:00 is recent.
    const result = runChecks(tasks, [at(2026, 10, 16, 8), at(2026, 10, 16, 16, 10), at(2026, 10, 16, 16, 10)])
    expect(result.shown).toEqual([['t7@once@2026-10-16T16:00@0']])
    expect(result.skipped).toHaveLength(7)
  })

  it('more than three recent reminders after waking become one summary', () => {
    const tasks = ['a', 'b', 'c', 'd'].map((id) => task({ id, due: { date: '2026-10-16', time: '16:00' }, reminderMinutes: 0 }))
    const result = runChecks(tasks, [at(2026, 10, 16, 15), at(2026, 10, 16, 16, 5), at(2026, 10, 16, 16, 6)])
    expect(result.shown).toHaveLength(1)
    expect(result.shown[0]).toHaveLength(4)
  })

  it('a clock set back after a reminder does not send it again', () => {
    const result = runChecks([essay], [at(2026, 10, 16, 17, 46), at(2026, 10, 16, 17, 0), at(2026, 10, 16, 17, 47)])
    expect(result.shown).toHaveLength(1)
  })

  it('a clock set forward past the catch-up window records the reminder silently', () => {
    const result = runChecks([essay], [at(2026, 10, 16, 17), at(2026, 10, 16, 17, 45) + CATCH_UP_MS + 60_000])
    expect(result.shown).toEqual([])
    expect(result.skipped).toEqual(['a@once@2026-10-16T18:00@15'])
  })

  it('never completes the task: the planner only reads tasks', () => {
    const tasks = [essay]
    const frozen = JSON.stringify(tasks)
    runChecks(tasks, [at(2026, 10, 16, 17, 45), at(2026, 10, 17, 9)])
    expect(JSON.stringify(tasks)).toBe(frozen)
  })
})

describe('repeat summary in the task dialog (known 4B issue)', () => {
  it('says weekly when Weekly is picked after Daily, in both languages', async () => {
    const { describeRule } = await import('../../src/renderer/src/lib/recurrenceText')
    const { createTranslator } = await import('../../src/shared/i18n')
    // What the dialog holds after switching from Daily to Weekly: the old 'day' unit is still there.
    const rule = { preset: 'weekly' as const, unit: 'day' as const, interval: 1, weekdays: [], startDate: '2026-10-16', endDate: null }
    expect(describeRule(rule, createTranslator('zh-CN'), 'zh-CN')).toBe('每周周五')
    expect(describeRule(rule, createTranslator('en'), 'en')).toBe('Every week on Fri')
  })
})
