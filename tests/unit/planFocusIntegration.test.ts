import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataStore } from '../../src/main/storage/dataStore'
import { FOCUS_FILE_NAME, FocusStore } from '../../src/main/focus/focusStore'
import { savePlanFocus, startPlanFocus } from '../../src/main/focus/planFocus'
import { parsePlanText } from '../../src/shared/planner/ruleParser'
import { draftToInput } from '../../src/shared/planner/draft'
import { dayKey } from '../../src/shared/dates'
import { eligiblePlanTask, goalFocusProgress, originForTask } from '../../src/shared/focus/plan'
import { revivePlanTargets, validatePlanFocus, validatePlanFocusStart } from '../../src/shared/focus/validation'

const MIN = 60_000
async function setup(text = '先完成数学作业，然后学习Python基础。') {
  const directory = await mkdtemp(path.join(tmpdir(), 'activra-plan-focus-'))
  let now = new Date(2026, 9, 18, 10).getTime()
  const data = new DataStore({ directory, now: () => new Date(now) })
  await data.load()
  const plan = await data.createPlan(draftToInput(parsePlanText(text, { today: dayKey(new Date(now)) }), dayKey(new Date(now))))
  const focus = new FocusStore({ directory, now: () => now })
  await focus.load()
  const input = { planId: plan.id, goals: plan.goals.map(g => ({ goalId: g.id, sessions: 2 })) }
  const start = () => startPlanFocus(focus, { planId: plan.id, goalId: plan.goals[0]!.id, taskId: plan.goals[0]!.taskId! }, data.listPlans(), data.listTasks(), data.listCompletions(), now)
  return { directory, data, focus, plan, input, start, advance: (minutes: number) => { now += minutes * MIN }, now: () => now }
}

