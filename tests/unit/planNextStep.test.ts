import { describe, expect, it } from 'vitest'
import { goalToday, planNextStep } from '../../src/shared/planner/nextStep'
import type { GoalProgress, NodeProgress, PlanProgress } from '../../src/shared/planner/progress'
import type { Plan, PlanGoal } from '../../src/shared/planner/types'
import type { TodayItem } from '../../src/shared/taskOrder'
import type { Task } from '../../src/shared/types'

const TODAY = '2026-10-16'
const NOW = new Date(2026, 9, 16, 14, 30).getTime()
const at = (h: number, m = 0): string => new Date(2026, 9, 16, h, m).toISOString()

function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    createdAt: at(8),
    updatedAt: at(8),
    completedAt: null,
    status: 'active',
    timerConfig: null,
    themeOverride: null,
    recurrence: null,
    recurrenceHistory: [],
    skippedOccurrences: [],
    due: null,
    reminderMinutes: null,
    ...extra
  } as Task
}
const daily = { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: '2026-10-14', endDate: '2026-10-20' } as unknown as Task['recurrence']

function goal(id: string, condition: PlanGoal['condition'], taskId: string | null, after: string | null = null): PlanGoal {
  return {
    id,
    title: `Goal ${id}`,
    category: 'general',
    quantity: null,
    condition,
    after,
    taskId,
    startedOn: '2026-10-14',
    achievement: { name: id, description: id, icon: 'target', rarity: 'common' }
  } as PlanGoal
}
function progress(goalId: string, status: GoalProgress['status'], extra: Partial<GoalProgress> = {}): GoalProgress {
  return { goalId, status, done: 0, target: 1, achievedOn: null, windowStart: null, windowEnd: null, periods: [], nodes: [], ...extra }
}
function plan(goals: PlanGoal[]): Plan {
  return { id: 'p', title: 'Plan', sourceText: '', createdAt: at(8), updatedAt: at(8), goals, master: null, unlocks: [] } as unknown as Plan
}
function planProgress(goals: GoalProgress[], extra: Partial<PlanProgress> = {}): PlanProgress {
  return { goals, achieved: false, achievedOn: null, failed: false, achievedCount: goals.filter((g) => g.status === 'achieved').length, ...extra }
}
const item = (t: Task, occurrence: string | null = null, done = false): TodayItem => ({
  key: occurrence ? `${t.id}@${occurrence}` : t.id,
  task: t,
  occurrence,
  done,
  event: null
})
const once = { kind: 'once', due: null, onTime: false } as const
const count = { kind: 'count', startDate: '2026-10-14', days: 7, every: 1, required: 7 } as const

describe('goalToday', () => {
  it('a repeating goal: today done, to do, or not scheduled; Complete only while to do and active', () => {
    const words = task('words', { recurrence: daily })
    const g = goal('g', count, 'words')
    expect(goalToday(g, progress('g', 'active'), [item(words, TODAY)], [words])).toMatchObject({ today: 'todo', completable: { key: `words@${TODAY}` } })
    expect(goalToday(g, progress('g', 'active'), [item(words, TODAY, true)], [words])).toEqual({ today: 'done', completable: null })
    expect(goalToday(g, progress('g', 'active'), [], [words])).toEqual({ today: 'off', completable: null })
    // Not active (e.g. starts later): no today line, no button.
    expect(goalToday(g, progress('g', 'upcoming'), [item(words, TODAY)], [words])).toEqual({ today: null, completable: null })
  })

  it('a one-off goal has no today line; a deleted task offers nothing', () => {
    const essay = task('essay')
    expect(goalToday(goal('g', once, 'essay'), progress('g', 'active'), [item(essay)], [essay])).toMatchObject({ today: null, completable: { key: 'essay' } })
    expect(goalToday(goal('g', once, 'gone'), progress('g', 'broken'), [], [essay])).toEqual({ today: null, completable: null })
  })

  it('a timed goal offers only the slot open now', () => {
    const slot = task('water-2', { window: { start: at(14), end: at(15) } })
    const nodes: NodeProgress[] = [
      { index: 0, taskId: 'water-1', window: { start: at(13), end: at(14) }, state: 'done' },
      { index: 1, taskId: 'water-2', window: { start: at(14), end: at(15) }, state: 'open' }
    ]
    const g = goal('g', { kind: 'interval', start: at(13), minutes: 60, count: 2 }, null)
    expect(goalToday(g, progress('g', 'active', { nodes }), [item(slot)], [slot]).completable?.key).toBe('water-2')
    expect(goalToday(g, progress('g', 'active', { nodes }), [], [slot]).completable).toBeNull()
  })
})

