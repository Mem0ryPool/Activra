import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { backupFileName, DATA_FILE_NAME, DataStore } from '../../src/main/storage/dataStore'
import { evaluatePlan } from '../../src/shared/planner/progress'
import { flexibleTaskIds, taskInputForGoal } from '../../src/shared/planner/sync'
import { PLAN_TARGET, type GoalCondition, type Plan, type PlanGoalInput, type PlanInput } from '../../src/shared/planner/types'
import { validatePlanInput } from '../../src/shared/planner/validation'
import { ValidationError } from '../../src/shared/validation'

let dir: string
let clock: number
let seq: number

/** Local time on that date (tests run in any time zone, e.g. China or UTC). */
function at(day: string, hour = 10, minute = 0): void {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  clock = new Date(y, m - 1, d, hour, minute).getTime()
}

function makeStore(): DataStore {
  return new DataStore({ directory: dir, now: () => new Date(clock), createId: () => `id-${++seq}` })
}

async function freshStore(): Promise<DataStore> {
  const store = makeStore()
  await store.load()
  return store
}

const ach = { name: 'Badge', description: '', icon: 'target', rarity: 'common' } as const

function goal(key: string, condition: GoalCondition, afterKey: string | null = null, title = key): PlanGoalInput {
  return { key, title, category: 'general', quantity: null, condition, afterKey, achievement: { ...ach, name: `${title} badge` } }
}

function planInput(goals: PlanGoalInput[], master = goals.length >= 2): PlanInput {
  return { title: 'My plan', sourceText: 'text', goals, master: master ? { ...ach, name: '全成就！', icon: 'crown' } : null }
}

const daily = (days: number, required = days, startDate: string | null = null): GoalCondition => ({
  kind: 'count',
  startDate,
  days,
  every: 1,
  required
})

function progressOf(store: DataStore, plan: Plan, today: string): ReturnType<typeof evaluatePlan> {
  const snap = store.snapshot()
  const current = snap.plans.find((p) => p.id === plan.id) as Plan
  return evaluatePlan(current, snap.tasks, snap.completions, today, new Date(`${today}T12:00:00`).getTime())
}

function taskOf(store: DataStore, planId: string, index: number): string {
  return store.snapshot().plans.find((p) => p.id === planId)?.goals[index]?.taskId as string
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lu-plan-'))
  at('2026-10-16')
  seq = 0
})

describe('A daily goal over N days', () => {
  it('creates a definite series (not an endless repeat) and unlocks only on the last required day', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('words', daily(3), null, 'Words')]))
    const task = store.listTasks()[0]
    expect(task?.recurrence).toMatchObject({ preset: 'daily', startDate: '2026-10-16', endDate: '2026-10-18' })
    expect(plan.goals[0]?.taskId).toBe(task?.id)

    // One click is one day, not the whole goal.
    await store.completeTask(task!.id, '2026-10-16')
    expect(store.takePlanEvents().unlocked).toEqual([])
    expect(progressOf(store, plan, '2026-10-16').goals[0]).toMatchObject({ status: 'active', done: 1, target: 3 })

    at('2026-10-17')
    await store.completeTask(task!.id, '2026-10-17')
    expect(store.takePlanEvents().unlocked).toEqual([])

    at('2026-10-18')
    await store.completeTask(task!.id, '2026-10-18')
    const events = store.takePlanEvents()
    expect(events.unlocked).toEqual([
      expect.objectContaining({ kind: 'goal', name: 'Words badge', planId: plan.id })
    ])
    // Taken once only.
    expect(store.takePlanEvents().unlocked).toEqual([])
    expect(progressOf(store, plan, '2026-10-18').goals[0]).toMatchObject({ status: 'achieved', achievedOn: '2026-10-18' })
  })

  it('a missed day makes an every-day goal unreachable (failed), never unlocked', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('w', daily(3))]))
    const id = taskOf(store, plan.id, 0)
    await store.completeTask(id, '2026-10-16')
    at('2026-10-18')
    await store.completeTask(id, '2026-10-18')
    expect(progressOf(store, plan, '2026-10-18').goals[0]).toMatchObject({ status: 'failed', done: 2 })
    expect(store.takePlanEvents().unlocked).toEqual([])
  })

  it('skipping a day counts as not done: the goal can no longer be reached', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('w', daily(3))]))
    const id = taskOf(store, plan.id, 0)
    await store.skipOccurrence(id, '2026-10-17', true)
    expect(progressOf(store, plan, '2026-10-16').goals[0]?.status).toBe('failed')
    // Unskipping restores the chance.
    await store.skipOccurrence(id, '2026-10-17', false)
    expect(progressOf(store, plan, '2026-10-16').goals[0]?.status).toBe('active')
  })

  it('"M of N days" tolerates missed days up to the slack', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('gym', daily(4, 2))]))
    const id = taskOf(store, plan.id, 0)
    at('2026-10-17')
    await store.completeTask(id, '2026-10-17')
    at('2026-10-19')
    await store.completeTask(id, '2026-10-19')
    expect(store.takePlanEvents().unlocked).toHaveLength(1)
    expect(flexibleTaskIds(store.snapshot().plans).has(id)).toBe(true)
  })

  it('crosses a month end', async () => {
    at('2026-10-30')
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('w', daily(3))]))
    const id = taskOf(store, plan.id, 0)
    expect(store.listTasks()[0]?.recurrence?.endDate).toBe('2026-11-01')
    for (const day of ['2026-10-30', '2026-10-31', '2026-11-01']) {
      at(day)
      await store.completeTask(id, day)
    }
    expect(store.takePlanEvents().unlocked).toHaveLength(1)
  })
})

