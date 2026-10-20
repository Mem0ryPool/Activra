import { generateAchievement, generateMasterAchievement, masterEligible, type PlanLanguage } from './achievements'
import { addDays } from './dateMath'
import type { DraftGoal, GoalCondition, PlanDraft, PlanInput } from './types'

/**
 * Turning a (possibly edited) draft into a plan input. A draft goal can only be imported once every
 * number its rule needs is filled in, every number fits, and every guess was confirmed.
 */

export const LIMITS = {
  goals: 20,
  days: 366,
  weeks: 52,
  every: 30,
  /** Interval goals: minutes per window, number of windows, and how far ahead they may reach. */
  intervalMinutes: { min: 10, max: 1440 },
  slots: 48,
  intervalSpanMinutes: 48 * 60,
  titleLength: 120,
  nameLength: 60,
  descriptionLength: 300,
  sourceLength: 2000
} as const

export type GoalProblem =
  | 'title'
  | 'missing-duration'
  | 'missing-count'
  | 'date-past'
  | 'inconsistent'
  | 'out-of-range'
  | 'unconfirmed'

const isInt = (n: number | null): n is number => n !== null && Number.isInteger(n)

/** The rule the draft describes, or null while something it needs is missing. */
export function draftCondition(goal: DraftGoal): GoalCondition | null {
  switch (goal.kind) {
    case 'once':
      return { kind: 'once', due: goal.due, onTime: goal.onTime && goal.due !== null }
    case 'count':
      if (!isInt(goal.days) || !isInt(goal.required)) return null
      return { kind: 'count', startDate: goal.startDate, days: goal.days, every: goal.every, required: goal.required }
    case 'weekly':
      if (!isInt(goal.weeks) || !isInt(goal.perWeek)) return null
      return { kind: 'weekly', startDate: goal.startDate, weeks: goal.weeks, perWeek: goal.perWeek, weekdays: goal.weekdays }
    case 'streak':
      if (!isInt(goal.days) || !isInt(goal.required)) return null
      return { kind: 'streak', startDate: goal.startDate, days: goal.days, length: goal.required }
    case 'interval':
      if (!isInt(goal.intervalMinutes) || !isInt(goal.slots)) return null
      // The windows are placed when the plan is confirmed (or the step before is achieved), never here.
      return { kind: 'interval', start: null, minutes: goal.intervalMinutes, count: goal.slots }
  }
}

/** How many days a count goal's task occurs on in its window. */
export function occurrencesIn(days: number, every: number): number {
  return Math.ceil(days / every)
}

/** What still stops this goal from being imported (empty when it is ready). */
export function goalProblems(goal: DraftGoal, today: string): GoalProblem[] {
  const problems = new Set<GoalProblem>()
  if (!goal.title.trim() || goal.title.trim().length > LIMITS.titleLength) problems.add('title')
  if (goal.issues.length > 0) problems.add('unconfirmed')
  const start = goal.startDate
  if (start !== null && start < today && !goal.afterPrevious) problems.add('date-past')
  switch (goal.kind) {
    case 'once':
      if (goal.due !== null && goal.due < today) problems.add('date-past')
      break
    case 'count':
      if (goal.days === null) problems.add('missing-duration')
      if (goal.required === null) problems.add('missing-count')
      if (goal.days !== null && (!isInt(goal.days) || goal.days < 1 || goal.days > LIMITS.days)) problems.add('out-of-range')
      if (!isInt(goal.every) || goal.every < 1 || goal.every > LIMITS.every) problems.add('out-of-range')
      if (goal.required !== null && (!isInt(goal.required) || goal.required < 1)) problems.add('out-of-range')
      if (isInt(goal.days) && isInt(goal.required) && goal.required > occurrencesIn(goal.days, goal.every)) problems.add('inconsistent')
      break
    case 'weekly':
      if (goal.weeks === null) problems.add('missing-duration')
      if (goal.perWeek === null) problems.add('missing-count')
      if (goal.weeks !== null && (!isInt(goal.weeks) || goal.weeks < 1 || goal.weeks > LIMITS.weeks)) problems.add('out-of-range')
      if (goal.perWeek !== null && (!isInt(goal.perWeek) || goal.perWeek < 1 || goal.perWeek > 7)) problems.add('out-of-range')
      if (goal.weekdays !== null && goal.weekdays.length === 0) problems.add('missing-count')
      if (goal.weekdays !== null && isInt(goal.perWeek) && goal.perWeek > goal.weekdays.length) problems.add('inconsistent')
      break
    case 'streak':
      if (goal.required === null) problems.add('missing-count')
      if (goal.days === null) problems.add('missing-duration')
      if (goal.days !== null && (!isInt(goal.days) || goal.days < 1 || goal.days > LIMITS.days)) problems.add('out-of-range')
      if (goal.required !== null && (!isInt(goal.required) || goal.required < 1)) problems.add('out-of-range')
      if (isInt(goal.days) && isInt(goal.required) && goal.required > goal.days) problems.add('inconsistent')
      break
    case 'interval': {
      const { min, max } = LIMITS.intervalMinutes
      if (goal.slots === null || goal.intervalMinutes === null) problems.add('missing-duration')
      if (goal.intervalMinutes !== null && (!isInt(goal.intervalMinutes) || goal.intervalMinutes < min || goal.intervalMinutes > max)) problems.add('out-of-range')
      if (goal.slots !== null && (!isInt(goal.slots) || goal.slots < 1 || goal.slots > LIMITS.slots)) problems.add('out-of-range')
      if (isInt(goal.slots) && isInt(goal.intervalMinutes) && goal.slots * goal.intervalMinutes > LIMITS.intervalSpanMinutes) problems.add('out-of-range')
      break
    }
  }
  return [...problems]
}

