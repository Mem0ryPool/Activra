import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { backupFileName, DATA_FILE_NAME, DataStore } from '../../src/main/storage/dataStore'
import { draftReady, draftToInput, goalProblems } from '../../src/shared/planner/draft'
import { evaluatePlan } from '../../src/shared/planner/progress'
import { parsePlanText } from '../../src/shared/planner/ruleParser'
import { PLAN_TARGET, type Plan, type PlanInput } from '../../src/shared/planner/types'
import { validatePlanInput } from '../../src/shared/planner/validation'
import { selectTodayTasks } from '../../src/shared/taskOrder'
import { intervalWindows } from '../../src/shared/timeWindow'
import { ValidationError } from '../../src/shared/validation'

/**
 * Phase 6.1: finite timed windows ("接下来的4个小时内每个小时都喝水"). The parser reads them as one
 * interval goal; confirming the plan places the windows from the local time; each node is a one-off
 * task that can only be completed inside its window; only the last node unlocks the goal and the plan.
 */

const TODAY = '2026-10-16'
const parse = (text: string, today = TODAY) => parsePlanText(text, { today })
const codes = (g: { issues: { code: string }[] }) => g.issues.map((i) => i.code)

describe('Parser: timed windows (Chinese and English)', () => {
  const fourHours = [
    '接下来的4个小时内每个小时都喝水',
    '每小时喝水，持续四小时',
    '在接下来4小时里每小时喝一次水',
    '未来四个小时每小时喝水',
    '接下来4小时，每小时喝水',
    'Drink water every hour for the next 4 hours',
    'For the next 4 hours, drink water every hour',
    'Drink water hourly for 4 hours',
    'drink water every hour, for four hours',
    'Drink water once an hour over the next four hours'
  ]
  it.each(fourHours)('"%s" → one goal of 4 hourly windows, nothing to confirm', (text) => {
    const draft = parse(text)
    expect(draft.goals).toHaveLength(1)
    const [goal] = draft.goals
    expect(goal).toMatchObject({ kind: 'interval', intervalMinutes: 60, slots: 4, issues: [] })
    expect(goal!.title.toLowerCase()).toBe(/[一-鿿]/.test(text) ? '喝水' : 'drink water')
    expect(goal!.quantity).toBeNull()
    expect(draft.unparsed).toEqual([])
    expect(draftReady(draft, TODAY)).toBe(true)
    // One goal of four windows still gets "All achievements!", for all four.
    expect(draft.master?.name).toBe(draft.language === 'zh' ? '全成就！' : 'All Achievements!')
    const input = draftToInput(draft, TODAY)
    expect(input.goals[0]!.condition).toEqual({ kind: 'interval', start: null, minutes: 60, count: 4 })
    expect(validatePlanInput(input).master).not.toBeNull()
  })

  it('describes the rule with the windows, in both languages', () => {
    expect(parse('接下来的4个小时内每个小时都喝水').goals[0]!.achievement.description).toBe('4 小时内每小时完成一次「喝水」，共 4 次')
    expect(parse('Drink water every hour for the next 4 hours').goals[0]!.achievement.description).toBe(
      'Complete "Drink water" once every hour for 4 hours (4 times)'
    )
    expect(parse('接下来的4个小时内每个小时都喝水').master?.description).toBe('按时完成本计划全部 4 个时段')
  })

  it('1 hour is a single window and gets no "All achievements!"', () => {
    for (const text of ['接下来1小时内每小时喝水', 'Drink water every hour for the next hour', '1小时内喝水']) {
      const draft = parse(text)
      expect(draft.goals[0]).toMatchObject({ kind: 'interval', intervalMinutes: 60, slots: 1, issues: [] })
      expect(draft.master).toBeNull()
    }
  })

  it('other lengths and steps: half hours, every 2 hours, one-and-a-half hours, minutes', () => {
    expect(parse('每半小时喝水，持续2小时').goals[0]).toMatchObject({ intervalMinutes: 30, slots: 4 })
    expect(parse('每2小时喝水，持续6小时').goals[0]).toMatchObject({ intervalMinutes: 120, slots: 3 })
    expect(parse('接下来一个半小时每半小时站起来活动').goals[0]).toMatchObject({ title: '站起来活动', intervalMinutes: 30, slots: 3 })
    expect(parse('Stretch every 30 minutes for the next 2 hours').goals[0]).toMatchObject({ title: 'Stretch', intervalMinutes: 30, slots: 4 })
    expect(parse('未来24小时每4小时吃药').goals[0]).toMatchObject({ title: '吃药', intervalMinutes: 240, slots: 6 })
  })

  it('"2小时内完成作业" / "within 2 hours" is one window of that length', () => {
    expect(parse('2小时内完成作业').goals[0]).toMatchObject({ kind: 'interval', title: '完成作业', intervalMinutes: 120, slots: 1 })
    expect(parse('Finish the report within 2 hours').goals[0]).toMatchObject({ kind: 'interval', intervalMinutes: 120, slots: 1 })
    expect(parse('完成作业，2小时内').goals[0]).toMatchObject({ kind: 'interval', intervalMinutes: 120, slots: 1 })
  })

  it('never turns "every hour" without a length into an endless repeating task', () => {
    for (const text of ['每小时喝水', 'drink water every hour']) {
      const draft = parse(text)
      expect(draft.goals[0]).toMatchObject({ kind: 'interval', intervalMinutes: 60, slots: null })
      expect(goalProblems(draft.goals[0]!, TODAY)).toContain('missing-duration')
      expect(draftReady(draft, TODAY)).toBe(false)
      expect(() => draftToInput(draft, TODAY)).toThrow()
    }
  })

  it('flags readings it cannot place reliably instead of guessing', () => {
    // A span that is not whole steps.
    const uneven = parse('每2小时喝水，持续5小时').goals[0]!
    expect(codes(uneven)).toContain('inconsistent')
    expect(uneven.slots).toBeNull()
    // An even split is a guess the user must confirm.
    const split = parse('4小时内喝水3次').goals[0]!
    expect(split).toMatchObject({ kind: 'interval', slots: 3, intervalMinutes: 80 })
    expect(codes(split)).toEqual(['interval-assumed'])
    // Hourly next to a day rule, a clock time, a start date, or days of windows.
    expect(codes(parse('每天每小时喝水').goals[0]!)).toContain('hourly-unsupported')
    expect(parse('每天每小时喝水').goals[0]!.kind).not.toBe('interval')
    expect(codes(parse('今晚8点到12点每小时喝水').goals[0]!)).toContain('hourly-unsupported')
    expect(codes(parse('未来30天每小时喝水').goals[0]!)).toContain('hourly-unsupported')
    expect(codes(parse('从明天开始每小时喝水，持续4小时').goals[0]!)).toContain('hourly-unsupported')
    expect(codes(parse('Drink water every hour from 8 pm for 4 hours').goals[0]!)).toContain('hourly-unsupported')
    // More than once per window.
    expect(codes(parse('接下来4小时每小时喝水2次').goals[0]!)).toContain('inconsistent')
    for (const text of ['每天每小时喝水', '今晚8点到12点每小时喝水', '未来30天每小时喝水', '每2小时喝水，持续5小时']) {
      expect(draftReady(parse(text), TODAY)).toBe(false)
    }
  })

  it('keeps hours inside day goals as they were (quantities, not windows)', () => {
    expect(parse('每天学习2小时，持续30天').goals[0]).toMatchObject({ kind: 'count', days: 30, quantity: { amount: 2, unit: '小时' } })
    expect(parse('Study 2 hours every day for 30 days').goals[0]).toMatchObject({ kind: 'count', days: 30 })
    expect(parse('每周一三五跑步1小时，持续4周').goals[0]).toMatchObject({ kind: 'weekly', weekdays: [1, 3, 5], weeks: 4 })
  })

  it('an interval goal can be one step of a longer plan', () => {
    const draft = parse('完成数学作业，然后接下来2小时每小时喝水')
    expect(draft.goals.map((g) => g.kind)).toEqual(['once', 'interval'])
    expect(draft.goals[1]).toMatchObject({ afterPrevious: true, intervalMinutes: 60, slots: 2 })
  })

  it('validation: the page cannot place windows, and limits hold', () => {
    const input = draftToInput(parse('接下来的4个小时内每个小时都喝水'), TODAY)
    const placed = structuredClone(input)
    ;(placed.goals[0]!.condition as { start: string | null }).start = '2026-10-16T06:00:00.000Z'
    expect(() => validatePlanInput(placed)).toThrow(ValidationError)
    const tooShort = structuredClone(input)
    ;(tooShort.goals[0]!.condition as { minutes: number }).minutes = 5
    expect(() => validatePlanInput(tooShort)).toThrow(ValidationError)
    const tooLong = structuredClone(input)
    ;(tooLong.goals[0]!.condition as { count: number }).count = 49
    expect(() => validatePlanInput(tooLong)).toThrow(ValidationError)
  })
})

