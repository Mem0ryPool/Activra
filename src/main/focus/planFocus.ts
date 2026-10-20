import type { Plan } from '../../shared/planner/types'
import type { CompletionEvent, Task } from '../../shared/types'
import { eligiblePlanTask } from '../../shared/focus/plan'
import type { PlanFocusInput, PlanFocusStart } from '../../shared/focus/types'
import { ValidationError } from '../../shared/validation'
import type { FocusStore } from './focusStore'

export function savePlanFocus(focus: FocusStore, input: PlanFocusInput, plans: readonly Plan[]): Promise<void> {
  const plan = plans.find(p => p.id === input.planId)
  if (!plan || input.goals.length !== plan.goals.length || input.goals.some(g => !plan.goals.some(goal => goal.id === g.goalId))) throw new ValidationError('Plan goals changed; review again')
  return focus.setPlanTargets(input)
}

/** Atomic run guard in FocusStore handles racing requests. Never replace a different run or skip a break. */
export function startPlanFocus(focus: FocusStore, input: PlanFocusStart, plans: readonly Plan[], tasks: readonly Task[], completions: readonly CompletionEvent[], now = Date.now(), taskName: (task: Task) => string = task => task.title): Promise<boolean> {
  const plan = plans.find(p => p.id === input.planId)
  if (!plan || eligiblePlanTask(plan, input.goalId, tasks, completions, now) !== input.taskId) throw new ValidationError('Plan step is not available now')
  const state = focus.snapshot().state
  if (state.run) {
    const run = state.run
    if (run.phase !== 'focus' || run.taskId !== input.taskId || (run.origin && (run.origin.planId !== input.planId || run.origin.goalId !== input.goalId))) throw new ValidationError('Another timer is active')
    return run.resumedAt === null ? focus.resume(run.id) : Promise.resolve(false)
  }
  if (state.nextPhase !== 'focus') return focus.select({ taskId: input.taskId })
  const task = tasks.find(t => t.id === input.taskId)!
  return focus.start('focus', { id: task.id, title: taskName(task) }, { planId: input.planId, goalId: input.goalId })
}