describe('Per-week goals', () => {
  it('counts each 7-day block from the start (crossing calendar weeks and months)', async () => {
    // Thursday Oct 29: blocks Oct 29–Nov 4 and Nov 5–Nov 11.
    at('2026-10-29')
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('gym', { kind: 'weekly', startDate: null, weeks: 2, perWeek: 2, weekdays: null })]))
    const id = taskOf(store, plan.id, 0)
    // Any day can be the day (daily availability, 14 days).
    expect(store.listTasks()[0]?.recurrence).toMatchObject({ preset: 'daily', endDate: '2026-11-11' })

    for (const day of ['2026-10-31', '2026-11-02']) {
      at(day)
      await store.completeTask(id, day)
    }
    // Week 1 met; three more in week 1 would not make up week 2.
    at('2026-11-03')
    await store.completeTask(id, '2026-11-03')
    let p = progressOf(store, plan, '2026-11-03').goals[0]
    expect(p?.periods.map((x) => [x.start, x.end, x.done])).toEqual([
      ['2026-10-29', '2026-11-04', 2],
      ['2026-11-05', '2026-11-11', 0]
    ])
    expect(store.takePlanEvents().unlocked).toEqual([])

    for (const day of ['2026-11-05', '2026-11-11']) {
      at(day)
      await store.completeTask(id, day)
    }
    p = progressOf(store, plan, '2026-11-11').goals[0]
    expect(p).toMatchObject({ status: 'achieved', achievedOn: '2026-11-11', done: 4, target: 4 })
    expect(store.takePlanEvents().unlocked).toHaveLength(1)
  })

  it('fails once a week can no longer reach its count', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('gym', { kind: 'weekly', startDate: null, weeks: 2, perWeek: 3, weekdays: null })]))
    const id = taskOf(store, plan.id, 0)
    // Friday Oct 16 → Thursday Oct 22 is the first block; on Oct 21 with 1 done, 2 days remain: still possible.
    await store.completeTask(id, '2026-10-16')
    expect(progressOf(store, plan, '2026-10-21').goals[0]?.status).toBe('active')
    // On Oct 22 with 1 done, only that day remains: 2 < 3.
    expect(progressOf(store, plan, '2026-10-22').goals[0]?.status).toBe('failed')
  })

  it('fixed weekdays create a weekly series on those days', () => {
    const input = taskInputForGoal({ title: 'P' }, {
      id: 'g', title: 'Run', category: 'running', quantity: null, after: null, taskId: null, nodeTaskIds: [], startedOn: null, achievement: { ...ach },
      condition: { kind: 'weekly', startDate: '2026-10-19', weeks: 4, perWeek: 3, weekdays: [1, 3, 5] }
    }, '2026-10-16')
    expect(input.recurrence).toMatchObject({ preset: 'custom', unit: 'week', weekdays: [1, 3, 5], startDate: '2026-10-19', endDate: '2026-11-15' })
  })
})