describe('plan focus budgets and execution', () => {
  it('resumes a legacy paused task-linked run without replacing its id', async () => {
    const f = await setup()
    await f.focus.start('focus', { id: f.plan.goals[0]!.taskId!, title: 'Legacy focus' })
    const id = f.focus.snapshot().state.run!.id
    await f.focus.pause(id)
    await f.start()
    expect(f.focus.snapshot().state.run).toMatchObject({ id })
    expect(f.focus.snapshot().state.run!.resumedAt).not.toBeNull()
  })
  it('confirms and replaces the separate budget without creating tasks or changing the approved plan', async () => {
    const f = await setup()
    const before = await readFile(f.data.filePath, 'utf8')
    await savePlanFocus(f.focus, f.input, f.data.listPlans())
    await Promise.all([savePlanFocus(f.focus, f.input, f.data.listPlans()), savePlanFocus(f.focus, f.input, f.data.listPlans())])
    expect(f.focus.snapshot().planTargets).toEqual([f.input])
    expect(await readFile(f.data.filePath, 'utf8')).toBe(before)
    expect(f.data.listTasks()).toHaveLength(1) // Waiting step has no task yet.
  })

  it('starts once under racing requests, keeps the origin, and never completes tasks or rewards', async () => {
    const f = await setup()
    const before = await readFile(f.data.filePath, 'utf8')
    const results = await Promise.all([f.start(), f.start()])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(f.focus.snapshot().state.run).toMatchObject({ origin: { planId: f.plan.id, goalId: f.plan.goals[0]!.id }, plannedSec: 1500 })
    f.advance(25)
    await Promise.all([f.focus.finishDue(), f.focus.finishDue()])
    const sessions = f.focus.snapshot().sessions
    expect(sessions).toHaveLength(1)
    expect(goalFocusProgress(f.plan.id, f.plan.goals[0]!, sessions, 2)).toEqual({ completed: 1, remaining: 1, focusedSec: 1500, interrupted: 0, lastOutcome: 'completed' })
    expect(await readFile(f.data.filePath, 'utf8')).toBe(before)
    expect(f.data.listCompletions()).toEqual([])
    expect(f.data.listPlans()[0]!.unlocks).toEqual([])
    expect(f.data.listTasks()).toHaveLength(1)
  })

  it('preserves focus settings, break cycle, selection and pending short breaks', async () => {
    const f = await setup()
    await f.focus.setDurations({ focusMin: 3, shortBreakMin: 2, longBreakMin: 7 })
    await f.start(); f.advance(3); await f.focus.finishDue()
    expect(f.focus.snapshot().state.nextPhase).toBe('short-break')
    await f.start()
    expect(f.focus.snapshot().state.run).toBeNull()
    expect(f.focus.snapshot().state.nextPhase).toBe('short-break')
    await f.focus.start('short-break', null); f.advance(2); await f.focus.finishDue()
    await f.start()
    expect(f.focus.snapshot().state.run?.plannedSec).toBe(180)
    expect(f.focus.snapshot().durations).toEqual({ focusMin: 3, shortBreakMin: 2, longBreakMin: 7 })
  })

  it('pauses and resumes the same run across restart; retains budgets and partial time', async () => {
    const f = await setup()
    await savePlanFocus(f.focus, f.input, f.data.listPlans())
    await f.start(); f.advance(4)
    const id = f.focus.snapshot().state.run!.id
    await f.focus.pause(id); f.advance(90)
    const reload = new FocusStore({ directory: f.directory, now: f.now })
    await reload.load()
    expect(reload.snapshot().planTargets).toEqual([f.input])
    expect(reload.snapshot().state.run).toMatchObject({ id, resumedAt: null, elapsedMs: 4 * MIN, origin: { planId: f.plan.id } })
    await startPlanFocus(reload, { planId: f.plan.id, goalId: f.plan.goals[0]!.id, taskId: f.plan.goals[0]!.taskId! }, f.data.listPlans(), f.data.listTasks(), [], f.now())
    expect(reload.snapshot().state.run!.id).toBe(id)
    f.advance(2); await reload.end(id)
    expect(goalFocusProgress(f.plan.id, f.plan.goals[0]!, reload.snapshot().sessions, 2)).toEqual({ completed: 0, remaining: 2, focusedSec: 360, interrupted: 1, lastOutcome: 'ended-early' })
    const again = new FocusStore({ directory: f.directory, now: f.now }); await again.load()
    expect(again.snapshot().sessions).toHaveLength(1)
  })

  it('does not replace another active timer or a paused break', async () => {
    const f = await setup()
    await f.focus.start('focus', null)
    const run = f.focus.snapshot().state.run!
    expect(() => f.start()).toThrow()
    expect(f.focus.snapshot().state.run!.id).toBe(run.id)
    await f.focus.reset(run.id)
    await f.focus.start('long-break', null)
    await f.focus.pause(f.focus.snapshot().state.run!.id)
    expect(() => f.start()).toThrow()
  })

  it('rejects waiting, changed, deleted, and completed plan steps in main', async () => {
    const f = await setup()
    const second = f.plan.goals[1]!
    expect(eligiblePlanTask(f.plan, second.id, f.data.listTasks(), [], f.now())).toBeNull()
    expect(() => startPlanFocus(f.focus, { planId: f.plan.id, goalId: second.id, taskId: f.plan.goals[0]!.taskId! }, [f.plan], f.data.listTasks(), [], f.now())).toThrow()
    await f.data.completeTask(f.plan.goals[0]!.taskId!)
    expect(() => f.start()).toThrow()
    const current = f.data.listPlans()[0]!
    expect(originForTask([current], current.goals[1]!.taskId!)).toEqual({ planId: current.id, goalId: second.id })
    await f.data.deletePlan(f.plan.id)
    expect(() => f.start()).toThrow()
    expect(() => savePlanFocus(f.focus, f.input, [])).toThrow()
  })

  it('validates bounds, duplicate goals and untrusted fields; keeps independent valid stored budgets', () => {
    const input = { planId: 'p1', goals: [{ goalId: 'g1', sessions: 2 }] }
    expect(validatePlanFocus(input)).toEqual(input)
    for (const sessions of [0, -1, 25, 1.5, Infinity]) expect(() => validatePlanFocus({ ...input, goals: [{ goalId: 'g1', sessions }] })).toThrow()
    expect(() => validatePlanFocus({ ...input, goals: [...input.goals, ...input.goals] })).toThrow()
    expect(() => validatePlanFocusStart({ planId: 'p1', goalId: 'g1', taskId: 't1', ignored: true })).toThrow()
    expect(revivePlanTargets([null, input, input])).toEqual([input])
  })

  it('counts legacy task history once, keeps explicit origins separated and clamps remaining', async () => {
    const f = await setup(); await f.start(); f.advance(25); await f.focus.finishDue()
    const record = f.focus.snapshot().sessions[0]!
    const legacy = { ...record, origin: undefined }
    expect(goalFocusProgress(f.plan.id, f.plan.goals[0]!, [legacy, legacy], 1)).toMatchObject({ completed: 1, remaining: 0, focusedSec: 1500 })
    expect(goalFocusProgress('different', f.plan.goals[0]!, [record], 1).completed).toBe(0)
    const again = new FocusStore({ directory: f.directory, now: f.now })
    const saved = JSON.parse(await readFile(path.join(f.directory, FOCUS_FILE_NAME), 'utf8'))
    saved.sessions.push(saved.sessions[0]); await writeFile(path.join(f.directory, FOCUS_FILE_NAME), JSON.stringify(saved))
    await again.load()
    expect(again.snapshot().sessions).toHaveLength(1)
  })

  it('interval steps must be inside their time window, not merely have a task id', async () => {
    const f = await setup('接下来4小时每小时喝水')
    expect(eligiblePlanTask(f.plan, f.plan.goals[0]!.id, f.data.listTasks(), [], f.now())).toBe(f.plan.goals[0]!.taskId)
    f.advance(240)
    expect(eligiblePlanTask(f.plan, f.plan.goals[0]!.id, f.data.listTasks(), [], f.now())).toBeNull()
  })
})
