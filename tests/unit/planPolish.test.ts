import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildTrayMenu, type TrayActions } from '../../src/main/trayMenu'
import { DataStore } from '../../src/main/storage/dataStore'
import { DEFAULT_SETTINGS } from '../../src/shared/constants'
import { createTranslator } from '../../src/shared/i18n'
import { en } from '../../src/shared/i18n/en'
import { zhCN } from '../../src/shared/i18n/zh-CN'
import { COMPACT_NAME_MAX, shortDisplayName, taskDisplayName, truncateText } from '../../src/shared/planner/displayName'
import { draftReady, draftToInput, goalProblems } from '../../src/shared/planner/draft'
import { fieldHints } from '../../src/shared/planner/fieldHints'
import { evaluatePlan } from '../../src/shared/planner/progress'
import { parsePlanText } from '../../src/shared/planner/ruleParser'
import { findSimilarPlans, taskKey } from '../../src/shared/planner/similarity'
import type { DraftGoal, Plan, PlanInput } from '../../src/shared/planner/types'
import { validatePlanInput } from '../../src/shared/planner/validation'
import { withPlatform } from './platform'

/**
 * Phase 6.3: one task name on every surface, the duplicate plan check, field-level hints in the
 * wizard, and the slot states the segmented bar shows. Display and checks only: the stored data,
 * the windows and the unlock rules are those of Phase 6.1 / 6.2.
 */

const FRIDAY = '2026-10-16'
const parse = (text: string, today = FRIDAY) => parsePlanText(text, { today })
const zh = createTranslator('zh-CN')
const english = createTranslator('en')

let dir = ''
let clock = 0
let seq = 0
function at(hour: number, minute = 0, day = 16): void {
  clock = new Date(2026, 9, day, hour, minute).getTime()
}
async function freshStore(): Promise<DataStore> {
  const store = new DataStore({ directory: dir, now: () => new Date(clock), createId: () => `id-${++seq}` })
  await store.load()
  return store
}
const input = (text: string, today = FRIDAY): PlanInput => validatePlanInput(draftToInput(parse(text, today), today))
const planOf = (store: DataStore, id: string): Plan => store.snapshot().plans.find((p) => p.id === id) as Plan
const similar = (store: DataStore, text: string, today = FRIDAY) => {
  const snap = store.snapshot()
  return findSimilarPlans(input(text, today), snap.plans, snap.tasks, snap.completions, clock)
}
const BASE = { description: '', timerDurationSec: null, themeOverride: null }

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lu-plan-polish-'))
  seq = 0
  at(13, 24)
})

// ---------------------------------------------------------------------------------------------

