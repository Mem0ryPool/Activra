import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DATA_FILE_NAME, DataStore } from '../../src/main/storage/dataStore'
import { en } from '../../src/shared/i18n/en'
import { zhCN } from '../../src/shared/i18n/zh-CN'
import { draftReady, draftToInput, goalProblems } from '../../src/shared/planner/draft'
import { goalNoun, neutralPlanTitle, suggestPlanTitle } from '../../src/shared/planner/naming'
import { planNodeLabel } from '../../src/shared/planner/nodeLabel'
import { evaluatePlan, intervalOverview } from '../../src/shared/planner/progress'
import { parsePlanText } from '../../src/shared/planner/ruleParser'
import { PLAN_TARGET, type Plan, type PlanInput } from '../../src/shared/planner/types'
import { validatePlanInput } from '../../src/shared/planner/validation'

/**
 * Phase 6.2: plan names from what the goals say, compact timed nodes ("喝水 · 第2/4次"), plan progress
 * at a glance, and plain feedback when the text leaves something out. Display and naming only: the
 * stored data and the unlock rules are those of Phase 6.1.
 */

const FRIDAY = '2026-10-16'
const MONDAY = '2026-10-12'
const parse = (text: string, today = FRIDAY) => parsePlanText(text, { today })

describe('Plan names', () => {
  it.each([
    ['接下来4个小时内每个小时都喝水', '4小时喝水挑战'],
    ['接下来的4个小时内每个小时都喝水', '4小时喝水挑战'],
    ['未来7天每天健身', '7天健身挑战'],
    ['本周完成3次数学复习', '本周数学复习计划'],
    ['本周每天学习30分钟', '本周学习计划'],
    ['连续21天早起', '连续21天早起挑战'],
    ['每周一三五跑步5公里，持续4周', '4周跑步计划'],
    ['30天内跑步10次', '30天跑步计划'],
    ['本月跑步10次', '本月跑步计划'],
    ['每半小时喝水，持续2小时', '2小时喝水挑战'],
    ['接下来90分钟每30分钟站起来活动', '90分钟站起来活动挑战'],
    ['这个月读完一本书', '读完一本书'],
    ['未来30天每天背单词和每天跑步', '30天背单词和跑步计划'],
    ['未来30天，每天背20个英语单词，每周健身3次，周五之前完成数学作业，然后学习Python基础。', '背英语单词等4项计划']
  ])('"%s" → %s', (text, name) => {
    for (const today of [FRIDAY, MONDAY]) expect(parse(text, today).title).toBe(name)
  })

  it.each([
    ['Drink water every hour for the next 4 hours', 'Drink water: 4-hour challenge'],
    ['Work out every day for the next 7 days', 'Work out: 7-day challenge'],
    ['Review math 3 times this week', "Review math: this week's plan"],
    ['Study 30 minutes every day this week', "Study 30 minutes: this week's plan"],
    ['Meditate 7 days in a row', 'Meditate: 7-day streak'],
    [
      'For the next 30 days, read 10 pages every day, work out 3 times a week, finish the math homework by Friday, then learn Python basics.',
      'Read 10 pages + 3 more goals'
    ]
  ])('"%s" → %s', (text, name) => {
    expect(parse(text).title).toBe(name)
  })

  it('"本周" is only used when the goal really ends this Sunday; "未来7天" stays "7天" even on a Monday', () => {
    expect(parse('未来7天每天健身', MONDAY).title).toBe('7天健身挑战')
    expect(parse('本周每天健身', MONDAY).title).toBe('本周健身计划')
  })

  it('never makes up a number: an incomplete rule names only the task, and nothing usable gives the neutral name', () => {
    // "每小时喝水" has no length: no "4小时" in the name, and the draft cannot be imported as it is.
    const hourly = parse('每小时喝水')
    expect(hourly.title).toBe('喝水计划')
    expect(hourly.title).not.toMatch(/\d/)
    expect(draftReady(hourly, FRIDAY)).toBe(false)
    expect(parse('drink water every hour').title).toBe('Drink water plan')
    expect(parse('每天背单词').title).toBe('背单词计划')
    // No goal, or a task too long to name the plan after.
    expect(suggestPlanTitle([], { language: 'zh', today: FRIDAY, sourceText: '' })).toBe('新计划')
    expect(suggestPlanTitle([], { language: 'en', today: FRIDAY, sourceText: '' })).toBe('New plan')
    const long = parse('未来7天每天整理书桌并且把所有的衣服都洗干净')
    expect(long.title).toBe('7天挑战')
    expect(neutralPlanTitle('zh')).toBe('新计划')
  })

  it('filling in the missing length gives the full name (the wizard re-suggests while the name is untouched)', () => {
    const draft = parse('每小时喝水')
    const filled = { ...draft.goals[0]!, slots: 4 }
    expect(suggestPlanTitle([filled], { language: 'zh', today: FRIDAY, sourceText: draft.sourceText })).toBe('4小时喝水挑战')
  })

  it('a name another plan already has gets a number instead of repeating', () => {
    const draft = parse('未来7天每天健身')
    const options = { language: 'zh' as const, today: FRIDAY, sourceText: draft.sourceText }
    expect(suggestPlanTitle(draft.goals, { ...options, taken: ['7天健身挑战'] })).toBe('7天健身挑战 2')
    expect(suggestPlanTitle(draft.goals, { ...options, taken: ['7天健身挑战', '7天健身挑战 2'] })).toBe('7天健身挑战 3')
    expect(suggestPlanTitle(draft.goals, { ...options, taken: ['别的计划'] })).toBe('7天健身挑战')
  })

  it('the task part leaves out amounts and a leading "完成"', () => {
    expect(goalNoun('背20个英语单词', 'zh')).toBe('背英语单词')
    expect(goalNoun('完成数学复习', 'zh')).toBe('数学复习')
    expect(goalNoun('跑步5公里', 'zh')).toBe('跑步')
    expect(goalNoun('喝水', 'zh')).toBe('喝水')
    expect(goalNoun('完成', 'zh')).toBe('完成')
    expect(goalNoun('read 10 pages', 'en')).toBe('Read 10 pages')
  })

  it('the name stays editable: an edited name is what gets imported', () => {
    const draft = parse('接下来4个小时内每个小时都喝水')
    expect(draftToInput({ ...draft, title: '  下午补水  ' }, FRIDAY).title).toBe('下午补水')
  })
})

