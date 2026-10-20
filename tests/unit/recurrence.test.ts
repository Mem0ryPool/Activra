import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DataStore } from '../../src/main/storage/dataStore'
import {
  addDays,
  applyRuleChange,
  missedByDay,
  nextOccurrence,
  normalizeRule,
  occursOn,
  ruleOccursOn,
  weekdayOf,
  type RecurrenceRule
} from '../../src/shared/recurrence'
import { selectTodayTasks } from '../../src/shared/taskOrder'
import type { Task } from '../../src/shared/types'
import { validateRecurrence, ValidationError } from '../../src/shared/validation'

const rule = (patch: Partial<RecurrenceRule>): RecurrenceRule =>
  normalizeRule({
    preset: 'daily',
    unit: 'day',
    interval: 1,
    weekdays: [],
    startDate: '2026-10-01',
    endDate: null,
    ...patch
  })

function series(r: RecurrenceRule, extra: Partial<Task> = {}): Task {
  return {
    id: 's',
    title: 'Series',
    description: '',
    createdAt: new Date(2026, 9, 1, 8).toISOString(),
    updatedAt: new Date(2026, 9, 1, 8).toISOString(),
    completedAt: null,
    status: 'active',
    timerConfig: null,
    themeOverride: null,
    recurrence: r,
    recurrenceHistory: [],
    skippedOccurrences: [],
    due: null,
    reminderMinutes: null,
    window: null,
    ...extra
  }
}

describe('date keys', () => {
  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('knows weekdays (2026-10-16 is a Friday)', () => {
    expect(weekdayOf('2026-10-16')).toBe(5)
    expect(weekdayOf('2026-10-18')).toBe(0)
  })

  it('counts whole days across daylight-saving changes', () => {
    // Europe and the US change clocks in late March / early November; every day still repeats.
    const daily = rule({ startDate: '2026-03-01' })
    for (let key = '2026-03-01'; key <= '2026-11-30'; key = addDays(key, 1)) expect(ruleOccursOn(daily, key)).toBe(true)
    const every3 = rule({ preset: 'custom', interval: 3, startDate: '2026-03-27' })
    expect(['2026-03-27', '2026-03-30', '2026-04-02'].every((k) => ruleOccursOn(every3, k))).toBe(true)
    expect(ruleOccursOn(every3, '2026-03-29')).toBe(false)
  })
})

describe('rules', () => {
  it('daily, weekly, weekdays', () => {
    expect(ruleOccursOn(rule({}), '2026-09-30')).toBe(false)
    expect(ruleOccursOn(rule({}), '2026-10-01')).toBe(true)
    // 2026-10-01 is a Thursday.
    const weekly = rule({ preset: 'weekly' })
    expect(weekly.weekdays).toEqual([4])
    expect(['2026-10-08', '2026-10-15'].every((k) => ruleOccursOn(weekly, k))).toBe(true)
    expect(ruleOccursOn(weekly, '2026-10-09')).toBe(false)
    const weekdays = rule({ preset: 'weekdays' })
    expect(ruleOccursOn(weekdays, '2026-10-16')).toBe(true)
    expect(ruleOccursOn(weekdays, '2026-10-17')).toBe(false)
  })

  it('custom: every N days, every N weeks on chosen days, end date inclusive', () => {
    const every2Weeks = rule({ preset: 'custom', unit: 'week', interval: 2, weekdays: [1, 3], startDate: '2026-10-01' })
    // Week of Sep 28 (start week): Wed Sep 30 is before the start; next counted week is Oct 12.
    expect(ruleOccursOn(every2Weeks, '2026-10-05')).toBe(false)
    expect(ruleOccursOn(every2Weeks, '2026-10-12')).toBe(true)
    expect(ruleOccursOn(every2Weeks, '2026-10-14')).toBe(true)
    expect(ruleOccursOn(every2Weeks, '2026-10-19')).toBe(false)
    const ending = rule({ endDate: '2026-10-10' })
    expect(ruleOccursOn(ending, '2026-10-10')).toBe(true)
    expect(ruleOccursOn(ending, '2026-10-11')).toBe(false)
    expect(nextOccurrence(series(ending), '2026-10-11')).toBeNull()
  })

  it('validates input', () => {
    expect(validateRecurrence(null)).toBeNull()
    expect(validateRecurrence({ preset: 'weekdays', startDate: '2026-10-16' })).toMatchObject({
      weekdays: [1, 2, 3, 4, 5]
    })
    for (const bad of [
      { preset: 'hourly', startDate: '2026-10-16' },
      { preset: 'daily', startDate: '2026-02-30' },
      { preset: 'daily', startDate: '2026-10-16', endDate: '2026-10-15' },
      { preset: 'custom', unit: 'day', interval: 0, startDate: '2026-10-16' },
      { preset: 'custom', unit: 'week', interval: 53, startDate: '2026-10-16' },
      { preset: 'custom', unit: 'week', weekdays: [7], startDate: '2026-10-16' },
      { preset: 'daily', startDate: '2026-10-16', extra: 1 }
    ]) {
      expect(() => validateRecurrence(bad)).toThrow(ValidationError)
    }
  })
})