describe('One task name on every surface', () => {
  it('a timed node reads "喝水 · 第2/4次" / "Drink water · 2 of 4"; the stored title stays "喝水 (2/4)"', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(input('接下来4个小时内每个小时都喝水'))
    const ids = planOf(store, plan.id).goals[0]!.nodeTaskIds
    const task = store.snapshot().tasks.find((t) => t.id === ids[1])!
    const before = JSON.stringify(task)
    expect(taskDisplayName(task, [plan], zh)).toEqual({ full: '喝水 · 第2/4次', name: '喝水', suffix: ' · 第2/4次' })
    expect(taskDisplayName(task, [plan], english)).toEqual({ full: '喝水 · 2 of 4', name: '喝水', suffix: ' · 2 of 4' })
    // Display only: nothing about the task changes.
    expect(JSON.stringify(task)).toBe(before)
    expect(task.title).toBe('喝水 (2/4)')
  })

  it('ordinary, repeating and one-window tasks keep their own names', async () => {
    const store = await freshStore()
    const plain = await store.createTask({ ...BASE, title: '买牛奶 (1/2)' })
    const daily = await store.createTask({ ...BASE, title: '背单词', recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: FRIDAY, endDate: null } })
    const one = await store.createPlan(input('2小时内完成作业'))
    const plans = store.snapshot().plans
    const single = store.snapshot().tasks.find((t) => t.id === planOf(store, one.id).goals[0]!.nodeTaskIds[0])!
    expect(taskDisplayName(plain, plans, zh)).toEqual({ full: '买牛奶 (1/2)', name: '买牛奶 (1/2)', suffix: '' })
    expect(taskDisplayName(daily, plans, zh).full).toBe('背单词')
    expect(taskDisplayName(single, plans, zh).full).toBe('完成作业')
  })

  it('a node whose plan was deleted still shows its position', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(input('接下来4个小时内每个小时都喝水'))
    await store.deletePlan(plan.id)
    const { tasks, plans } = store.snapshot()
    expect(tasks.map((t) => taskDisplayName(t, plans, zh).full)).toEqual(['喝水 · 第1/4次', '喝水 · 第2/4次', '喝水 · 第3/4次', '喝水 · 第4/4次'])
  })

  it('long names are shortened, but a node always keeps "· 第n/N次"; emoji are never cut in half', () => {
    expect(truncateText('短名字', 10)).toBe('短名字')
    expect(truncateText('一二三四五六七八九十十一', 6)).toBe('一二三四五…')
    expect(truncateText('喝水💧💧💧💧💧', 4)).toBe('喝水💧…')
    const long = '每天早上起床以后先喝一大杯温水然后再出门跑步锻炼身体'
    const short = shortDisplayName({ full: `${long} · 第2/4次`, name: long, suffix: ' · 第2/4次' }, 20)
    expect(short.endsWith('… · 第2/4次')).toBe(true)
    expect(Array.from(short).length).toBeLessThanOrEqual(20)
    const plain = 'A'.repeat(80)
    expect(shortDisplayName({ full: plain, name: plain, suffix: '' }, COMPACT_NAME_MAX)).toHaveLength(COMPACT_NAME_MAX)
    // Short names are untouched.
    expect(shortDisplayName({ full: '喝水 · 第2/4次', name: '喝水', suffix: ' · 第2/4次' }, COMPACT_NAME_MAX)).toBe('喝水 · 第2/4次')
  })

  it('the tray menu shows the names it is given and still escapes "&"; the click completes by task id', () => {
    const completed: string[] = []
    const actions = { completeTask: (id: string) => completed.push(id) } as unknown as TrayActions
    const today = [{ taskId: 'n2', occurrence: null, title: '喝水 & 吃药 · 第2/4次' }]
    const quick = (platform: NodeJS.Platform) =>
      withPlatform(platform, () => buildTrayMenu(DEFAULT_SETTINGS, zh, actions, today)).find((m) => m.id === 'quick-complete')!.submenu!
    const win = quick('win32')
    expect(win[0]).toMatchObject({ id: 'quick-complete:n2', label: '喝水 && 吃药 · 第2/4次' })
    win[0]!.click!()
    expect(completed).toEqual(['n2'])
    const mac = quick('darwin')
    expect(mac[0]).toMatchObject({ id: 'quick-complete:n2', label: '喝水 & 吃药 · 第2/4次' })
    mac[0]!.click!()
    expect(completed).toEqual(['n2', 'n2'])
  })
})

// ---------------------------------------------------------------------------------------------