// ---------------------------------------------------------------------------------------------

let dir: string
let clock: number
let seq: number

/** Local time (tests run in any time zone). */
function at(day: string, hour: number, minute = 0, second = 0): void {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  clock = new Date(y, m - 1, d, hour, minute, second).getTime()
}
const local = (day: string, hour: number, minute = 0): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, hour, minute).toISOString()
}

function makeStore(): DataStore {
  return new DataStore({ directory: dir, now: () => new Date(clock), createId: () => `id-${++seq}` })
}
async function freshStore(): Promise<DataStore> {
  const store = makeStore()
  await store.load()
  return store
}

const hourlyWater = (): PlanInput => validatePlanInput(draftToInput(parse('接下来的4个小时内每个小时都喝水'), TODAY))

const current = (store: DataStore, id: string): Plan => store.snapshot().plans.find((p) => p.id === id) as Plan
const progress = (store: DataStore, id: string) => {
  const snap = store.snapshot()
  const now = new Date(clock)
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return evaluatePlan(current(store, id), snap.tasks, snap.completions, key, clock)
}
const nodes = (store: DataStore, id: string): string[] => current(store, id).goals[0]!.nodeTaskIds
const states = (store: DataStore, id: string): string[] => progress(store, id).goals[0]!.nodes.map((n) => n.state)
const kinds = (store: DataStore): string[] => store.takePlanEvents().unlocked.map((e) => e.kind)

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lu-interval-'))
  seq = 0
  at(TODAY, 14, 7, 42)
})