describe('Streaks', () => {
  it('needs consecutive days; a gap restarts the run', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('run', { kind: 'streak', startDate: null, days: 6, length: 3 })]))
    const id = taskOf(store, plan.id, 0)
    for (const day of ['2026-10-16', '2026-10-17', '2026-10-19', '2026-10-20']) {
      at(day)
      await store.completeTask(id, day)
    }
    expect(progressOf(store, plan, '2026-10-20').goals[0]).toMatchObject({ status: 'active', done: 2 })
    expect(store.takePlanEvents().unlocked).toEqual([])
    at('2026-10-21')
    await store.completeTask(id, '2026-10-21')
    expect(progressOf(store, plan, '2026-10-21').goals[0]).toMatchObject({ status: 'achieved', achievedOn: '2026-10-21' })
    expect(store.takePlanEvents().unlocked).toHaveLength(1)
  })
})

describe('"全成就！" (the whole plan)', () => {
  it('unlocks only when every goal holds, and is withdrawn by an undo', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(
      planInput([goal('hw', { kind: 'once', due: '2026-10-17', onTime: true }, null, 'Homework'), goal('w', daily(2), null, 'Words')])
    )
    const hw = taskOf(store, plan.id, 0)
    const words = taskOf(store, plan.id, 1)

    await store.completeTask(hw)
    expect(store.takePlanEvents().unlocked.map((e) => e.kind)).toEqual(['goal'])
    await store.completeTask(words, '2026-10-16')
    expect(store.takePlanEvents().unlocked).toEqual([])

    at('2026-10-17')
    const last = await store.completeTask(words, '2026-10-17')
    const events = store.takePlanEvents()
    expect(events.unlocked.map((e) => [e.kind, e.name])).toEqual([
      ['goal', 'Words badge'],
      ['plan', '全成就！']
    ])
    const planUnlock = events.unlocked[1]!.unlockId

    // Undo the last day: the words goal and the plan achievement are withdrawn, homework stays.
    await store.undoCompletion(last.event!.id)
    const undone = store.takePlanEvents()
    expect(undone.unlocked).toEqual([])
    expect(undone.revoked).toContain(planUnlock)
    expect(undone.revoked).toHaveLength(2)
    const saved = store.snapshot().plans[0]!
    expect(saved.unlocks.filter((u) => u.revokedAt === null).map((u) => u.target)).toEqual([saved.goals[0]!.id])
    // Records are kept, marked revoked.
    expect(saved.unlocks.find((u) => u.id === planUnlock)?.revokedAt).not.toBeNull()

    // Completing again unlocks again, as a new record.
    await store.completeTask(words, '2026-10-17')
    const again = store.takePlanEvents().unlocked
    expect(again.map((e) => e.kind)).toEqual(['goal', 'plan'])
    expect(again[1]!.unlockId).not.toBe(planUnlock)
  })

  it('cannot unlock once a goal\'s task is deleted', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('a', { kind: 'once', due: null, onTime: false }), goal('b', { kind: 'once', due: null, onTime: false })]))
    await store.completeTask(taskOf(store, plan.id, 0))
    store.takePlanEvents()
    await store.deleteTask(taskOf(store, plan.id, 0))
    const events = store.takePlanEvents()
    expect(events.revoked).toHaveLength(1)
    await store.completeTask(taskOf(store, plan.id, 1))
    expect(store.takePlanEvents().unlocked.map((e) => e.kind)).toEqual(['goal'])
    const p = progressOf(store, plan, '2026-10-16')
    expect(p.goals.map((g) => g.status)).toEqual(['broken', 'achieved'])
    expect(p.achieved).toBe(false)
    expect(p.failed).toBe(true)
  })

  it('a late completion of an on-time goal does not count', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('hw', { kind: 'once', due: '2026-10-16', onTime: true })]))
    at('2026-10-17')
    expect(progressOf(store, plan, '2026-10-17').goals[0]?.status).toBe('failed')
    await store.completeTask(taskOf(store, plan.id, 0))
    expect(store.takePlanEvents().unlocked).toEqual([])
    expect(progressOf(store, plan, '2026-10-17').goals[0]?.status).toBe('failed')
  })
})

