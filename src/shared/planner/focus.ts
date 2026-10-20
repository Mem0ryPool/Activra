import type { FocusSession } from '../focus/types'
import type { Plan } from './types'
import { focusSessionsForGoal } from '../focus/plan'

export interface PlanFocusSummary {
  focusedSec: number
  sessions: number
}

/**
 * Focus recorded against any task created by this plan. This is deliberately a read-only view over
 * the focus file: it never contributes to completion progress, unlocks or task state.
 */
export function planFocusSummary(plan: Plan, sessions: readonly FocusSession[]): PlanFocusSummary {
  const matching = new Map(plan.goals.flatMap(goal => focusSessionsForGoal(plan.id, goal, sessions)).map(session => [session.id, session]))
  let focusedSec = 0
  let count = 0
  for (const session of matching.values()) {
    focusedSec += session.focusedSec
    count += 1
  }
  return { focusedSec, sessions: count }
}