describe('Plan nodes with time windows', () => {
  it('confirming places 4 windows from the local time (to the minute), one task each', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(hourlyWater())
    const goal = plan.goals[0]!
    expect(goal.condition).toEqual({ kind: 'interval', start: local(TODAY, 14, 7), minutes: 60, count: 4 })
    expect(goal.nodeTaskIds).toHaveLength(4)
    expect(goal.taskId).toBe(goal.nodeTaskIds[0])
    const tasks = store.listTasks()
    expect(tasks.map((t) => t.title)).toEqual(['喝水 (1/4)', '喝水 (2/4)', '喝水 (3/4)', '喝水 (4/4)'])
    expect(tasks.map((t) => t.window)).toEqual([
      { start: local(TODAY, 14, 7), end: local(TODAY, 15, 7) },
      { start: local(TODAY, 15, 7), end: local(TODAY, 16, 7) },
      { start: local(TODAY, 16, 7), end: local(TODAY, 17, 7) },
      { start: local(TODAY, 17, 7), end: local(TODAY, 18, 7) }
    ])
    expect(tasks.every((t) => t.recurrence === null && t.due === null && t.status === 'active')).toBe(true)
    expect(plan.master?.name).toBe('全成就！')
    expect(kinds(store)).toEqual([])
    expect(progress(store, plan.id).goals[0]).toMatchObject({ status: 'active', done: 0, target: 4 })
    expect(states(store, plan.id)).toEqual(['open', 'upcoming', 'upcoming', 'upcoming'])
  })

  it('0/4 → 4/4 one window at a time; the goal and "全成就！" unlock only with the last node', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(hourlyWater())
    const [n1, n2, n3, n4] = nodes(store, plan.id) as [string, string, string, string]

    expect((await store.completeTask(n1)).unlocked).toBe(true)
    expect(progress(store, plan.id).goals[0]).toMatchObject({ done: 1, status: 'active' })
    expect(kinds(store)).toEqual([])
    // The next windows are not open: clicking them right away records nothing.
    for (const id of [n2, n3, n4]) expect(await store.completeTask(id)).toMatchObject({ unlocked: false, event: null })
    expect(store.listCompletions()).toHaveLength(1)
    expect(progress(store, plan.id).goals[0]!.done).toBe(1)

    at(TODAY, 15, 7)
    expect((await store.completeTask(n2)).unlocked).toBe(true)
    expect(progress(store, plan.id).goals[0]!.done).toBe(2)
    at(TODAY, 16, 30)
    expect((await store.completeTask(n3)).unlocked).toBe(true)
    expect(progress(store, plan.id).goals[0]!.done).toBe(3)
    expect(kinds(store)).toEqual([])
    expect(current(store, plan.id).unlocks).toEqual([])

    at(TODAY, 18, 6, 59)
    expect((await store.completeTask(n4)).unlocked).toBe(true)
    expect(progress(store, plan.id)).toMatchObject({ achieved: true, achievedOn: TODAY })
    expect(progress(store, plan.id).goals[0]).toMatchObject({ done: 4, status: 'achieved' })
    expect(kinds(store)).toEqual(['goal', 'plan'])
    expect(current(store, plan.id).unlocks.map((u) => u.target)).toEqual([plan.goals[0]!.id, PLAN_TARGET])
  })

  it('a missed window cannot be made up; the goal fails and nothing unlocks', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(hourlyWater())
    const [n1, n2, n3, n4] = nodes(store, plan.id) as [string, string, string, string]
    await store.completeTask(n1)
    at(TODAY, 15, 30)
    await store.completeTask(n2)
    // Window 3 (16:07–17:07) passes untouched.
    at(TODAY, 17, 7)
    expect(states(store, plan.id)).toEqual(['done', 'done', 'missed', 'open'])
    expect(progress(store, plan.id).goals[0]!.status).toBe('failed')
    expect(await store.completeTask(n3)).toMatchObject({ unlocked: false })
    expect((await store.completeTask(n4)).unlocked).toBe(true)
    expect(progress(store, plan.id).goals[0]).toMatchObject({ done: 3, status: 'failed' })
    expect(kinds(store)).toEqual([])
    // Ended exactly at the window's end: closed (the end is exclusive).
    at(TODAY, 18, 7)
    expect(states(store, plan.id)).toEqual(['done', 'done', 'missed', 'done'])
  })

  it('across midnight: windows keep their instants, the day it was achieved is the last one', async () => {
    at(TODAY, 22, 30)
    const store = await freshStore()
    const plan = await store.createPlan(hourlyWater())
    const windows = store.listTasks().map((t) => t.window)
    expect(windows[1]).toEqual({ start: local(TODAY, 23, 30), end: local('2026-10-17', 0, 30) })
    expect(windows[3]).toEqual({ start: local('2026-10-17', 1, 30), end: local('2026-10-17', 2, 30) })
    expect(progress(store, plan.id).goals[0]).toMatchObject({ windowStart: TODAY, windowEnd: '2026-10-17' })
    const ids = nodes(store, plan.id)
    const times: [string, number, number][] = [[TODAY, 22, 31], ['2026-10-17', 0, 5], ['2026-10-17', 0, 31], ['2026-10-17', 2, 29]]
    for (const [i, [day, h, m]] of times.entries()) {
      at(day, h, m)
      expect((await store.completeTask(ids[i]!)).unlocked).toBe(true)
    }
    expect(progress(store, plan.id)).toMatchObject({ achieved: true, achievedOn: '2026-10-17' })
  })

  it('a restart changes nothing: windows, progress and unlocks come from the file', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(hourlyWater())
    await store.completeTask(nodes(store, plan.id)[0]!)
    at(TODAY, 15, 20)
    await store.completeTask(nodes(store, plan.id)[1]!)
    await store.flush()
    at(TODAY, 16, 10)
    const reopened = await freshStore()
    expect(reopened.takePlanEvents()).toEqual({ unlocked: [], revoked: [] })
    expect(reopened.snapshot()).toEqual(store.snapshot())
    expect(states(reopened, plan.id)).toEqual(['done', 'done', 'open', 'upcoming'])
    expect(await reopened.completeTask(nodes(reopened, plan.id)[3]!)).toMatchObject({ unlocked: false })
  })

  it('undo: inside the window it can be redone; after an unlock with the window closed, everything is withdrawn', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(hourlyWater())
    const ids = nodes(store, plan.id)
    const first = await store.completeTask(ids[0]!)
    await store.undoCompletion(first.event!.id)
    expect(progress(store, plan.id).goals[0]!.done).toBe(0)
    expect((await store.completeTask(ids[0]!)).unlocked).toBe(true)
    let last = first
    for (const [i, h] of [[1, 15], [2, 16], [3, 17]] as const) {
      at(TODAY, h, 30)
      last = await store.completeTask(ids[i]!)
    }
    expect(kinds(store)).toEqual(['goal', 'plan'])
    // Undo the last node after its window closed: it is missed now, so both achievements are withdrawn.
    at(TODAY, 18, 30)
    await store.undoCompletion(last.event!.id)
    expect(store.takePlanEvents().revoked).toHaveLength(2)
    expect(current(store, plan.id).unlocks.every((u) => u.revokedAt !== null)).toBe(true)
    expect(states(store, plan.id)).toEqual(['done', 'done', 'done', 'missed'])
    expect(await store.completeTask(ids[3]!)).toMatchObject({ unlocked: false })
  })

  it('the clock moving decides only what is open now; recorded completions keep counting', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(hourlyWater())
    const ids = nodes(store, plan.id)
    await store.completeTask(ids[0]!)
    // Set back by two hours: the first completion still lies in its window; nothing else is open.
    at(TODAY, 12, 0)
    expect(states(store, plan.id)).toEqual(['done', 'upcoming', 'upcoming', 'upcoming'])
    expect(progress(store, plan.id).goals[0]!.status).toBe('active')
    expect(await store.completeTask(ids[1]!)).toMatchObject({ unlocked: false })
    // Jumped far ahead: the rest are missed and can no longer be completed.
    at(TODAY, 23, 0)
    expect(states(store, plan.id)).toEqual(['done', 'missed', 'missed', 'missed'])
    expect(await store.completeTask(ids[1]!)).toMatchObject({ unlocked: false })
    // A completion recorded outside its window (e.g. a hand-edited file) never counts.
    const snap = store.snapshot()
    const outside = { id: 'x', taskId: ids[1]!, occurrence: null, completedAt: local(TODAY, 14, 30), undoneAt: null, title: '' }
    const evaluated = evaluatePlan(current(store, plan.id), snap.tasks, [...snap.completions, outside], TODAY, clock)
    expect(evaluated.goals[0]!.nodes.map((n) => n.state)).toEqual(['done', 'missed', 'missed', 'missed'])
    expect(intervalWindows(local(TODAY, 14, 7), 60, 4)[1]).toEqual({ start: local(TODAY, 15, 7), end: local(TODAY, 16, 7) })
  })

  it('editing a node keeps its window; it cannot become repeating or get a deadline; deleting one breaks the goal', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(hourlyWater())
    const ids = nodes(store, plan.id)
    const renamed = await store.updateTask(ids[1]!, { title: '喝一杯水 (2/4)', recurrence: null, due: null })
    expect(renamed.window).toEqual({ start: local(TODAY, 15, 7), end: local(TODAY, 16, 7) })
    await expect(
      store.updateTask(ids[1]!, { recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: TODAY, endDate: null } })
    ).rejects.toThrow(ValidationError)
    await expect(store.updateTask(ids[1]!, { due: { date: TODAY, time: '18:00' } })).rejects.toThrow(ValidationError)
    await store.deleteTask(ids[2]!)
    expect(progress(store, plan.id).goals[0]!.status).toBe('broken')
    expect(states(store, plan.id)[2]).toBe('broken')
  })

  it('as a chain step it starts, with its windows, when the step before is achieved', async () => {
    const draft = parse('完成数学作业，然后接下来2小时每小时喝水')
    for (const g of draft.goals) g.issues = []
    const store = await freshStore()
    const plan = await store.createPlan(validatePlanInput(draftToInput(draft, TODAY)))
    expect(current(store, plan.id).goals[1]).toMatchObject({ taskId: null, nodeTaskIds: [], condition: { start: null } })
    expect(progress(store, plan.id).goals[1]!.status).toBe('waiting')
    at(TODAY, 20, 15, 30)
    await store.completeTask(current(store, plan.id).goals[0]!.taskId!)
    const step = current(store, plan.id).goals[1]!
    expect(step.condition).toEqual({ kind: 'interval', start: local(TODAY, 20, 15), minutes: 60, count: 2 })
    expect(step.nodeTaskIds).toHaveLength(2)
    expect(states(store, plan.id)).toEqual([])
    expect(progress(store, plan.id).goals[1]!.nodes.map((n) => n.state)).toEqual(['open', 'upcoming'])
  })

  it('"Today" (widget, tray) lists a node only while its window is open', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(hourlyWater())
    const today = (): string[] => {
      const { tasks, completions } = store.snapshot()
      return selectTodayTasks(tasks, completions, clock).items.filter((i) => !i.done).map((i) => i.task.title)
    }
    expect(today()).toEqual(['喝水 (1/4)'])
    at(TODAY, 15, 7)
    expect(today()).toEqual(['喝水 (2/4)'])
    at(TODAY, 19, 0)
    expect(today()).toEqual([])
    expect(plan.goals[0]!.nodeTaskIds).toHaveLength(4)
  })
})

