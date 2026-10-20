import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  backupFileName,
  DATA_FILE_NAME,
  DataStore,
  HABITS_MIRROR_FILE,
  SCHEMA_VERSION
} from '../../src/main/storage/dataStore'
import { acceptableCheckinDate, applyHabitAction, habitStreak, reachedMilestone } from '../../src/shared/habits/streak'
import { reviveHabit } from '../../src/shared/habits/validation'
import { validateHabitInput } from '../../src/shared/habits/validation'
import type { Habit, HabitCheckin } from '../../src/shared/habits/types'

function habit(partial: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Drink water',
    note: '',
    frequency: { kind: 'daily' },
    startDate: '2026-10-01',
    state: 'active',
    pauses: [],
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    archivedAt: null,
    ...partial
  }
}

let seq = 0
function checkins(dates: string[], habitId = 'h1'): HabitCheckin[] {
  return dates.map((date) => ({ id: `c${++seq}`, habitId, date, checkedAt: `${date}T12:00:00.000Z`, undoneAt: null }))
}

describe('habit streaks', () => {
  it('counts a daily run ending today, or yesterday while today is still open', () => {
    const h = habit()
    const list = checkins(['2026-10-05', '2026-10-06', '2026-10-07'])
    expect(habitStreak(h, list, '2026-10-07')).toMatchObject({ current: 3, longest: 3, doneToday: true })
    // Today (the 8th) is not checked in yet: the run is still alive.
    expect(habitStreak(h, list, '2026-10-08')).toMatchObject({ current: 3, doneToday: false })
    // A whole day without a check-in breaks it; the record stays.
    expect(habitStreak(h, list, '2026-10-09')).toMatchObject({ current: 0, longest: 3 })
  })

  it('never counts an undone check-in, nor the same day twice', () => {
    const h = habit()
    const list = checkins(['2026-10-05', '2026-10-06', '2026-10-06'])
    list[1] = { ...(list[1] as HabitCheckin), undoneAt: '2026-10-06T13:00:00.000Z' }
    expect(habitStreak(h, list, '2026-10-06')).toMatchObject({ current: 2, longest: 2 })
    list[2] = { ...(list[2] as HabitCheckin), undoneAt: '2026-10-06T14:00:00.000Z' }
    expect(habitStreak(h, list, '2026-10-06')).toMatchObject({ current: 1, doneToday: false })
  })

  it('skips paused days without breaking or extending the streak', () => {
    const h = habit({ pauses: [{ from: '2026-10-06', until: '2026-10-08' }] })
    const list = checkins(['2026-10-04', '2026-10-05', '2026-10-09'])
    expect(habitStreak(h, list, '2026-10-09')).toMatchObject({ current: 3, longest: 3 })
  })

  it('counts days across a month end and a daylight-saving change as whole days', () => {
    const h = habit({ startDate: '2026-10-20' })
    const list = checkins(['2026-10-31', '2026-11-01', '2026-11-02'])
    expect(habitStreak(h, list, '2026-11-02').current).toBe(3)
  })

  it('counts weekly habits in Monday weeks that reach the target', () => {
    // 2026-10-05 is a Monday.
    const h = habit({ frequency: { kind: 'weekly', timesPerWeek: 2 }, startDate: '2026-10-05' })
    const list = checkins(['2026-10-05', '2026-10-07', '2026-10-13', '2026-10-18', '2026-10-20'])
    // Weeks of 10-05 and 10-12 are met; the week of 10-19 has one so far and is still running.
    expect(habitStreak(h, list, '2026-10-21')).toMatchObject({ unit: 'week', current: 2, longest: 2, weekCount: 1 })
    // Once that week has passed with one check-in, the streak is broken.
    expect(habitStreak(h, list, '2026-10-26')).toMatchObject({ current: 0, longest: 2 })
  })

  it('excuses an unmet first week that started mid-week', () => {
    // Created on a Friday with a target of 3: that week cannot be met and does not break anything.
    const h = habit({ frequency: { kind: 'weekly', timesPerWeek: 3 }, startDate: '2026-10-09' })
    const list = checkins(['2026-10-10', '2026-10-12', '2026-10-13', '2026-10-14'])
    expect(habitStreak(h, list, '2026-10-15')).toMatchObject({ current: 1, longest: 1 })
  })

  it('reports milestones only when the streak just reached one', () => {
    const h = habit()
    expect(reachedMilestone(h, 6, 7)).toBe(7)
    expect(reachedMilestone(h, 7, 7)).toBeNull()
    expect(reachedMilestone(h, 7, 8)).toBeNull()
    expect(reachedMilestone(habit({ frequency: { kind: 'weekly', timesPerWeek: 1 } }), 1, 2)).toBe(2)
  })

  it('accepts only today, or yesterday in the first minutes after midnight', () => {
    expect(acceptableCheckinDate(null, new Date(2026, 9, 10, 15, 0))).toBe('2026-10-10')
    expect(acceptableCheckinDate('2026-10-09', new Date(2026, 9, 10, 15, 0))).toBeNull()
    expect(acceptableCheckinDate('2026-10-09', new Date(2026, 9, 10, 0, 5))).toBe('2026-10-09')
    expect(acceptableCheckinDate('2026-10-11', new Date(2026, 9, 10, 23, 59))).toBeNull()
  })

  it('pauses from today and resumes so that today can be checked in again', () => {
    const now = '2026-10-10T10:00:00.000Z'
    const paused = applyHabitAction(habit(), 'pause', '2026-10-10', now) as Habit
    expect(paused.pauses).toEqual([{ from: '2026-10-10', until: null }])
    expect(applyHabitAction(paused, 'pause', '2026-10-10', now)).toBeNull()
    // Resumed the same day: nothing was really paused.
    expect((applyHabitAction(paused, 'resume', '2026-10-10', now) as Habit).pauses).toEqual([])
    const later = applyHabitAction(paused, 'resume', '2026-10-14', now) as Habit
    expect(later).toMatchObject({ state: 'active', pauses: [{ from: '2026-10-10', until: '2026-10-13' }] })
    const archived = applyHabitAction(later, 'archive', '2026-10-20', now) as Habit
    expect(archived).toMatchObject({ state: 'archived', archivedAt: now })
    expect((applyHabitAction(archived, 'unarchive', '2026-10-22', now) as Habit).pauses.at(-1)).toEqual({
      from: '2026-10-20',
      until: '2026-10-21'
    })
  })

  it('counts a custom habit on its chosen days only; other days neither break nor count', () => {
    // Mon/Wed/Fri. 2026-10-05 is a Monday.
    const h = habit({ frequency: { kind: 'weekdays', weekdays: [1, 3, 5] }, startDate: '2026-10-05' })
    const list = checkins(['2026-10-05', '2026-10-07', '2026-10-09'])
    expect(habitStreak(h, list, '2026-10-11')).toMatchObject({ unit: 'day', current: 3, longest: 3 })
    // Monday the 12th is scheduled and still open: nothing breaks yet.
    expect(habitStreak(h, list, '2026-10-12').current).toBe(3)
    // Once that Monday has passed without a check-in, the run is over.
    expect(habitStreak(h, list, '2026-10-13')).toMatchObject({ current: 0, longest: 3 })
    expect(reachedMilestone(h, 2, 3)).toBe(3)
    expect(validateHabitInput({ name: 'Gym', frequency: { kind: 'weekdays', weekdays: [5, 1, 1] } }).frequency).toEqual({
      kind: 'weekdays',
      weekdays: [1, 5]
    })
    expect(() => validateHabitInput({ name: 'Gym', frequency: { kind: 'weekdays', weekdays: [] } })).toThrow()
  })

  it('validates input and revives unreadable habits as null', () => {
    expect(() => validateHabitInput({ name: '  ', frequency: { kind: 'daily' } })).toThrow()
    expect(() => validateHabitInput({ name: 'Run', frequency: { kind: 'weekly', timesPerWeek: 8 } })).toThrow()
    expect(validateHabitInput({ name: ' Run ', frequency: { kind: 'weekly', timesPerWeek: 3 } })).toEqual({
      name: 'Run',
      note: '',
      frequency: { kind: 'weekly', timesPerWeek: 3 }
    })
    expect(reviveHabit({ id: 'x', name: 'Run' })).toBeNull()
  })
})

