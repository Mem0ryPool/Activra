import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DATA_FILE_NAME, DataStore } from '../../src/main/storage/dataStore'
import { createTranslator } from '../../src/shared/i18n'
import {
  habitCheckinFeedback,
  habitFeedbackCard,
  type HabitFeedback
} from '../../src/shared/habits/feedback'
import type { Habit, HabitCheckin } from '../../src/shared/habits/types'

function habit(partial: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Run',
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
const checkin = (date: string, habitId = 'h1'): HabitCheckin => ({
  id: `c${++seq}`,
  habitId,
  date,
  checkedAt: `${date}T12:00:00.000Z`,
  undoneAt: null
})
const list = (dates: string[]): HabitCheckin[] => dates.map((d) => checkin(d))

/** The feedback for checking in on `date` (also "today") with `earlier` already there. */
function feedbackFor(h: Habit, earlier: string[], date: string): HabitFeedback {
  const before = list(earlier)
  const added = checkin(date)
  return habitCheckinFeedback(h, before, [...before, added], added, date)
}

const en = createTranslator('en')
const zh = createTranslator('zh-CN')

describe('habit check-in feedback levels', () => {
  it('a plain check-in gets the light message (level 1)', () => {
    // The first check-in ever is not a "record".
    expect(feedbackFor(habit(), [], '2026-10-05')).toMatchObject({ level: 'checkin', record: false, streak: 1 })
    // A growing streak that stays below the longest one is not a record either.
    const h = habit()
    const earlier = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-06']
    expect(feedbackFor(h, earlier, '2026-10-07')).toMatchObject({ level: 'checkin', record: false, streak: 2 })
  })

  it('a streak that goes past the longest one before is a new record (level 2)', () => {
    const h = habit()
    // Longest 3 (1st–3rd), broken on the 4th, then 5th–7th = 3: the 8th makes 4.
    const earlier = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07']
    expect(feedbackFor(h, earlier, '2026-10-08')).toMatchObject({ level: 'record', record: true, streak: 4, unit: 'day' })
    // Equal to the record is not a new record (3 is a milestone, so that card stays).
    expect(feedbackFor(h, earlier.slice(0, 5), '2026-10-07')).toMatchObject({ level: 'milestone', record: false, streak: 3 })
  })

  it('a record that is also a milestone shows the record; a milestone alone keeps its card', () => {
    const h = habit()
    expect(feedbackFor(h, ['2026-10-01', '2026-10-02'], '2026-10-03')).toMatchObject({ level: 'record', milestone: 3 })
    // Longest 5, broken, then back to 3: a milestone, not a record.
    const earlier = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-07', '2026-10-08']
    expect(feedbackFor(h, earlier, '2026-10-09')).toMatchObject({ level: 'milestone', record: false, milestone: 3 })
  })

  it('a weekly habit reaching its target for the first time this week is the weekly goal (level 3)', () => {
    // 2026-10-05 is a Monday.
    const h = habit({ frequency: { kind: 'weekly', timesPerWeek: 3 }, startDate: '2026-10-05' })
    expect(feedbackFor(h, ['2026-10-05'], '2026-10-06')).toMatchObject({ level: 'checkin', week: { count: 2, target: 3 } })
    expect(feedbackFor(h, ['2026-10-05', '2026-10-06'], '2026-10-07')).toMatchObject({
      level: 'weekly-goal',
      unit: 'week',
      week: { count: 3, target: 3 }
    })
    // A fourth check-in in the same week is above the target already: just the light message.
    expect(feedbackFor(h, ['2026-10-05', '2026-10-06', '2026-10-07'], '2026-10-08')).toMatchObject({
      level: 'checkin',
      week: { count: 4, target: 3 }
    })
  })

  it('weekly goal and new record together show only the weekly goal, with the record on the same card', () => {
    const h = habit({ frequency: { kind: 'weekly', timesPerWeek: 2 }, startDate: '2026-10-05' })
    // Week of 10-05 met (longest 1); week of 10-12 has one; the 14th meets it: 2 weeks, a record.
    const feedback = feedbackFor(h, ['2026-10-05', '2026-10-06', '2026-10-12'], '2026-10-14')
    expect(feedback).toMatchObject({ level: 'weekly-goal', record: true, streak: 2, unit: 'week' })
    const card = habitFeedbackCard('Run', feedback, zh)
    expect(card).toEqual({
      heading: '🏆 本周目标达成！2/2',
      taskTitle: 'Run · 🔥 新纪录：连续 2 周',
      titleSuffix: ' · 🔥 新纪录：连续 2 周',
      variant: 'habit-goal'
    })
  })

  it('counts the week of the check-in, not of the clock, just after midnight on a Monday', () => {
    const h = habit({ frequency: { kind: 'weekly', timesPerWeek: 2 }, startDate: '2026-10-05' })
    const before = list(['2026-10-10'])
    const added = checkin('2026-10-11') // Sunday, checked in at 00:05 on Monday the 12th
    expect(habitCheckinFeedback(h, before, [...before, added], added, '2026-10-12')).toMatchObject({
      level: 'weekly-goal',
      week: { count: 2, target: 2 }
    })
  })
})

describe('habit feedback cards and texts', () => {
  const base: HabitFeedback = { level: 'checkin', claimed: null, unit: 'day', streak: 7, record: false, milestone: null, week: null }

  it('a plain check-in gets the light card in the same corner (Phase 6.6.2b)', () => {
    expect(habitFeedbackCard('Run', base, en)).toEqual({ heading: '✓ Check-in complete!', taskTitle: 'Run', variant: 'habit-checkin' })
    expect(habitFeedbackCard('喝水', base, zh)).toMatchObject({ heading: '✓ 打卡成功！', variant: 'habit-checkin' })
    // A weekly habit's light card names the week's count.
    const weekly = { ...base, unit: 'week' as const, week: { count: 6, target: 6 } }
    expect(habitFeedbackCard('跑步', weekly, zh)).toEqual({
      heading: '✓ 打卡成功！',
      taskTitle: '跑步 · 本周 6/6',
      titleSuffix: ' · 本周 6/6',
      variant: 'habit-checkin'
    })
  })

  it('names a record in days or weeks, in English and Chinese', () => {
    const record = { ...base, level: 'record' as const, record: true }
    expect(habitFeedbackCard('Run', record, en)).toMatchObject({ heading: '🔥 New record! 7-day streak!', variant: 'habit-record' })
    expect(habitFeedbackCard('跑步', record, zh)).toMatchObject({ heading: '🔥 新纪录！连续坚持 7 天！', taskTitle: '跑步' })
    const weeks = { ...record, unit: 'week' as const, streak: 4 }
    expect(habitFeedbackCard('Run', weeks, en)?.heading).toBe('🔥 New record! 4-week streak!')
    expect(habitFeedbackCard('跑步', weeks, zh)?.heading).toBe('🔥 新纪录！连续坚持 4 周！')
  })

  it('shows the weekly goal with its count', () => {
    const goal = { ...base, level: 'weekly-goal' as const, unit: 'week' as const, streak: 1, week: { count: 3, target: 3 } }
    expect(habitFeedbackCard('Run', goal, en)).toEqual({ heading: '🏆 Weekly goal achieved! 3/3', taskTitle: 'Run', variant: 'habit-goal' })
    expect(habitFeedbackCard('跑步', goal, zh)?.heading).toBe('🏆 本周目标达成！3/3')
    // A running streak rides along on the same card.
    expect(habitFeedbackCard('Run', { ...goal, streak: 3 }, en)?.taskTitle).toBe('Run · 3-week streak')
  })

  it('keeps the milestone card text of Phase 6.6', () => {
    const milestone = { ...base, level: 'milestone' as const, milestone: 7 }
    expect(habitFeedbackCard('跑步', milestone, zh)).toMatchObject({ heading: '连续打卡 7 天！', variant: 'goal' })
  })
})

describe('habit check-ins in the store (feedback)', () => {
  let dir: string
  let clock: number
  let ids: number
  const makeStore = (): DataStore => new DataStore({ directory: dir, now: () => new Date(clock), createId: () => `id-${++ids}` })
  const at = (day: number): void => {
    clock = new Date(2026, 9, day, 15, 0).getTime()
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'lu-habit-feedback-'))
    at(5)
    ids = 0
  })

  it('answers only a recorded check-in; a second click and a refused one get no feedback', async () => {
    const store = makeStore()
    await store.load()
    const h = await store.createHabit({ name: 'Read', note: '', frequency: { kind: 'daily' } })
    const [a, b] = await Promise.all([store.checkInHabit(h.id, '2026-10-05'), store.checkInHabit(h.id, '2026-10-05')])
    expect([a.feedback?.level ?? null, b.feedback?.level ?? null].sort()).toEqual(['checkin', null])
    const again = await store.checkInHabit(h.id, '2026-10-05')
    expect(again).toMatchObject({ checkedIn: false, feedback: null })
    // A past day is refused: no record, no feedback.
    expect(await store.checkInHabit(h.id, '2026-10-01')).toMatchObject({ checkedIn: false, feedback: null })
    expect(store.listHabitCheckins()).toHaveLength(1)
  })

  it('reloading the data replays nothing: feedback only comes with a new check-in', async () => {
    const store = makeStore()
    await store.load()
    const h = await store.createHabit({ name: 'Read', note: '', frequency: { kind: 'daily' } })
    await store.checkInHabit(h.id, '2026-10-05')
    await store.flush()
    const reloaded = makeStore()
    await reloaded.load()
    expect(reloaded.listHabitCheckins()).toHaveLength(1)
    // The only way to get feedback is checkInHabit, which refuses the day already checked in.
    expect((await reloaded.checkInHabit(h.id, '2026-10-05')).feedback).toBeNull()
  })
})