describe('series', () => {
  it('never plans days before the task existed', () => {
    const task = series(rule({ startDate: '2026-09-01' }))
    expect(occursOn(task, '2026-09-15')).toBe(false)
    expect(occursOn(task, '2026-10-01')).toBe(true)
  })

  it('editing applies from today on and keeps past days as they were', () => {
    const before = series(rule({}))
    const changed = { ...before, ...applyRuleChange(before, rule({ preset: 'weekdays' }), '2026-10-16') }
    expect(changed.recurrenceHistory).toEqual([{ rule: before.recurrence, until: '2026-10-15' }])
    // Saturday Oct 10 was planned under the old rule and still is; Saturday Oct 17 is not any more.
    expect(occursOn(changed, '2026-10-10')).toBe(true)
    expect(occursOn(changed, '2026-10-17')).toBe(false)
    // A second edit on the same day does not turn today's rule into history.
    const again = { ...changed, ...applyRuleChange(changed, rule({}), '2026-10-16') }
    expect(again.recurrenceHistory).toHaveLength(1)
    // Turning repeat off keeps the past plan too.
    const off = { ...again, ...applyRuleChange(again, null, '2026-10-20') }
    expect(off.recurrence).toBeNull()
    expect(occursOn(off, '2026-10-18')).toBe(true)
    expect(occursOn(off, '2026-10-20')).toBe(false)
  })

  it('tells "planned but not done" apart from "nothing planned", and never marks today', () => {
    const task = series(rule({ preset: 'weekdays' }), { skippedOccurrences: ['2026-10-14'] })
    const done = [
      {
        id: 'e1',
        taskId: 's',
        occurrence: '2026-10-12',
        completedAt: '2026-10-12T10:00:00Z',
        undoneAt: null,
        title: 'Series'
      },
      {
        id: 'e2',
        taskId: 's',
        occurrence: '2026-10-13',
        completedAt: '2026-10-13T10:00:00Z',
        undoneAt: '2026-10-13T10:00:03Z',
        title: 'Series'
      }
    ]
    const missed = missedByDay([task], done, '2026-10-10', '2026-10-20', '2026-10-16')
    // 10/11 Sun: nothing planned. 10/12 done. 10/13 undone → missed. 10/14 skipped. 10/15 missed. 10/16 is today.
    expect([...missed.keys()]).toEqual(['2026-10-13', '2026-10-15'])
  })

  it('today shows each occurrence once, done or not, and moves on at midnight', () => {
    const task = series(rule({}))
    const events = [
      {
        id: 'e1',
        taskId: 's',
        occurrence: '2026-10-15',
        completedAt: new Date(2026, 9, 15, 23, 0).toISOString(),
        undoneAt: null,
        title: 'Series'
      }
    ]
    const late = selectTodayTasks([task], events, new Date(2026, 9, 15, 23, 59).getTime())
    expect(late.items.map((x) => [x.key, x.done])).toEqual([['s@2026-10-15', true]])
    const next = selectTodayTasks([task], events, new Date(2026, 9, 16, 0, 0, 1).getTime())
    expect(next.items.map((x) => [x.key, x.done])).toEqual([['s@2026-10-16', false]])
  })
})