describe('Chains (one step after another)', () => {
  it('creates a step\'s task only after the step before it is achieved', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(
      planInput([goal('hw', { kind: 'once', due: null, onTime: false }), goal('py', daily(2), 'hw', 'Python')], true)
    )
    expect(store.listTasks()).toHaveLength(1)
    expect(progressOf(store, plan, '2026-10-16').goals[1]?.status).toBe('waiting')

    at('2026-10-17')
    const done = await store.completeTask(taskOf(store, plan.id, 0))
    const tasks = store.listTasks()
    expect(tasks).toHaveLength(2)
    // The step's window starts on the day it was unlocked.
    expect(tasks[1]?.recurrence).toMatchObject({ startDate: '2026-10-17', endDate: '2026-10-18' })
    expect(store.snapshot().plans[0]?.goals[1]).toMatchObject({ startedOn: '2026-10-17' })

    // Undoing the first step does not delete the second step's task (no user data is removed).
    await store.undoCompletion(done.event!.id)
    expect(store.listTasks()).toHaveLength(2)
    const py = taskOf(store, plan.id, 1)
    await store.completeTask(py, '2026-10-17')
    at('2026-10-18')
    await store.completeTask(py, '2026-10-18')
    // Its own rule holds, but the step before is not achieved: blocked, no unlock.
    expect(progressOf(store, plan, '2026-10-18').goals[1]?.status).toBe('blocked')
    expect(store.takePlanEvents().unlocked).toEqual([])

    // Redo the first step: both, then the plan, unlock.
    await store.completeTask(taskOf(store, plan.id, 0))
    expect(store.takePlanEvents().unlocked.map((e) => e.kind)).toEqual(['goal', 'goal', 'plan'])
    expect(store.listTasks()).toHaveLength(2)
  })
})