describe('a goal met again after a cancel: "already given", decided from the stored records (Phase 6.6.2c)', () => {
  let dir: string
  let clock: number
  let ids: number
  const makeStore = (): DataStore => new DataStore({ directory: dir, now: () => new Date(clock), createId: () => `id-${++ids}` })
  /** Day of October 2026 at 15:00, plus a few seconds so every step has its own time. */
  const at = (day: number, seconds = 0): void => {
    clock = new Date(2026, 9, day, 15, 0, seconds).getTime()
  }
  const key = (day: number): string => `2026-10-${String(day).padStart(2, '0')}`
  const counted = (store: DataStore): number => store.listHabitCheckins().filter((c) => c.undoneAt === null).length

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'lu-habit-claimed-'))
    at(5)
    ids = 0
  })

  it('weekly: gold the first time; cancel and reach it again = "already given"; also after a restart; next week gold again', async () => {
    const store = makeStore()
    await store.load()
    // Created on Monday 2026-10-05, twice a week.
    const h = await store.createHabit({ name: '跑步', note: '', frequency: { kind: 'weekly', timesPerWeek: 2 } })
    expect((await store.checkInHabit(h.id, key(5))).feedback?.level).toBe('checkin')
    at(6)
    const first = await store.checkInHabit(h.id, key(6))
    expect(first.feedback).toMatchObject({ level: 'weekly-goal', claimed: null, week: { count: 2, target: 2 } })

    // Cancel: back to 1/2.
    at(6, 5)
    expect((await store.undoHabitCheckin(first.checkin?.id as string)).undone).toBe(true)
    at(6, 10)
    const again = await store.checkInHabit(h.id, key(6))
    expect(again.feedback).toMatchObject({ level: 'claimed', claimed: 'weekly-goal', week: { count: 2, target: 2 } })
    expect(habitFeedbackCard('跑步', again.feedback as HabitFeedback, zh)).toEqual({
      heading: '本周目标已达成 2/2',
      taskTitle: '跑步',
      detail: '金色奖励已领取 · 本周不重复发放',
      variant: 'habit-claimed'
    })
    expect(habitFeedbackCard('Run', again.feedback as HabitFeedback, en)).toMatchObject({
      heading: 'Weekly goal reached 2/2',
      detail: 'Gold reward already given · not again this week'
    })

    // After a restart the stored records still say so: no second gold card.
    await store.flush()
    const reloaded = makeStore()
    await reloaded.load()
    at(6, 20)
    await reloaded.undoHabitCheckin(again.checkin?.id as string)
    at(6, 30)
    expect((await reloaded.checkInHabit(h.id, key(6))).feedback?.level).toBe('claimed')

    // A third check-in in the same week is above the target: plain.
    at(7)
    expect((await reloaded.checkInHabit(h.id, key(7))).feedback?.level).toBe('checkin')
    // Next week: the first time the goal is met it is gold again.
    at(12)
    expect((await reloaded.checkInHabit(h.id, key(12))).feedback?.level).toBe('checkin')
    at(13)
    expect((await reloaded.checkInHabit(h.id, key(13))).feedback).toMatchObject({ level: 'weekly-goal', claimed: null })
    // Never a second record for a day: one counted check-in per day.
    expect(counted(reloaded)).toBe(5)
  })

  it('weekly: met on one day, cancelled, then met on another day of the same week = "already given"', async () => {
    const store = makeStore()
    await store.load()
    const h = await store.createHabit({ name: 'Run', note: '', frequency: { kind: 'weekly', timesPerWeek: 1 } })
    const first = await store.checkInHabit(h.id, key(5))
    expect(first.feedback?.level).toBe('weekly-goal')
    at(5, 5)
    await store.undoHabitCheckin(first.checkin?.id as string)
    at(7)
    expect((await store.checkInHabit(h.id, key(7))).feedback).toMatchObject({ level: 'claimed', claimed: 'weekly-goal' })
  })

  it('a plain check-in cancelled and made again stays plain; the cancel itself answers nothing', async () => {
    const store = makeStore()
    await store.load()
    const h = await store.createHabit({ name: 'Water', note: '', frequency: { kind: 'daily' } })
    const first = await store.checkInHabit(h.id, key(5))
    expect(first.feedback?.level).toBe('checkin')
    at(5, 5)
    const undone = await store.undoHabitCheckin(first.checkin?.id as string)
    expect(Object.keys(undone).sort()).toEqual(['habit', 'undone'])
    at(5, 10)
    expect((await store.checkInHabit(h.id, key(5))).feedback).toMatchObject({ level: 'checkin', claimed: null })
    // Same day, already checked in: refused, no feedback.
    expect((await store.checkInHabit(h.id, key(5))).feedback).toBeNull()
  })

  it('daily: a new record cancelled and reached again the same day says "already given" for today', async () => {
    const store = makeStore()
    await store.load()
    const h = await store.createHabit({ name: '冥想', note: '', frequency: { kind: 'daily' } })
    // 5th–8th: 4 days, break on the 9th, 10th–13th: 4 again.
    for (const day of [5, 6, 7, 8, 10, 11, 12, 13]) {
      at(day)
      await store.checkInHabit(h.id, key(day))
    }
    at(14)
    const record = await store.checkInHabit(h.id, key(14))
    expect(record.feedback).toMatchObject({ level: 'record', streak: 5 })
    at(14, 5)
    await store.undoHabitCheckin(record.checkin?.id as string)
    at(14, 10)
    const again = await store.checkInHabit(h.id, key(14))
    expect(again.feedback).toMatchObject({ level: 'claimed', claimed: 'record', unit: 'day', streak: 5 })
    expect(habitFeedbackCard('冥想', again.feedback as HabitFeedback, zh)).toEqual({
      heading: '今日目标已达成',
      taskTitle: '冥想',
      detail: '纪录奖励已领取 · 今天不重复发放',
      variant: 'habit-claimed'
    })
    // The next day's record is new again.
    at(15)
    expect((await store.checkInHabit(h.id, key(15))).feedback).toMatchObject({ level: 'record', claimed: null, streak: 6 })
  })

  it('custom days: the text speaks of today, never of the week', async () => {
    const store = makeStore()
    await store.load()
    // 2026-10-05 is a Monday; Mondays and Wednesdays. 5, 7 = 2; miss 12; 14 = 1… so build 5, 7, 12 then 14 = 4.
    const h = await store.createHabit({ name: 'Gym', note: '', frequency: { kind: 'weekdays', weekdays: [1, 3] } })
    for (const day of [5, 7, 12]) {
      at(day)
      await store.checkInHabit(h.id, key(day))
    }
    at(14)
    const record = await store.checkInHabit(h.id, key(14))
    expect(record.feedback).toMatchObject({ level: 'record', streak: 4 })
    at(14, 5)
    await store.undoHabitCheckin(record.checkin?.id as string)
    at(14, 10)
    const again = await store.checkInHabit(h.id, key(14))
    expect(habitFeedbackCard('Gym', again.feedback as HabitFeedback, en)).toMatchObject({
      heading: "Today's goal reached",
      detail: 'Record reward already given · not again today'
    })
  })

  it('nothing new is stored: the data file keeps its fields and one counted check-in per day', async () => {
    const store = makeStore()
    await store.load()
    const h = await store.createHabit({ name: 'Run', note: '', frequency: { kind: 'weekly', timesPerWeek: 1 } })
    const first = await store.checkInHabit(h.id, key(5))
    at(5, 5)
    await store.undoHabitCheckin(first.checkin?.id as string)
    at(5, 10)
    await store.checkInHabit(h.id, key(5))
    await store.flush()
    const file = JSON.parse(await readFile(path.join(dir, DATA_FILE_NAME), 'utf8')) as {
      habitCheckins: Record<string, unknown>[]
    } & Record<string, unknown>
    expect(Object.keys(file).sort()).toEqual(['completions', 'habitCheckins', 'habits', 'plans', 'schemaVersion', 'settings', 'tasks'])
    expect(file.habitCheckins.map((c) => c['undoneAt'] === null)).toEqual([false, true])
    expect(Object.keys(file.habitCheckins[0] as object).sort()).toEqual(['checkedAt', 'date', 'habitId', 'id', 'undoneAt'])
  })
})