describe('planNextStep', () => {
  it('says so when the plan is achieved or failed', () => {
    const g = goal('a', once, 'a')
    expect(planNextStep(plan([g]), planProgress([progress('a', 'achieved')], { achieved: true }), [], [], NOW, TODAY)).toEqual({ kind: 'achieved' })
    expect(planNextStep(plan([g]), planProgress([progress('a', 'failed')], { failed: true }), [], [], NOW, TODAY)).toEqual({ kind: 'failed' })
  })

  it('picks the goal whose chance ends first, not the first goal', () => {
    const essay = task('essay')
    const words = task('words', { recurrence: daily })
    const slot = task('water-2', { window: { start: at(14), end: at(15) } })
    const nodes: NodeProgress[] = [{ index: 0, taskId: 'water-2', window: { start: at(14), end: at(15) }, state: 'open' }]
    const p = plan([goal('essay', once, 'essay'), goal('words', count, 'words'), goal('water', { kind: 'interval', start: at(14), minutes: 60, count: 1 }, null)])
    const pp = planProgress([progress('essay', 'active'), progress('words', 'active'), progress('water', 'active', { nodes })])
    const items = [item(essay), item(words, TODAY), item(slot)]
    // The slot closes at 15:00, today's word day at midnight, the essay has no due date.
    expect(planNextStep(p, pp, items, [essay, words, slot], NOW, TODAY)).toMatchObject({ kind: 'now', goalId: 'water', until: at(15) })
    expect(planNextStep(p, pp, items.slice(0, 2), [essay, words, slot], NOW, TODAY)).toMatchObject({ kind: 'now', goalId: 'words', until: null })
    expect(planNextStep(p, pp, items.slice(0, 1), [essay, words, slot], NOW, TODAY)).toMatchObject({ kind: 'now', goalId: 'essay' })
  })

  it('a one-off goal with a due date comes before one without; equal chances keep the plan order', () => {
    const a = task('a')
    const b = task('b')
    const p = plan([goal('a', once, 'a'), goal('b', { kind: 'once', due: '2026-10-18', onTime: true }, 'b')])
    const pp = planProgress([progress('a', 'active'), progress('b', 'active')])
    expect(planNextStep(p, pp, [item(a), item(b)], [a, b], NOW, TODAY)).toMatchObject({ kind: 'now', goalId: 'b' })
    const q = plan([goal('a', once, 'a'), goal('b', once, 'b')])
    expect(planNextStep(q, pp, [item(a), item(b)], [a, b], NOW, TODAY)).toMatchObject({ kind: 'now', goalId: 'a' })
  })

  it('nothing to do now: a slot later today, then done for today, then later starts, then the chain, then neutral', () => {
    const words = task('words', { recurrence: daily })
    const nodes: NodeProgress[] = [
      { index: 0, taskId: 'w1', window: { start: at(13), end: at(14) }, state: 'done' },
      { index: 1, taskId: 'w2', window: { start: at(16), end: at(17) }, state: 'upcoming' }
    ]
    const interval = goal('water', { kind: 'interval', start: at(13), minutes: 60, count: 2 }, null)
    const day = goal('words', count, 'words')
    const later = goal('later', { ...count, startDate: '2026-10-20' }, 'later')
    const chained = goal('next', once, null, 'words')

    const withSlot = planNextStep(plan([day, interval]), planProgress([progress('words', 'active'), progress('water', 'active', { nodes })]), [item(words, TODAY, true)], [words], NOW, TODAY)
    expect(withSlot).toEqual({ kind: 'slot', goalId: 'water', start: at(16) })

    const doneToday = planNextStep(
      plan([day, later]),
      planProgress([progress('words', 'active'), progress('later', 'upcoming', { windowStart: '2026-10-20' })]),
      [item(words, TODAY, true)],
      [words],
      NOW,
      TODAY
    )
    expect(doneToday).toEqual({ kind: 'doneToday' })

    expect(planNextStep(plan([later]), planProgress([progress('later', 'upcoming', { windowStart: '2026-10-20' })]), [], [], NOW, TODAY)).toEqual({
      kind: 'starts',
      goalId: 'later',
      date: '2026-10-20'
    })
    expect(planNextStep(plan([day, chained]), planProgress([progress('words', 'blocked'), progress('next', 'waiting')]), [], [words], NOW, TODAY)).toEqual({
      kind: 'after',
      goalId: 'next',
      previousId: 'words'
    })
    expect(planNextStep(plan([day]), planProgress([progress('words', 'active')]), [], [words], NOW, TODAY)).toEqual({ kind: 'neutral' })
  })
})