describe('DataStore with repeating tasks', () => {
  let dir: string
  let clock: number
  let seq: number
  const makeStore = (): DataStore =>
    new DataStore({ directory: dir, now: () => new Date(clock), createId: () => `id-${++seq}` })

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'lu-repeat-'))
    clock = new Date(2026, 9, 16, 9).getTime()
    seq = 0
  })

  const create = (store: DataStore, r: RecurrenceRule | null = rule({ startDate: '2026-10-16' })) =>
    store.createTask({
      title: 'Water plants',
      description: '',
      timerDurationSec: 1800,
      themeOverride: null,
      recurrence: r
    })

  it('completes today once, never a missed day or a future one, and the task stays a template', async () => {
    const store = makeStore()
    await store.load()
    const task = await create(store)
    expect(task.timerConfig).toBeNull()
    const results = await Promise.all([
      store.completeTask(task.id, '2026-10-16'),
      store.completeTask(task.id, '2026-10-16')
    ])
    expect(results.filter((r) => r.unlocked)).toHaveLength(1)
    expect(results[0]?.task.status).toBe('active')
    expect((await store.completeTask(task.id, '2026-10-17')).unlocked).toBe(false)
    expect((await store.completeTask(task.id, '2026-10-15')).unlocked).toBe(false)
    expect(store.listCompletions().map((e) => e.occurrence)).toEqual(['2026-10-16'])

    // Undo today, complete again: a new record, still one counted.
    await store.undoCompletion(results.find((r) => r.unlocked)!.event!.id)
    expect((await store.completeTask(task.id)).unlocked).toBe(true)
    expect(store.listCompletions().filter((e) => !e.undoneAt)).toHaveLength(1)

    // Next day: a fresh occurrence.
    clock = new Date(2026, 9, 17, 8).getTime()
    expect((await store.completeTask(task.id)).event?.occurrence).toBe('2026-10-17')
  })

  it('accepts yesterday only in the minutes right after midnight', async () => {
    const store = makeStore()
    await store.load()
    const task = await create(store)
    clock = new Date(2026, 9, 17, 0, 0, 30).getTime()
    expect((await store.completeTask(task.id, '2026-10-16')).event?.occurrence).toBe('2026-10-16')
    clock = new Date(2026, 9, 18, 0, 30).getTime()
    expect((await store.completeTask(task.id, '2026-10-17')).unlocked).toBe(false)
  })

  it('skips one occurrence only, and survives a restart', async () => {
    const store = makeStore()
    await store.load()
    const task = await create(store)
    await store.skipOccurrence(task.id, '2026-10-16', true)
    expect((await store.completeTask(task.id)).unlocked).toBe(false)
    await expect(store.skipOccurrence(task.id, '2026-10-15', true)).rejects.toThrow(ValidationError)
    await store.flush()
    const reloaded = makeStore()
    await reloaded.load()
    expect(reloaded.listTasks()[0]).toMatchObject({
      skippedOccurrences: ['2026-10-16'],
      recurrence: { preset: 'daily' }
    })
    await reloaded.skipOccurrence(task.id, '2026-10-16', false)
    expect((await reloaded.completeTask(task.id)).unlocked).toBe(true)
  })

  it('editing the rule keeps history; past completions stay', async () => {
    const store = makeStore()
    await store.load()
    clock = new Date(2026, 9, 10, 9).getTime()
    const task = await create(store, rule({ startDate: '2026-10-10' }))
    await store.completeTask(task.id)
    clock = new Date(2026, 9, 16, 9).getTime()
    const edited = await store.updateTask(task.id, {
      recurrence: rule({ preset: 'weekdays', startDate: '2026-10-10' })
    })
    expect(edited.recurrenceHistory).toEqual([{ rule: rule({ startDate: '2026-10-10' }), until: '2026-10-15' }])
    expect(occursOn(edited, '2026-10-11')).toBe(true)
    expect(occursOn(edited, '2026-10-18')).toBe(false)
    expect(store.listCompletions().map((e) => e.occurrence)).toEqual(['2026-10-10'])
    // Same rule again: nothing changes.
    const same = await store.updateTask(task.id, { title: 'Water the plants', recurrence: edited.recurrence })
    expect(same.recurrenceHistory).toHaveLength(1)
  })
})
