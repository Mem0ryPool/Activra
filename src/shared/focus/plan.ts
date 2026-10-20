import type { Plan, PlanGoal } from '../planner/types'
import type { CompletionEvent, Task } from '../types'
import { evaluatePlan } from '../planner/progress'
import { goalToday } from '../planner/nextStep'
import { selectTodayTasks } from '../taskOrder'
import { dayKey } from '../dates'
import type { FocusOrigin, FocusSession } from './types'

export function originForTask(plans: readonly Plan[], taskId: string): FocusOrigin | undefined {
  for (const plan of plans) {
    const goal = plan.goals.find(g => g.taskId === taskId || g.nodeTaskIds.includes(taskId))
    if (goal) return { planId: plan.id, goalId: goal.id }
  }
  return undefined
}

/** Re-evaluate in main at the click, not from stale renderer state. */
export function eligiblePlanTask(plan: Plan, goalId: string, tasks: readonly Task[], completions: readonly CompletionEvent[], now: number): string | null {
  const index = plan.goals.findIndex(g => g.id === goalId)
  if (index < 0) return null
  const progress = evaluatePlan(plan, tasks, completions, dayKey(new Date(now)), now)
  const items = selectTodayTasks(tasks, completions, now).items
  return goalToday(plan.goals[index]!, progress.goals[index]!, items, tasks).completable?.task.id ?? null
}

/** Shared association/filter for both plan summary and per-step budget: no duplicate accounting path. */
export function focusSessionsForGoal(planId: string, goal: PlanGoal, sessions: readonly FocusSession[]): FocusSession[] {
  const seen = new Set<string>()
  const taskIds = new Set([goal.taskId, ...goal.nodeTaskIds].filter(Boolean))
  return sessions.filter(session => {
    if (seen.has(session.id)) return false
    seen.add(session.id)
    return session.origin ? session.origin.planId === planId && session.origin.goalId === goal.id : taskIds.has(session.taskId)
  })
}

/** Includes legacy task-linked history. Explicit origins never leak across goals; ids count once. */
export function goalFocusProgress(planId: string, goal: PlanGoal, sessions: readonly FocusSession[], target: number): { completed: number; remaining: number; focusedSec: number; interrupted: number; lastOutcome: FocusSession['outcome'] | null } {
  let completed = 0, focusedSec = 0, interrupted = 0
  let last: FocusSession | undefined
  for (const session of focusSessionsForGoal(planId, goal, sessions)) {
    focusedSec += session.focusedSec
    if (!last || session.endedAt > last.endedAt) last = session
    if (session.outcome === 'completed') completed++
    else interrupted++
  }
  return { completed, remaining: Math.max(0, target - completed), focusedSec, interrupted, lastOutcome: last?.outcome ?? null }
}
