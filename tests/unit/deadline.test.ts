// Fixed time zone with a daylight-saving change (Europe: last Sunday of March / October).
process.env.TZ = 'Europe/Berlin'

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CATCH_UP_MS, decideReminders, remindersDue, type DueReminder } from '../../src/main/reminderPlanner'
import { DataStore } from '../../src/main/storage/dataStore'
import { DEFAULT_REMINDER_SETTINGS } from '../../src/shared/constants'
import { isOverdue, normalizeDue, overdueFrom, reminderAt, reminderKey } from '../../src/shared/deadline'
import type { CompletionEvent, Task } from '../../src/shared/types'
import {
  validateDue,
  validateReminderSettings,
  validateSettingsPatch,
  ValidationError
} from '../../src/shared/validation'

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

describe('deadlines', () => {
  it('a timed deadline is overdue from its time; a date-only one from 00:00 the next day', () => {
    const timed = task({ due: { date: '2026-10-16', time: '18:00' } })
    expect(overdueFrom(timed, null)).toBe(at(2026, 10, 16, 18))
    expect(isOverdue(timed, null, at(2026, 10, 16, 17, 59))).toBe(false)
    expect(isOverdue(timed, null, at(2026, 10, 16, 18))).toBe(true)
    const dateOnly = task({ due: { date: '2026-10-16', time: null } })
    expect(isOverdue(dateOnly, null, at(2026, 10, 16, 23, 59))).toBe(false)
    expect(isOverdue(dateOnly, null, at(2026, 10, 17, 0, 0))).toBe(true)
  })

  it('reminds before the time, or from the all-day time for date-only deadlines', () => {
    expect(reminderAt(task({ due: { date: '2026-10-16', time: '18:00' }, reminderMinutes: 15 }), null, '09:00')).toBe(
      at(2026, 10, 16, 17, 45)
    )
    expect(reminderAt(task({ due: { date: '2026-10-16', time: null }, reminderMinutes: 0 }), null, '09:00')).toBe(
      at(2026, 10, 16, 9)
    )
    expect(reminderAt(task({ due: { date: '2026-10-16', time: null }, reminderMinutes: 1440 }), null, '08:30')).toBe(
      at(2026, 10, 15, 8, 30)
    )
    expect(
      reminderAt(task({ due: { date: '2026-10-16', time: '18:00' }, reminderMinutes: null }), null, '09:00')
    ).toBeNull()
  })

  it('"1 day before" keeps the wall-clock time across a daylight-saving change', () => {
    // 2026-03-29 has only 23 hours in Berlin.
    const r = reminderAt(task({ due: { date: '2026-03-29', time: '09:00' }, reminderMinutes: 1440 }), null, '09:00')
    expect(new Date(r as number).getHours()).toBe(9)
    expect(new Date(r as number).getDate()).toBe(28)
    expect(at(2026, 3, 29, 9) - (r as number)).toBe(23 * 3600 * 1000)
  })

  it('a repeating task is due on each occurrence', () => {
    const r = task({
      recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: '2026-10-01', endDate: null },
      due: { date: null, time: '20:00' },
      reminderMinutes: 30
    })
    expect(reminderAt(r, '2026-10-16', '09:00')).toBe(at(2026, 10, 16, 19, 30))
    expect(reminderKey(r, '2026-10-16')).toBe('t@2026-10-16@2026-10-16T20:00@30')
    expect(reminderKey(r, '2026-10-17')).not.toBe(reminderKey(r, '2026-10-16'))
  })

  it('the reminder key changes when the deadline or offset changes', () => {
    const a = task({ due: { date: '2026-10-16', time: '18:00' }, reminderMinutes: 15 })
    expect(reminderKey(a, null)).toBe('t@once@2026-10-16T18:00@15')
    expect(reminderKey({ ...a, due: { date: '2026-10-16', time: '19:00' } }, null)).not.toBe(reminderKey(a, null))
    expect(reminderKey({ ...a, reminderMinutes: 30 }, null)).not.toBe(reminderKey(a, null))
  })

  it('keeps deadlines consistent with repeating', () => {
    expect(normalizeDue({ date: '2026-10-16', time: '18:00' }, true)).toEqual({ date: null, time: '18:00' })
    expect(normalizeDue({ date: null, time: '18:00' }, false)).toBeNull()
    expect(() => validateDue({ date: '2026-10-16', time: '7:00' })).toThrow(ValidationError)
    expect(() => validateDue({ date: '2026-13-01', time: null })).toThrow(ValidationError)
    expect(() => validateReminderSettings({ ...DEFAULT_REMINDER_SETTINGS, allDayTime: '25:00' })).toThrow(
      ValidationError
    )
    expect(validateSettingsPatch({ reminders: DEFAULT_REMINDER_SETTINGS })).toEqual({
      reminders: DEFAULT_REMINDER_SETTINGS
    })
  })
})