describe('Duplicate plan check', () => {
  it('the same running timed plan is an exact duplicate, whatever it is called', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(input('接下来4个小时内每个小时都喝水'))
    at(14, 10)
    const matches = similar(store, '接下来4个小时内每个小时都喝水')
    expect(matches.map((m) => [m.plan.id, m.level])).toEqual([[plan.id, 'exact']])
    expect(matches[0]!.goals).toEqual([{ newIndex: 0, goalId: plan.goals[0]!.id, level: 'exact' }])
    // Wording, spaces and punctuation do not matter; the rule does.
    expect(similar(store, '未来四个小时每小时喝水')[0]?.level).toBe('exact')
    expect(similar(store, 'Drink water every hour for the next 4 hours')).toEqual([])
  })

  it('same task with other numbers or another kind overlapping in time is "similar"', async () => {
    const store = await freshStore()
    await store.createPlan(input('接下来4个小时内每个小时都喝水'))
    expect(similar(store, '接下来3小时每小时喝水').map((m) => m.level)).toEqual(['similar'])
    expect(similar(store, '每半小时喝水，持续2小时').map((m) => m.level)).toEqual(['similar'])
    expect(similar(store, '未来7天每天喝水').map((m) => m.level)).toEqual(['similar'])
  })

  it('the same plan name with other content is never a duplicate', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(input('接下来4个小时内每个小时都喝水'))
    const other = { ...input('未来7天每天健身'), title: plan.title }
    const snap = store.snapshot()
    expect(findSimilarPlans(other, snap.plans, snap.tasks, snap.completions, clock)).toEqual([])
  })

  it('a finished plan (all done, or failed by a missed slot) or a deleted plan is not flagged', async () => {
    // All four slots done: achieved.
    let store = await freshStore()
    const done = await store.createPlan(input('接下来4个小时内每个小时都喝水'))
    const ids = planOf(store, done.id).goals[0]!.nodeTaskIds
    for (const [i, h] of [[0, 13], [1, 14], [2, 15], [3, 16]] as const) {
      at(h, 30)
      await store.completeTask(ids[i]!)
    }
    expect(similar(store, '接下来4个小时内每个小时都喝水')).toEqual([])

    // A missed slot: the challenge failed, starting it again is fine.
    dir = await mkdtemp(path.join(tmpdir(), 'lu-plan-polish-'))
    at(13, 24)
    store = await freshStore()
    await store.createPlan(input('接下来4个小时内每个小时都喝水'))
    at(13, 50)
    expect(similar(store, '接下来4个小时内每个小时都喝水')[0]?.level).toBe('exact')
    // Slot 1 (13:24–14:24) closed without a completion.
    at(14, 40)
    expect(similar(store, '接下来4个小时内每个小时都喝水')).toEqual([])

    // Deleted: gone from the list.
    dir = await mkdtemp(path.join(tmpdir(), 'lu-plan-polish-'))
    at(13, 24)
    store = await freshStore()
    const removed = await store.createPlan(input('接下来4个小时内每个小时都喝水'))
    await store.deletePlan(removed.id)
    expect(similar(store, '接下来4个小时内每个小时都喝水')).toEqual([])

  })

  it('day plans: same rule from another start that does not overlap is not flagged; an overlapping one is', async () => {
    const store = await freshStore()
    await store.createPlan(input('未来7天每天健身'))
    expect(similar(store, '未来7天每天健身')[0]?.level).toBe('exact')
    // Starting on the 23rd: the first plan covers the 16th–22nd, no overlap.
    const later = { ...input('未来7天每天健身') }
    later.goals = later.goals.map((g) => (g.condition.kind === 'count' ? { ...g, condition: { ...g.condition, startDate: '2026-10-23' } } : g))
    const snap = store.snapshot()
    expect(findSimilarPlans(later, snap.plans, snap.tasks, snap.completions, clock)).toEqual([])
    // Starting on the 20th overlaps: still the same plan.
    const overlapping = { ...later, goals: later.goals.map((g) => (g.condition.kind === 'count' ? { ...g, condition: { ...g.condition, startDate: '2026-10-20' } } : g)) }
    expect(findSimilarPlans(overlapping, snap.plans, snap.tasks, snap.completions, clock)[0]?.level).toBe('exact')
  })

  it('part of a multi-goal plan is "similar", never "exact"; exact matches come first', async () => {
    const store = await freshStore()
    const big = await store.createPlan(input('未来30天每天背单词和每天跑步'))
    const small = await store.createPlan(input('未来30天每天背单词'))
    const matches = similar(store, '未来30天每天背单词')
    expect(matches.map((m) => [m.plan.id, m.level])).toEqual([
      [small.id, 'exact'],
      [big.id, 'similar']
    ])
  })

  it('task names are compared without case, spaces or punctuation', () => {
    expect(taskKey(' 喝 水。')).toBe(taskKey('喝水'))
    expect(taskKey('Drink  Water!')).toBe(taskKey('drink water'))
    expect(taskKey('喝水')).not.toBe(taskKey('喝茶'))
  })
})

// ---------------------------------------------------------------------------------------------

