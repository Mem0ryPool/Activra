import type { TodayItem } from '../taskOrder'
import type { Task } from '../types'
import { intervalOverview, type GoalProgress, type PlanProgress } from './progress'
import type { Plan, PlanGoal } from './types'

/**
 * What the Plans page shows as "what now" (Phase 6.5). Display only: everything here is read from
 * the progress `evaluatePlan` already computed and from "today" as the task list, widget and tray
 * see it (`selectTodayTasks`). Nothing here decides progress, unlocks or what may be completed.
 */

/** One goal against today. */
export interface GoalToday {
  /**
   * What can be completed for this goal right now (an open time slot, today's occurrence, the
   * one-off task still in progress), only while the goal is active; otherwise null.
   */
  completable: TodayItem | null
  /** A repeating goal while active: today's occurrence is done, still to do, or not scheduled. Null otherwise. */
  today: 'done' | 'todo' | 'off' | null
}

export function goalToday(goal: PlanGoal, progress: GoalProgress, items: readonly TodayItem[], tasks: readonly Task[]): GoalToday {
  const active = progress.status === 'active'
  if (progress.nodes.length > 0) {
    const ids = new Set(progress.nodes.map((n) => n.taskId).filter((id): id is string => !!id))
    const item = items.find((i) => !i.done && ids.has(i.task.id)) ?? null
    return { completable: active ? item : null, today: null }
  }
  const task = goal.taskId ? tasks.find((x) => x.id === goal.taskId) : undefined
  if (!task) return { completable: null, today: null }
  const item = items.find((i) => i.task.id === task.id) ?? null
  return {
    completable: active && item && !item.done ? item : null,
    today: active && task.recurrence ? (item ? (item.done ? 'done' : 'todo') : 'off') : null
  }
}

export type NextStep =
  | { kind: 'achieved' }
  | { kind: 'failed' }
  /** Can be completed now; `until` is when the chance ends (a slot's end), when it is a time slot. */
  | { kind: 'now'; goalId: string; item: TodayItem; until: string | null }
  /** Nothing to do now; the goal's next time slot starts then (ISO instant). */
  | { kind: 'slot'; goalId: string; start: string }
  /** Nothing to do now; the goal starts on that day (YYYY-MM-DD). */
  | { kind: 'starts'; goalId: string; date: string }
  /** Everything due today is done. */
  | { kind: 'doneToday' }
  /** The next goal waits for the one before it. */
  | { kind: 'after'; goalId: string; previousId: string }
  /** Nothing can be told reliably. */
  | { kind: 'neutral' }

/** Local midnight at the start of a YYYY-MM-DD day, `plus` days later. */
const localDay = (key: string, plus = 0): number => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d + plus).getTime()
}
const endOfDay = (key: string): number => localDay(key, 1)
const startOfDay = (key: string): number => localDay(key)

/** How soon the chance to complete this goal now runs out; the soonest goes first. */
function deadline(goal: PlanGoal, item: TodayItem): number {
  if (item.task.window) return Date.parse(item.task.window.end)
  if (item.occurrence) return endOfDay(item.occurrence)
  if (goal.condition.kind === 'once' && goal.condition.due) return endOfDay(goal.condition.due)
  return Number.POSITIVE_INFINITY
}

/**
 * The one next step of a plan, by fixed rules:
 * 1. achieved or failed plans say so;
 * 2. of the goals that can be completed now, the one whose chance ends first (a slot's end, the end
 *    of today for today's occurrence, a one-off goal's due date; no due date last; ties keep the
 *    plan's order);
 * 3. else a slot or goal starting later today;
 * 4. else, when today's occurrences are all done, "done for today";
 * 5. else the next slot or goal start on a later day;
 * 6. else a goal waiting for the step before it;
 * 7. else a neutral line.
 */
export function planNextStep(
  plan: Plan,
  progress: PlanProgress,
  items: readonly TodayItem[],
  tasks: readonly Task[],
  now: number,
  today: string
): NextStep {
  if (progress.achieved) return { kind: 'achieved' }
  if (progress.failed) return { kind: 'failed' }
  const goals = plan.goals.map((goal, index) => ({ goal, index, p: progress.goals[index] })).filter((g): g is { goal: PlanGoal; index: number; p: GoalProgress } => !!g.p)

  const ready = goals
    .map(({ goal, index, p }) => ({ goal, index, item: goalToday(goal, p, items, tasks).completable }))
    .filter((g): g is { goal: PlanGoal; index: number; item: TodayItem } => !!g.item)
    .sort((a, b) => deadline(a.goal, a.item) - deadline(b.goal, b.item) || a.index - b.index)
  const first = ready[0]
  if (first) return { kind: 'now', goalId: first.goal.id, item: first.item, until: first.item.task.window?.end ?? null }

  type Start = { at: number; step: NextStep }
  const starts: Start[] = []
  for (const { goal, p } of goals) {
    if (p.status === 'active' && p.nodes.length > 0) {
      const next = intervalOverview(p.nodes).next
      if (next) starts.push({ at: Date.parse(next.window.start), step: { kind: 'slot', goalId: goal.id, start: next.window.start } })
    } else if (p.status === 'upcoming' && p.windowStart) {
      starts.push({ at: startOfDay(p.windowStart), step: { kind: 'starts', goalId: goal.id, date: p.windowStart } })
    }
  }
  starts.sort((a, b) => a.at - b.at)
  const soonest = starts[0]
  if (soonest && soonest.at < endOfDay(today) && soonest.at >= now) return soonest.step
  if (goals.some(({ goal, p }) => goalToday(goal, p, items, tasks).today === 'done')) return { kind: 'doneToday' }
  if (soonest && soonest.at >= now) return soonest.step
  const waiting = goals.find(({ goal, p }) => p.status === 'waiting' && goal.after)
  if (waiting?.goal.after) return { kind: 'after', goalId: waiting.goal.id, previousId: waiting.goal.after }
  return { kind: 'neutral' }
}
