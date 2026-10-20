import { normalizeRule, type RecurrenceRule } from '../recurrence'
import { TITLE_MAX_LENGTH } from '../constants'
import { intervalWindows } from '../timeWindow'
import type { CompletionEvent, Task, TaskDue, TaskWindow } from '../types'
import { addDays } from './dateMath'
import { evaluatePlan, type PlanProgress } from './progress'
import { PLAN_TARGET, type Plan, type PlanGoal, type PlanUnlock } from './types'

/**
 * Keeping stored unlock records in line with the rules (pure; the main process applies the result).
 * A target that meets its rule and has no current record gets a new one (and a notification); a
 * record whose rule no longer holds (an undo, a deleted task, an edit) is marked revoked. Nothing
 * here looks at the parser's output: only goal rules, tasks and completion records.
 */

export interface UnlockChanges {
  unlocks: PlanUnlock[]
  unlocked: PlanUnlock[]
  revoked: PlanUnlock[]
}

function active(unlocks: readonly PlanUnlock[], target: string): PlanUnlock | undefined {
  return unlocks.find((u) => u.target === target && u.revokedAt === null)
}

export function reconcileUnlocks(
  plan: Plan,
  progress: PlanProgress,
  nowIso: string,
  createId: () => string
): UnlockChanges {
  const unlocks = plan.unlocks.map((u) => ({ ...u }))
  const unlocked: PlanUnlock[] = []
  const revoked: PlanUnlock[] = []
  const targets: [string, boolean][] = progress.goals.map((g) => [g.goalId, g.status === 'achieved'])
  if (plan.master) targets.push([PLAN_TARGET, progress.achieved])
  for (const [target, achieved] of targets) {
    const current = active(unlocks, target)
    if (achieved && !current) {
      const record: PlanUnlock = { id: createId(), target, unlockedAt: nowIso, revokedAt: null }
      unlocks.push(record)
      unlocked.push(record)
    } else if (!achieved && current) {
      current.revokedAt = nowIso
      revoked.push(current)
    }
  }
  return { unlocks, unlocked, revoked }
}

/** Chain steps whose previous step is achieved and whose task has not been created yet. */
export function goalsToStart(plan: Plan, progress: PlanProgress): PlanGoal[] {
  const status = new Map(progress.goals.map((g) => [g.goalId, g.status]))
  return plan.goals.filter((g) => g.taskId === null && g.after !== null && status.get(g.after) === 'achieved')
}

/** The task a goal is measured on, as the task form would create it. */
export interface GoalTaskInput {
  title: string
  description: string
  recurrence: RecurrenceRule | null
  due: TaskDue | null
}

/** The description a goal's task gets when it is created: the plan's name and what the goal asks. */
export function goalTaskDescription(plan: Pick<Plan, 'title'>, goal: PlanGoal): string {
  return `${plan.title} · ${goal.achievement.description}`.slice(0, 1000)
}

/** The one-off tasks of an interval goal, one per window (the goal's start must be set). */
export function nodeTaskInputs(plan: Pick<Plan, 'title'>, goal: PlanGoal): (GoalTaskInput & { window: TaskWindow })[] {
  const c = goal.condition
  if (c.kind !== 'interval' || c.start === null) return []
  const description = goalTaskDescription(plan, goal)
  return intervalWindows(c.start, c.minutes, c.count).map((window, i) => ({
    // The node number keeps the tasks apart in every list; the window is shown next to it.
    title: c.count > 1 ? `${goal.title.slice(0, TITLE_MAX_LENGTH - 8)} (${i + 1}/${c.count})` : goal.title,
    description,
    recurrence: null,
    due: null,
    window
  }))
}

export function taskInputForGoal(plan: Pick<Plan, 'title'>, goal: PlanGoal, today: string): GoalTaskInput {
  const c = goal.condition
  const description = goalTaskDescription(plan, goal)
  if (c.kind === 'interval') throw new Error('Interval goals use nodeTaskInputs')
  if (c.kind === 'once') {
    return { title: goal.title, description, recurrence: null, due: c.due ? { date: c.due, time: null } : null }
  }
  const startDate = c.startDate ?? today
  const length = c.kind === 'weekly' ? c.weeks * 7 : c.days
  const endDate = addDays(startDate, length - 1)
  let rule: RecurrenceRule
  if (c.kind === 'weekly' && c.weekdays) {
    rule = { preset: 'custom', unit: 'week', interval: 1, weekdays: [...c.weekdays], startDate, endDate }
  } else if (c.kind === 'count' && c.every > 1) {
    rule = { preset: 'custom', unit: 'day', interval: c.every, weekdays: [], startDate, endDate }
  } else {
    // Daily goals, streaks, and per-week counts without fixed weekdays (any day may be the day).
    rule = { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate, endDate }
  }
  return { title: goal.title, description, recurrence: normalizeRule(rule), due: null }
}

/** Task ids of goals that may be done on any day of the week (their unticked days are not "missed"). */
export function flexibleTaskIds(plans: readonly Plan[]): Set<string> {
  const ids = new Set<string>()
  for (const plan of plans) {
    for (const goal of plan.goals) {
      const c = goal.condition
      const flexible = (c.kind === 'weekly' && c.weekdays === null) || (c.kind === 'count' && c.every === 1 && c.required < c.days)
      if (flexible && goal.taskId) ids.add(goal.taskId)
    }
  }
  return ids
}

export function evaluateAll(
  plans: readonly Plan[],
  tasks: readonly Task[],
  completions: readonly CompletionEvent[],
  today: string,
  now: number
): Map<string, PlanProgress> {
  return new Map(plans.map((p) => [p.id, evaluatePlan(p, tasks, completions, today, now)]))
}

/** Records that currently count (shown on the Achievements page). */
export function activeUnlocks(plan: Plan): PlanUnlock[] {
  return plan.unlocks.filter((u) => u.revokedAt === null)
}