describe('Wizard hints next to the field', () => {
  const goalOf = (text: string): DraftGoal => parse(text).goals[0]!

  it('"每小时喝水": one hint, at "时段数"; the minutes field (60) is fine', () => {
    const goal = goalOf('每小时喝水')
    expect(fieldHints(goal, FRIDAY)).toEqual([{ field: 'slots', problem: 'missing-duration' }])
    expect(fieldHints({ ...goal, slots: 3 }, FRIDAY)).toEqual([])
  })

  it('slots too long in total point to "时段数"; a bad minutes value to its own field', () => {
    const goal = goalOf('每小时喝水')
    expect(fieldHints({ ...goal, slots: 49 }, FRIDAY)).toEqual([{ field: 'slots', problem: 'out-of-range' }])
    expect(fieldHints({ ...goal, slots: 40, intervalMinutes: 120 }, FRIDAY)).toEqual([{ field: 'slots', problem: 'out-of-range' }])
    expect(fieldHints({ ...goal, slots: 2, intervalMinutes: 5 }, FRIDAY)).toEqual([{ field: 'slotMinutes', problem: 'out-of-range' }])
  })

  it('day goals: each missing number at its own field', () => {
    expect(fieldHints(goalOf('每天背单词'), FRIDAY)).toEqual([
      { field: 'days', problem: 'missing-duration' },
      { field: 'required', problem: 'missing-count' }
    ])
    const weekly = { ...goalOf('每周健身3次，持续4周'), weekdays: [] as number[] }
    expect(fieldHints(weekly, FRIDAY).map((h) => h.field)).toContain('weekdays')
    const streak = { ...goalOf('连续21天早起'), days: 10 }
    expect(fieldHints(streak, FRIDAY)).toEqual([{ field: 'length', problem: 'inconsistent' }])
  })

  it('checks are not relaxed: a goal is importable exactly when it has no hint and nothing to confirm', () => {
    const samples = ['每小时喝水', '每天背单词', '每周健身3次', '连续21天早起', '接下来4个小时内每个小时都喝水', '未来7天每天健身', '周五之前完成数学作业', '本周完成3次数学复习']
    for (const text of samples) {
      for (const goal of parse(text).goals) {
        const hints = fieldHints(goal, FRIDAY)
        const problems = goalProblems(goal, FRIDAY).filter((p) => p !== 'unconfirmed')
        // Every problem found has a place next to a field.
        for (const p of problems) expect(hints.map((h) => h.problem), `${text}: ${p}`).toContain(p)
        expect(hints.length === 0 && goal.issues.length === 0, text).toBe(goalProblems(goal, FRIDAY).length === 0)
      }
    }
    expect(draftReady(parse('每小时喝水'), FRIDAY)).toBe(false)
  })

  it('every hint text exists in both languages', () => {
    for (const field of ['days', 'required', 'weeks', 'perWeek', 'weekdays', 'length', 'slots', 'slotMinutes'] as const) {
      expect(en[`wizard.hint.missing.${field}`]).toBeTruthy()
      expect(zhCN[`wizard.hint.missing.${field}`]).toBeTruthy()
    }
    for (const key of ['wizard.needs.missing', 'wizard.needs.range', 'wizard.needs.inconsistent', 'wizard.hint.range', 'wizard.hint.span'] as const) {
      expect(zhCN[key]).toContain('{')
      expect(en[key]).toContain('{')
    }
  })
})

// ---------------------------------------------------------------------------------------------

describe('Segment states follow the records and the clock (and a restart)', () => {
  it('done / open / upcoming / missed per slot, moving with the windows', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(input('接下来4个小时内每个小时都喝水'))
    const ids = planOf(store, plan.id).goals[0]!.nodeTaskIds
    const states = (s: DataStore) => {
      const snap = s.snapshot()
      return evaluatePlan(planOf(s, plan.id), snap.tasks, snap.completions, FRIDAY, clock).goals[0]!.nodes.map((n) => n.state)
    }
    expect(states(store)).toEqual(['open', 'upcoming', 'upcoming', 'upcoming'])
    await store.completeTask(ids[0]!)
    expect(states(store)).toEqual(['done', 'upcoming', 'upcoming', 'upcoming'])
    at(14, 30)
    expect(states(store)).toEqual(['done', 'open', 'upcoming', 'upcoming'])
    at(15, 30)
    expect(states(store)).toEqual(['done', 'missed', 'open', 'upcoming'])
    await store.flush()
    // A restart reads the same states from the file.
    const again = await freshStore()
    expect(states(again)).toEqual(['done', 'missed', 'open', 'upcoming'])
  })
})