describe('Edits, restarts and old data', () => {
  it('editing the task (title, repeat rule) keeps the goal\'s progress', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('w', daily(3))]))
    const id = taskOf(store, plan.id, 0)
    await store.completeTask(id, '2026-10-16')
    at('2026-10-17')
    await store.updateTask(id, { title: 'Renamed' })
    await store.completeTask(id, '2026-10-17')
    expect(progressOf(store, plan, '2026-10-17').goals[0]).toMatchObject({ done: 2, status: 'active' })
  })

  it('survives a restart: same progress, same unlocks, no repeated notifications', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('a', { kind: 'once', due: null, onTime: false }), goal('b', daily(1))]))
    await store.completeTask(taskOf(store, plan.id, 0))
    await store.completeTask(taskOf(store, plan.id, 1), '2026-10-16')
    expect(store.takePlanEvents().unlocked).toHaveLength(3)
    await store.flush()

    at('2026-10-20')
    const reopened = await freshStore()
    expect(reopened.takePlanEvents()).toEqual({ unlocked: [], revoked: [] })
    expect(reopened.snapshot().plans).toEqual(store.snapshot().plans)
    expect(progressOf(reopened, plan, '2026-10-20').achieved).toBe(true)
    const data = JSON.parse(await readFile(path.join(dir, DATA_FILE_NAME), 'utf8'))
    expect(data.schemaVersion).toBe(5)
    expect(data.plans).toHaveLength(1)
  })

  it('deleting a plan keeps its tasks and their records', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(planInput([goal('a', { kind: 'once', due: null, onTime: false })]))
    const { event } = await store.completeTask(taskOf(store, plan.id, 0))
    const unlockIds = store.takePlanEvents().unlocked.map((e) => e.unlockId)
    expect(await store.deletePlan(plan.id)).toEqual(unlockIds)
    expect(store.snapshot().plans).toEqual([])
    expect(store.listTasks()).toHaveLength(1)
    expect(store.listCompletions().map((e) => e.id)).toEqual([event!.id])
  })

  it('opens a version 2 file unchanged and keeps a copy before writing the current version', async () => {
    const v2 = JSON.stringify({
      schemaVersion: 2,
      tasks: [
        {
          id: 't1', title: 'Old', description: '', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z',
          completedAt: '2026-10-02T08:00:00.000Z', status: 'completed', timerConfig: null, themeOverride: null,
          recurrence: null, recurrenceHistory: [], skippedOccurrences: [], due: null, reminderMinutes: null
        }
      ],
      completions: [{ id: 'e1', taskId: 't1', occurrence: null, completedAt: '2026-10-02T08:00:00.000Z', undoneAt: null, title: 'Old' }],
      settings: { language: 'zh-CN' }
    })
    await writeFile(path.join(dir, DATA_FILE_NAME), v2, 'utf8')
    const store = await freshStore()
    expect(store.loadReport).toMatchObject({ fromVersion: 2, migrated: true, createdCompletions: 0, droppedPlans: 0 })
    expect(store.snapshot()).toMatchObject({ plans: [], completions: [{ id: 'e1' }], tasks: [{ id: 't1', status: 'completed' }] })
    await store.createTask({ title: 'New', description: '', timerDurationSec: null, themeOverride: null })
    expect(await readFile(path.join(dir, backupFileName(2)), 'utf8')).toBe(v2)
    const data = JSON.parse(await readFile(path.join(dir, DATA_FILE_NAME), 'utf8'))
    expect(data).toMatchObject({ schemaVersion: 5, plans: [], settings: { language: 'zh-CN' } })
    expect(data.completions).toEqual(JSON.parse(v2).completions)
  })

  it('drops an unreadable plan but keeps the rest of the file', async () => {
    const store = await freshStore()
    await store.createPlan(planInput([goal('a', { kind: 'once', due: null, onTime: false })]))
    await store.flush()
    const file = path.join(dir, DATA_FILE_NAME)
    const data = JSON.parse(await readFile(file, 'utf8'))
    data.plans.push({ id: 'broken', goals: 'nope' })
    await copyFile(file, `${file}.orig`)
    await writeFile(file, JSON.stringify(data), 'utf8')
    const reopened = await freshStore()
    expect(reopened.snapshot().plans).toHaveLength(1)
    expect(reopened.loadReport?.droppedPlans).toBe(1)
    expect(reopened.listTasks()).toHaveLength(1)
  })

  it('target ids are goals or the plan', () => {
    expect(PLAN_TARGET).toBe('plan')
  })
})

describe('Validation of what the page sends', () => {
  const ok = planInput([goal('a', daily(5)), goal('b', { kind: 'once', due: null, onTime: false }, 'a')])

  it('accepts a confirmed plan', () => {
    expect(validatePlanInput(ok).goals).toHaveLength(2)
  })

  it('rejects chains that point forward, impossible counts and unknown fields', () => {
    const bad = (patch: (x: PlanInput) => unknown): void => {
      const copy = structuredClone(ok)
      patch(copy)
      expect(() => validatePlanInput(copy)).toThrow(ValidationError)
    }
    bad((x) => (x.goals[0]!.afterKey = 'b'))
    bad((x) => (x.goals[0]!.condition = daily(5, 6)))
    bad((x) => (x.goals[0]!.condition = { kind: 'weekly', startDate: null, weeks: 2, perWeek: 3, weekdays: [1, 2] }))
    bad((x) => (x.goals[0]!.condition = { kind: 'streak', startDate: null, days: 3, length: 4 }))
    bad((x) => ((x.goals[0]!.achievement as { icon: string }).icon = 'skull'))
    bad((x) => ((x as unknown as Record<string, unknown>).extra = 1))
    bad((x) => (x.goals = []))
    bad((x) => (x.goals[1]!.key = 'a'))
  })
})
