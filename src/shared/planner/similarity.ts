import { dayKey } from '../dates'
import { floorToMinute, MINUTE_MS } from '../timeWindow'
import type { CompletionEvent, Task } from '../types'
import { addDays } from './dateMath'
import { evaluatePlan, type GoalProgress } from './progress'
import type { GoalCondition, Plan, PlanGoal, PlanInput } from './types'

/**
 * Duplicate plan check (Phase 6.3), run in the wizard right before a plan is imported. Local only:
 * it reads the plans already in memory and never changes them.
 *
 * Plans are compared by what they ask for, never by their names:
 * - two goals are about the same thing when their task names match (ignoring case, spaces and
 *   punctuation) and their time ranges overlap;
 * - such a pair is "exact" when the rule matches too (kind, counts, lengths, interval, deadline),
 *   and "similar" otherwise;
 * - a plan is an exact duplicate when every new goal is an exact match and the two plans have the same
 *   number of goals; any other match makes it "similar".
 * Only goals still running count: achieved, failed (e.g. a missed slot), or broken (task deleted) goals
 * are finished, and a deleted plan is no longer there. So repeating a finished challenge, or the same
 * challenge for a later time range, is never flagged.
 */
export type PlanMatchLevel = 'exact' | 'similar'

export interface GoalMatch {
  /** Index of the goal in the new plan. */
  newIndex: number
  goalId: string
  level: PlanMatchLevel
}

export interface PlanMatch {
  plan: Plan
  level: PlanMatchLevel
  goals: GoalMatch[]
}

/** A span of time in ms ([start, end)); null when it is not known yet (a chain step that has not started). */
type Range = { start: number; end: number } | null

const FINISHED: ReadonlySet<GoalProgress['status']> = new Set(['achieved', 'failed', 'broken'])

/** Task names that mean the same: "喝 水。" = "喝水", "Drink water" = "drink-water". */
export function taskKey(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** Local midnight at the start of a day key, in ms. */
function dayStart(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).getTime()
}

/** [start of `first`, start of the day after `last`). */
function dayRange(first: string, last: string): Range {
  return { start: dayStart(first), end: dayStart(addDays(last, 1)) }
}

function overlaps(a: Range, b: Range): boolean {
  if (a === null || b === null) return true
  return a.start < b.end && b.start < a.end
}

export function sameRule(a: GoalCondition, b: GoalCondition): boolean {
  switch (a.kind) {
    case 'once':
      return b.kind === 'once' && a.due === b.due && (a.due === null || a.onTime === b.onTime)
    case 'count':
      return b.kind === 'count' && a.days === b.days && a.every === b.every && a.required === b.required
    case 'weekly':
      return (
        b.kind === 'weekly' &&
        a.weeks === b.weeks &&
        a.perWeek === b.perWeek &&
        JSON.stringify(a.weekdays ?? null) === JSON.stringify(b.weekdays ?? null)
      )
    case 'streak':
      return b.kind === 'streak' && a.days === b.days && a.length === b.length
    case 'interval':
      return b.kind === 'interval' && a.minutes === b.minutes && a.count === b.count
  }
}

/** When a goal of the new plan would run if imported at `now`. */
function newGoalRange(condition: GoalCondition, chained: boolean, now: number): Range {
  if (chained) return null
  const today = dayKey(new Date(now))
  switch (condition.kind) {
    case 'once':
      return { start: now, end: condition.due ? dayStart(addDays(condition.due, 1)) : Number.POSITIVE_INFINITY }
    case 'interval': {
      const start = floorToMinute(now)
      return { start, end: start + condition.minutes * condition.count * MINUTE_MS }
    }
    case 'weekly': {
      const start = condition.startDate ?? today
      return dayRange(start, addDays(start, condition.weeks * 7 - 1))
    }
    default: {
      const start = condition.startDate ?? today
      return dayRange(start, addDays(start, condition.days - 1))
    }
  }
}

/** When an existing goal runs (null while a chain step waits for the step before it). */
function existingGoalRange(goal: PlanGoal, progress: GoalProgress): Range {
  if (progress.status === 'waiting') return null
  if (progress.nodes.length > 0) {
    const first = progress.nodes[0]
    const last = progress.nodes[progress.nodes.length - 1]
    if (!first || !last) return null
    return { start: Date.parse(first.window.start), end: Date.parse(last.window.end) }
  }
  if (goal.condition.kind === 'once') {
    const start = goal.startedOn ? dayStart(goal.startedOn) : Number.NEGATIVE_INFINITY
    return { start, end: goal.condition.due ? dayStart(addDays(goal.condition.due, 1)) : Number.POSITIVE_INFINITY }
  }
  if (progress.windowStart && progress.windowEnd) return dayRange(progress.windowStart, progress.windowEnd)
  return null
}

/**
 * Plans the new one repeats or resembles, exact matches first, then newest first.
 * `now` is the moment the import would happen (interval windows start then).
 */
export function findSimilarPlans(
  input: PlanInput,
  plans: readonly Plan[],
  tasks: readonly Task[],
  completions: readonly CompletionEvent[],
  now: number
): PlanMatch[] {
  const today = dayKey(new Date(now))
  const newGoals = input.goals.map((goal) => ({
    key: taskKey(goal.title),
    condition: goal.condition,
    range: newGoalRange(goal.condition, goal.afterKey !== null, now)
  }))
  const matches: PlanMatch[] = []
  for (const plan of plans) {
    const progress = evaluatePlan(plan, tasks, completions, today, now)
    if (progress.achieved) continue
    const running = plan.goals
      .map((goal, i) => ({ goal, progress: progress.goals[i] as GoalProgress }))
      .filter(({ progress: p }) => p && !FINISHED.has(p.status))
      .map(({ goal, progress: p }) => ({ goal, key: taskKey(goal.title), range: existingGoalRange(goal, p) }))
    const used = new Set<string>()
    const goals: GoalMatch[] = []
    newGoals.forEach((candidate, newIndex) => {
      const same = running.filter((r) => !used.has(r.goal.id) && r.key === candidate.key && overlaps(r.range, candidate.range))
      const exact = same.find((r) => sameRule(r.goal.condition, candidate.condition))
      const hit = exact ?? same[0]
      if (!hit) return
      used.add(hit.goal.id)
      goals.push({ newIndex, goalId: hit.goal.id, level: exact ? 'exact' : 'similar' })
    })
    if (goals.length === 0) continue
    const exact = goals.length === newGoals.length && plan.goals.length === newGoals.length && goals.every((g) => g.level === 'exact')
    matches.push({ plan, level: exact ? 'exact' : 'similar', goals })
  }
  return matches.sort((a, b) => (a.level === b.level ? b.plan.createdAt.localeCompare(a.plan.createdAt) : a.level === 'exact' ? -1 : 1))
}