describe('DataStore habits (schema 5)', () => {
  let dir: string
  let clock: number
  let ids: number
  const makeStore = (): DataStore =>
    new DataStore({ directory: dir, now: () => new Date(clock), createId: () => `id-${++ids}` })

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'lu-habits-'))
    clock = new Date(2026, 9, 10, 15, 0).getTime()
    ids = 0
  })

  it('records one check-in per day even with concurrent clicks, and cancels only today', async () => {
    const store = makeStore()
    await store.load()
    const h = await store.createHabit({ name: 'Read', note: '', frequency: { kind: 'daily' } })
    const results = await Promise.all([store.checkInHabit(h.id, '2026-10-10'), store.checkInHabit(h.id, '2026-10-10')])
    expect(results.filter((r) => r.checkedIn)).toHaveLength(1)
    expect(store.listHabitCheckins()).toHaveLength(1)

    const first = results.find((r) => r.checkin)?.checkin as HabitCheckin
    expect((await store.undoHabitCheckin(first.id)).undone).toBe(true)
    expect((await store.undoHabitCheckin(first.id)).undone).toBe(false)
    expect((await store.checkInHabit(h.id, '2026-10-10')).checkedIn).toBe(true)

    // The next day, yesterday's check-in can no longer be cancelled or made.
    clock = new Date(2026, 9, 11, 9, 0).getTime()
    const yesterday = store.listHabitCheckins().find((c) => c.undoneAt === null) as HabitCheckin
    expect((await store.undoHabitCheckin(yesterday.id)).undone).toBe(false)
    expect((await store.checkInHabit(h.id, '2026-10-10')).checkedIn).toBe(false)
  })

  it('refuses paused or archived habits and days before the start', async () => {
    const store = makeStore()
    await store.load()
    const h = await store.createHabit({ name: 'Run', note: '', frequency: { kind: 'daily' } })
    await store.setHabitState(h.id, 'pause')
    expect((await store.checkInHabit(h.id, '2026-10-10')).checkedIn).toBe(false)
    await store.setHabitState(h.id, 'resume')
    expect((await store.checkInHabit(h.id, '2026-10-10')).checkedIn).toBe(true)
    // Created today: yesterday is before its start, even in the minutes after midnight.
    const late = await store.createHabit({ name: 'Stretch', note: '', frequency: { kind: 'daily' } })
    clock = new Date(2026, 9, 11, 0, 3).getTime()
    expect((await store.checkInHabit(late.id, '2026-10-10')).checkedIn).toBe(true)
    const earlier = await store.createHabit({ name: 'Walk', note: '', frequency: { kind: 'daily' } })
    expect((await store.checkInHabit(earlier.id, '2026-10-10')).checkedIn).toBe(false)
  })

  it('reports a milestone when a check-in completes it', async () => {
    const store = makeStore()
    await store.load()
    const h = await store.createHabit({ name: 'Read', note: '', frequency: { kind: 'daily' } })
    const milestones: (number | null)[] = []
    for (let day = 10; day <= 12; day++) {
      clock = new Date(2026, 9, day, 15, 0).getTime()
      milestones.push((await store.checkInHabit(h.id, `2026-10-${day}`)).milestone)
    }
    expect(milestones).toEqual([null, null, 3])
  })

  it('upgrades a schema 4 file without changing anything that was there, keeping the original', async () => {
    const v4 = {
      schemaVersion: 4,
      tasks: [
        {
          id: 't1',
          title: 'Old task',
          description: '',
          createdAt: '2026-10-01T08:00:00.000Z',
          updatedAt: '2026-10-02T08:00:00.000Z',
          completedAt: '2026-10-02T08:00:00.000Z',
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
      ],
      completions: [
        { id: 'e1', taskId: 't1', occurrence: null, completedAt: '2026-10-02T08:00:00.000Z', undoneAt: null, title: 'Old task' }
      ],
      plans: [],
      settings: { language: 'zh-CN' }
    }
    const raw = JSON.stringify(v4, null, 2)
    await writeFile(path.join(dir, DATA_FILE_NAME), raw, 'utf8')
    const store = makeStore()
    await store.load()
    expect(store.loadReport).toMatchObject({ fromVersion: 4, migrated: true, droppedTasks: 0, droppedCompletions: 0 })
    expect(await readFile(path.join(dir, backupFileName(4)), 'utf8')).toBe(raw)
    await store.createHabit({ name: 'Read', note: '', frequency: { kind: 'daily' } })

    const saved = JSON.parse(await readFile(path.join(dir, DATA_FILE_NAME), 'utf8'))
    expect(saved.schemaVersion).toBe(SCHEMA_VERSION)
    expect(saved.tasks).toEqual(v4.tasks)
    expect(saved.completions).toEqual(v4.completions)
    expect(saved.settings.language).toBe('zh-CN')
    expect(saved.habits).toHaveLength(1)
    expect(saved.habitCheckins).toEqual([])
  })

  it('brings habits back from the mirror after an older version saved the file without them', async () => {
    const store = makeStore()
    await store.load()
    const h = await store.createHabit({ name: 'Read', note: '', frequency: { kind: 'daily' } })
    await store.checkInHabit(h.id, '2026-10-10')
    await store.flush()

    // An older version (schema 4) loads the file and saves it again: unknown fields are gone.
    const file = path.join(dir, DATA_FILE_NAME)
    const v5 = JSON.parse(await readFile(file, 'utf8'))
    const rolledBack = { schemaVersion: 4, tasks: v5.tasks, completions: v5.completions, plans: v5.plans, settings: v5.settings }
    await writeFile(file, JSON.stringify(rolledBack), 'utf8')

    const again = makeStore()
    await again.load()
    expect(again.loadReport?.restoredHabits).toBe(1)
    expect(again.listHabits().map((x) => x.name)).toEqual(['Read'])
    expect(again.listHabitCheckins()).toHaveLength(1)
    // The original v4 backup from the first install is never replaced; this file gets its own copy.
    const files = await readdir(dir)
    expect(files).toContain(HABITS_MIRROR_FILE)
  })

  it('keeps an existing migration backup and stores a different file under a new name', async () => {
    const file = path.join(dir, DATA_FILE_NAME)
    await writeFile(path.join(dir, backupFileName(4)), '{"schemaVersion":4,"tasks":[]}', 'utf8')
    await writeFile(file, '{"schemaVersion":4,"tasks":[],"plans":[]}', 'utf8')
    const store = makeStore()
    await store.load()
    expect(await readFile(path.join(dir, backupFileName(4)), 'utf8')).toBe('{"schemaVersion":4,"tasks":[]}')
    const extra = (await readdir(dir)).filter((f) => f.startsWith('life-unlocked-data.v4-backup-'))
    expect(extra).toHaveLength(1)
    expect(await readFile(path.join(dir, extra[0] as string), 'utf8')).toBe('{"schemaVersion":4,"tasks":[],"plans":[]}')
  })

  it('drops check-ins of unknown habits and counts a duplicated day once on load', async () => {
    const h = habit({ id: 'h1', startDate: '2026-10-01' })
    await writeFile(
      path.join(dir, DATA_FILE_NAME),
      JSON.stringify({
        schemaVersion: 5,
        tasks: [],
        completions: [],
        plans: [],
        habits: [h],
        habitCheckins: [...checkins(['2026-10-09', '2026-10-09']), ...checkins(['2026-10-09'], 'gone')],
        settings: {}
      }),
      'utf8'
    )
    const store = makeStore()
    await store.load()
    const list = store.listHabitCheckins()
    expect(list).toHaveLength(2)
    expect(list.filter((c) => c.undoneAt === null)).toHaveLength(1)
  })

  it('checks a custom habit in only on its chosen days', async () => {
    const store = makeStore()
    await store.load()
    // 2026-10-10 is a Saturday.
    const weekdays = await store.createHabit({ name: 'Gym', note: '', frequency: { kind: 'weekdays', weekdays: [1, 3, 5] } })
    const saturday = await store.createHabit({ name: 'Hike', note: '', frequency: { kind: 'weekdays', weekdays: [6] } })
    expect((await store.checkInHabit(weekdays.id, '2026-10-10')).checkedIn).toBe(false)
    expect((await store.checkInHabit(saturday.id, '2026-10-10')).checkedIn).toBe(true)
  })

  it('deletes a habit with its check-ins and keeps the mirror current, also after the last one', async () => {
    const store = makeStore()
    await store.load()
    const h = await store.createHabit({ name: 'Read', note: '', frequency: { kind: 'daily' } })
    const result = await store.checkInHabit(h.id, '2026-10-10')
    expect(await store.deleteHabit(h.id)).toEqual([result.checkin?.id])
    expect(store.listHabits()).toEqual([])
    expect(store.listHabitCheckins()).toEqual([])
    await store.flush()
    const mirror = JSON.parse(await readFile(path.join(dir, HABITS_MIRROR_FILE), 'utf8'))
    expect(mirror).toMatchObject({ habits: [], habitCheckins: [] })
  })
})