describe('Data file version 4', () => {
  it('a version 3 file (Phase 6) loads unchanged, gets window null and empty node lists, and is backed up first', async () => {
    const v3 = {
      schemaVersion: 3,
      tasks: [
        {
          id: 't1', title: '背单词', description: '', createdAt: '2026-10-10T08:00:00.000Z', updatedAt: '2026-10-10T08:00:00.000Z',
          completedAt: null, status: 'active', timerConfig: null, themeOverride: null,
          recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: '2026-10-10', endDate: '2026-11-08' },
          recurrenceHistory: [], skippedOccurrences: [], due: null, reminderMinutes: null
        }
      ],
      completions: [{ id: 'e1', taskId: 't1', occurrence: '2026-10-10', completedAt: '2026-10-10T09:00:00.000Z', undoneAt: null, title: '背单词' }],
      plans: [
        {
          id: 'p1', title: '计划', sourceText: '未来30天每天背单词', createdAt: '2026-10-10T08:00:00.000Z', updatedAt: '2026-10-10T08:00:00.000Z',
          goals: [
            {
              id: 'g1', title: '背单词', category: 'vocabulary', quantity: null,
              condition: { kind: 'count', startDate: '2026-10-10', days: 30, every: 1, required: 30 },
              after: null, taskId: 't1', startedOn: '2026-10-10',
              achievement: { name: '词汇达人', description: '30 天里每天完成「背单词」', icon: 'book-open', rarity: 'epic' }
            }
          ],
          master: null,
          unlocks: []
        }
      ],
      settings: { language: 'zh-CN' }
    }
    const original = JSON.stringify(v3, null, 2)
    await writeFile(path.join(dir, DATA_FILE_NAME), original, 'utf8')
    const store = await freshStore()
    expect(store.loadReport).toMatchObject({ fromVersion: 3, migrated: true, droppedTasks: 0, droppedPlans: 0, droppedCompletions: 0 })
    expect(store.listTasks()[0]).toMatchObject({ ...v3.tasks[0], window: null })
    expect(store.snapshot().plans[0]!.goals[0]).toMatchObject({ ...v3.plans[0]!.goals[0], nodeTaskIds: [] })
    await store.createPlan(hourlyWater())
    await store.flush()
    expect(await readFile(path.join(dir, backupFileName(3)), 'utf8')).toBe(original)
    const saved = JSON.parse(await readFile(path.join(dir, DATA_FILE_NAME), 'utf8'))
    expect(saved.schemaVersion).toBe(5)
    expect(saved.tasks[0]).toEqual({ ...v3.tasks[0], window: null })
    expect(saved.completions).toEqual(v3.completions)
    expect(saved.plans).toHaveLength(2)
  })

  it('a malformed window is dropped (the task stays an ordinary task)', async () => {
    const task = (id: string, window: unknown) => ({
      id, title: id, description: '', createdAt: '2026-10-10T08:00:00.000Z', updatedAt: '2026-10-10T08:00:00.000Z', completedAt: null,
      status: 'active', timerConfig: null, themeOverride: null, recurrence: null, recurrenceHistory: [], skippedOccurrences: [],
      due: null, reminderMinutes: null, window
    })
    await writeFile(
      path.join(dir, DATA_FILE_NAME),
      JSON.stringify({
        schemaVersion: 4,
        tasks: [
          task('ok', { start: '2026-10-16T06:00:00.000Z', end: '2026-10-16T07:00:00.000Z' }),
          task('reversed', { start: '2026-10-16T07:00:00.000Z', end: '2026-10-16T06:00:00.000Z' }),
          task('junk', 'soon')
        ],
        completions: [],
        plans: [],
        settings: {}
      })
    )
    const store = await freshStore()
    expect(store.listTasks().map((t) => t.window)).toEqual([{ start: '2026-10-16T06:00:00.000Z', end: '2026-10-16T07:00:00.000Z' }, null, null])
  })
})