describe('reminder planning', () => {
  const settings = DEFAULT_REMINDER_SETTINGS
  const oneOff = task({ id: 'a', title: 'Essay', due: { date: '2026-10-16', time: '18:00' }, reminderMinutes: 15 })

  it('is due once its time comes, and not for completed tasks or occurrences', () => {
    expect(remindersDue([oneOff], [], settings, at(2026, 10, 16, 17, 44))).toEqual([])
    expect(remindersDue([oneOff], [], settings, at(2026, 10, 16, 17, 45)).map((r) => r.key)).toEqual([
      'a@once@2026-10-16T18:00@15'
    ])
    expect(remindersDue([{ ...oneOff, status: 'completed' }], [], settings, at(2026, 10, 16, 17, 50))).toEqual([])

    const daily = task({
      id: 'd',
      recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: '2026-10-01', endDate: null },
      due: { date: null, time: '20:00' },
      reminderMinutes: 0
    })
    const done: CompletionEvent[] = [
      {
        id: 'e',
        taskId: 'd',
        occurrence: '2026-10-16',
        completedAt: new Date(at(2026, 10, 16, 12)).toISOString(),
        undoneAt: null,
        title: 'x'
      }
    ]
    // Yesterday's (missed) and today's occurrence at 20:05; today's is done.
    expect(remindersDue([daily], done, settings, at(2026, 10, 16, 20, 5)).map((r) => r.occurrence)).toEqual([
      '2026-10-15'
    ])
    // Undo today's completion: it is due again.
    const undone = [{ ...done[0]!, undoneAt: new Date(at(2026, 10, 16, 12, 1)).toISOString() }]
    expect(remindersDue([daily], undone, settings, at(2026, 10, 16, 20, 5)).map((r) => r.occurrence)).toEqual([
      '2026-10-15',
      '2026-10-16'
    ])
  })

  const reminder = (key: string, fireAt: number): DueReminder => ({
    key,
    taskId: key,
    occurrence: null,
    title: key,
    fireAt,
    overdueAt: fireAt + 15 * 60_000,
    date: '2026-10-16',
    time: '18:00'
  })

  it('catches up recent reminders, silently skips old ones, and never repeats', () => {
    const now = at(2026, 10, 16, 18)
    const due = [reminder('old', now - CATCH_UP_MS - 1), reminder('recent', now - CATCH_UP_MS), reminder('now', now)]
    const first = decideReminders(due, () => false, now)
    expect(first.send.map((r) => r.key)).toEqual(['recent', 'now'])
    expect(first.skip.map((r) => r.key)).toEqual(['old'])
    const handled = new Set(['old', 'recent', 'now'])
    expect(decideReminders(due, (k) => handled.has(k), now + 60_000)).toEqual({ send: [], summary: [], skip: [] })
  })

  it('combines more than three at once into one summary', () => {
    const now = at(2026, 10, 16, 18)
    const due = ['a', 'b', 'c', 'd'].map((k) => reminder(k, now - 60_000))
    const decision = decideReminders(due, () => false, now)
    expect(decision.send).toEqual([])
    expect(decision.summary.map((r) => r.key)).toEqual(['a', 'b', 'c', 'd'])
    expect(decideReminders(due.slice(0, 3), () => false, now).send).toHaveLength(3)
  })
})

describe('DataStore deadlines', () => {
  it('drops a reminder without a deadline and keeps only the time for a repeating task', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lu-due-'))
    const store = new DataStore({ directory: dir, now: () => new Date(at(2026, 10, 16, 9)) })
    await store.load()
    const t = await store.createTask({
      title: 'Report',
      description: '',
      timerDurationSec: null,
      themeOverride: null,
      due: { date: '2026-10-20', time: '17:00' },
      reminderMinutes: 60
    })
    expect(t).toMatchObject({ due: { date: '2026-10-20', time: '17:00' }, reminderMinutes: 60 })
    const repeating = await store.updateTask(t.id, {
      recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: '2026-10-16', endDate: null }
    })
    expect(repeating.due).toEqual({ date: null, time: '17:00' })
    const noDue = await store.updateTask(t.id, { due: null })
    expect(noDue.reminderMinutes).toBeNull()
    await store.flush()
    const reloaded = new DataStore({ directory: dir })
    await reloaded.load()
    expect(reloaded.listTasks()[0]).toMatchObject({ due: null, reminderMinutes: null })
    expect(reloaded.getSettings().reminders).toEqual(DEFAULT_REMINDER_SETTINGS)
  })
})

describe('reminder settings on load', () => {
  it('keeps defaults for missing fields and restores valid ones one by one', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lu-due-settings-'))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      path.join(dir, 'life-unlocked-data.json'),
      JSON.stringify({
        schemaVersion: 2,
        tasks: [],
        completions: [],
        settings: { reminders: { sound: false, allDayTime: 'x' } }
      })
    )
    const store = new DataStore({ directory: dir })
    await store.load()
    expect(store.getSettings().reminders).toEqual({ ...DEFAULT_REMINDER_SETTINGS, sound: false })
  })
})