describe('Plain feedback when something is missing', () => {
  it('"每小时喝水" asks for the length instead of guessing (no endless task)', () => {
    const goal = parse('每小时喝水').goals[0]!
    expect(goal).toMatchObject({ kind: 'interval', intervalMinutes: 60, slots: null })
    expect(goalProblems(goal, FRIDAY)).toEqual(['missing-duration'])
  })

  it('every field that can be missing has its own plain message in both languages (Phase 6.3: next to the field)', () => {
    for (const field of ['days', 'required', 'weeks', 'perWeek', 'weekdays', 'length', 'slots', 'slotMinutes']) {
      expect(en).toHaveProperty(`wizard.hint.missing.${field}`)
      expect(zhCN).toHaveProperty(`wizard.hint.missing.${field}`)
    }
    for (const p of ['title', 'date-past', 'unconfirmed']) {
      expect(en).toHaveProperty(`wizard.needs.p.${p}`)
      expect(zhCN).toHaveProperty(`wizard.needs.p.${p}`)
    }
    expect(zhCN['wizard.hint.missing.slots']).toContain('时段')
  })

  it('the clickable examples parse into ready plans with the names they show', () => {
    for (const dict of [zhCN, en]) {
      for (const example of ['water', 'fitness', 'study'] as const) {
        const text = dict[`wizard.example.${example}.text`]
        for (const today of [FRIDAY, MONDAY, '2026-10-18']) {
          const draft = parse(text, today)
          expect(draft.goals, text).toHaveLength(1)
          expect(draftReady(draft, today), `${text} on ${today}`).toBe(true)
        }
      }
    }
    expect(parse(zhCN['wizard.example.water.text']).title).toBe(zhCN['wizard.example.water.label'])
    expect(parse(zhCN['wizard.example.fitness.text']).title).toBe(zhCN['wizard.example.fitness.label'])
    expect(parse(zhCN['wizard.example.study.text']).title).toBe(zhCN['wizard.example.study.label'])
  })
})

// ---------------------------------------------------------------------------------------------
// Stored plans: labels and overview are computed from the real records

const BASE = { description: '', timerDurationSec: null, themeOverride: null }
let dir = ''
let clock = 0
let seq = 0
function at(hour: number, minute = 0): void {
  clock = new Date(2026, 9, 16, hour, minute).getTime()
}
async function freshStore(): Promise<DataStore> {
  const store = new DataStore({ directory: dir, now: () => new Date(clock), createId: () => `id-${++seq}` })
  await store.load()
  return store
}
const water = (): PlanInput => validatePlanInput(draftToInput(parse('接下来4个小时内每个小时都喝水'), FRIDAY))
const planOf = (store: DataStore, id: string): Plan => store.snapshot().plans.find((p) => p.id === id) as Plan
const overview = (store: DataStore, id: string) => {
  const snap = store.snapshot()
  return intervalOverview(evaluatePlan(planOf(store, id), snap.tasks, snap.completions, FRIDAY, clock).goals[0]!.nodes)
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lu-plan-ux-'))
  seq = 0
  at(13, 24)
})