/** Last day of a repeating goal's window, given its start. */
export function draftWindowEnd(goal: DraftGoal, today: string): string | null {
  const start = goal.startDate ?? today
  if (goal.kind === 'weekly') return goal.weeks ? addDays(start, goal.weeks * 7 - 1) : null
  if (goal.kind === 'count' || goal.kind === 'streak') return goal.days ? addDays(start, goal.days - 1) : null
  return goal.due
}

/** Regenerates a goal's achievement after its rule or title changed (keeps names the user typed). */
export function refreshAchievement(goal: DraftGoal, language: PlanLanguage, keepName: boolean): DraftGoal {
  const condition = draftCondition(goal)
  if (!condition) return goal
  const generated = generateAchievement(goal.title, goal.category, condition, language)
  return {
    ...goal,
    achievement: keepName ? { ...generated, name: goal.achievement.name || generated.name } : generated
  }
}

/** Whether the draft's goals get an "All achievements!" (two goals, or one goal of two or more windows). */
export function draftMasterEligible(goals: readonly DraftGoal[]): boolean {
  return masterEligible(goals.map((g) => (g.kind === 'interval' ? { kind: 'interval', start: null, minutes: 1, count: g.slots ?? 0 } : draftCondition(g))))
}

/** The "All achievements!" achievement for these goals, or null when the plan does not get one. */
export function masterForGoals(goals: readonly DraftGoal[], language: PlanLanguage): PlanDraft['master'] {
  if (!draftMasterEligible(goals)) return null
  const only = goals.length === 1 ? goals[0] : undefined
  return generateMasterAchievement(
    goals.map((g) => g.achievement.rarity),
    goals.length,
    language,
    only?.kind === 'interval' ? only.slots : null
  )
}

/** The "All achievements!" achievement for the current goals (null when not eligible or turned off). */
export function refreshMaster(draft: PlanDraft, enabled: boolean): PlanDraft {
  if (!enabled) return { ...draft, master: null }
  return { ...draft, master: masterForGoals(draft.goals, draft.language) }
}

export function draftReady(draft: PlanDraft, today: string): boolean {
  return draft.goals.length > 0 && draft.title.trim().length > 0 && draft.goals.every((g) => goalProblems(g, today).length === 0)
}

/** The validated input sent to the main process. Throws if the draft is not ready. */
export function draftToInput(draft: PlanDraft, today: string): PlanInput {
  if (!draftReady(draft, today)) throw new Error('Plan draft is not ready')
  return {
    title: draft.title.trim(),
    sourceText: draft.sourceText.slice(0, LIMITS.sourceLength),
    goals: draft.goals.map((goal, index) => ({
      key: goal.key,
      title: goal.title.trim(),
      category: goal.category,
      quantity: goal.quantity,
      condition: draftCondition(goal) as GoalCondition,
      afterKey: goal.afterPrevious && index > 0 ? (draft.goals[index - 1] as DraftGoal).key : null,
      achievement: { ...goal.achievement, name: goal.achievement.name.trim(), description: goal.achievement.description.trim() }
    })),
    master: draftMasterEligible(draft.goals) ? draft.master : null
  }
}