describe('Timed nodes in task lists', () => {
  it('a node reads "喝水 · 2/4" from its plan; the stored title, description and window stay as they were', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(water())
    expect(plan.title).toBe('4小时喝水挑战')
    const tasks = store.snapshot().tasks
    const ids = planOf(store, plan.id).goals[0]!.nodeTaskIds
    const second = tasks.find((t) => t.id === ids[1])!
    expect(second.title).toBe('喝水 (2/4)')
    expect(second.description).toContain('4小时喝水挑战')
    expect(planNodeLabel(second, [plan])).toEqual({ name: '喝水', index: 2, count: 4, generatedDescription: true })
    // Saved data is unchanged in shape: still schema 4, one task per window.
    await store.flush()
    const file = JSON.parse(await readFile(path.join(dir, DATA_FILE_NAME), 'utf8')) as { schemaVersion: number; tasks: unknown[] }
    expect(file.schemaVersion).toBe(5)
    expect(file.tasks).toHaveLength(4)
  })

  it('a description the user typed is kept; a renamed node keeps its number', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(water())
    const id = planOf(store, plan.id).goals[0]!.nodeTaskIds[0]!
    await store.updateTask(id, { title: '喝一杯温水', description: '用保温杯' })
    const task = store.snapshot().tasks.find((t) => t.id === id)!
    expect(planNodeLabel(task, [plan])).toEqual({ name: '喝一杯温水', index: 1, count: 4, generatedDescription: false })
  })

  it('a node whose plan was deleted still shows its number; ordinary and repeating tasks get no label', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(water())
    await store.deletePlan(plan.id)
    const { tasks, plans } = store.snapshot()
    expect(plans).toEqual([])
    expect(tasks.map((t) => planNodeLabel(t, plans))).toEqual([1, 2, 3, 4].map((n) => ({ name: '喝水', index: n, count: 4, generatedDescription: false })))
    const plain = await store.createTask({ ...BASE, title: '买牛奶 (1/2)' })
    const daily = await store.createTask({ ...BASE, title: '背单词', recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: FRIDAY, endDate: null } })
    expect(planNodeLabel(plain, plans)).toBeNull()
    expect(planNodeLabel(daily, plans)).toBeNull()
  })
})

describe('Plan progress at a glance', () => {
  it('current slot, next start, missed count and done count follow the records and the clock', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(water())
    const ids = planOf(store, plan.id).goals[0]!.nodeTaskIds
    let o = overview(store, plan.id)
    expect(o).toMatchObject({ done: 0, total: 4, missed: 0 })
    expect(o.current?.index).toBe(0)
    expect(o.next?.index).toBe(1)
    await store.completeTask(ids[0]!)
    expect(overview(store, plan.id)).toMatchObject({ done: 1, missed: 0 })
    // Slot 2 passes without a completion: missed; slot 3 is open, slot 4 next.
    at(15, 30)
    o = overview(store, plan.id)
    expect(o).toMatchObject({ done: 1, missed: 1 })
    expect(o.current?.index).toBe(2)
    expect(o.next?.index).toBe(3)
    // After the last window: nothing open or next.
    at(17, 30)
    o = overview(store, plan.id)
    expect(o).toMatchObject({ current: null, next: null, missed: 3 })
  })

  it('the goal and "全成就！" unlock only with every slot done, and an undo withdraws them', async () => {
    const store = await freshStore()
    const plan = await store.createPlan(water())
    const ids = planOf(store, plan.id).goals[0]!.nodeTaskIds
    let last = null
    for (const [i, h] of [[0, 13], [1, 14], [2, 15], [3, 16]] as const) {
      at(h, 30)
      last = await store.completeTask(ids[i]!)
      const active = planOf(store, plan.id).unlocks.filter((u) => u.revokedAt === null).map((u) => u.target)
      expect(active, `after slot ${i + 1}`).toEqual(i < 3 ? [] : [plan.goals[0]!.id, PLAN_TARGET])
    }
    await store.undoCompletion(last!.event!.id)
    expect(planOf(store, plan.id).unlocks.filter((u) => u.revokedAt === null)).toEqual([])
    expect(overview(store, plan.id)).toMatchObject({ done: 3 })
    // Still inside the last window: it can be done again.
    expect((await store.completeTask(ids[3]!)).unlocked).toBe(true)
  })
})
