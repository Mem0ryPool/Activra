import { goalProblems, LIMITS, occurrencesIn, type GoalProblem } from './draft'
import type { DraftGoal } from './types'

/**
 * Where each problem of a draft goal is fixed (Phase 6.3): the preview shows a short summary at the
 * top ("目标 1「喝水」：缺少「时段数」") and the exact requirement once, next to the field it is about.
 * This only places the problems `goalProblems` already finds; it never adds, drops or relaxes a check,
 * so a goal with any problem still cannot be imported.
 */
export type DraftField =
  | 'title'
  | 'due'
  | 'start'
  | 'days'
  | 'required'
  | 'every'
  | 'weeks'
  | 'perWeek'
  | 'weekdays'
  | 'length'
  | 'slots'
  | 'slotMinutes'

export interface FieldHint {
  field: DraftField
  problem: Exclude<GoalProblem, 'unconfirmed'>
}

const isInt = (n: number | null): n is number => n !== null && Number.isInteger(n)
const outside = (n: number | null, min: number, max: number): boolean => n !== null && (!isInt(n) || n < min || n > max)

/** The fields of `goal` that need changing, in the order they appear in the form. */
export function fieldHints(goal: DraftGoal, today: string): FieldHint[] {
  const problems = new Set(goalProblems(goal, today))
  const hints: FieldHint[] = []
  const add = (field: DraftField, problem: FieldHint['problem']): void => {
    if (!hints.some((h) => h.field === field)) hints.push({ field, problem })
  }
  if (problems.has('title')) add('title', 'title')
  if (problems.has('date-past')) add(goal.kind === 'once' ? 'due' : 'start', 'date-past')
  switch (goal.kind) {
    case 'count':
      if (problems.has('missing-duration')) add('days', 'missing-duration')
      if (outside(goal.days, 1, LIMITS.days)) add('days', 'out-of-range')
      if (problems.has('missing-count')) add('required', 'missing-count')
      if (outside(goal.required, 1, Number.MAX_SAFE_INTEGER)) add('required', 'out-of-range')
      if (isInt(goal.days) && isInt(goal.required) && goal.required > occurrencesIn(goal.days, goal.every)) add('required', 'inconsistent')
      if (outside(goal.every, 1, LIMITS.every)) add('every', 'out-of-range')
      break
    case 'weekly':
      if (problems.has('missing-duration')) add('weeks', 'missing-duration')
      if (outside(goal.weeks, 1, LIMITS.weeks)) add('weeks', 'out-of-range')
      if (goal.perWeek === null) add('perWeek', 'missing-count')
      if (outside(goal.perWeek, 1, 7)) add('perWeek', 'out-of-range')
      if (goal.weekdays !== null && goal.weekdays.length === 0) add('weekdays', 'missing-count')
      if (goal.weekdays !== null && isInt(goal.perWeek) && goal.perWeek > goal.weekdays.length) add('perWeek', 'inconsistent')
      break
    case 'streak':
      if (problems.has('missing-count')) add('length', 'missing-count')
      if (outside(goal.required, 1, Number.MAX_SAFE_INTEGER)) add('length', 'out-of-range')
      if (problems.has('missing-duration')) add('days', 'missing-duration')
      if (outside(goal.days, 1, LIMITS.days)) add('days', 'out-of-range')
      if (isInt(goal.days) && isInt(goal.required) && goal.required > goal.days) add('length', 'inconsistent')
      break
    case 'interval': {
      const { min, max } = LIMITS.intervalMinutes
      if (goal.slots === null) add('slots', 'missing-duration')
      if (outside(goal.slots, 1, LIMITS.slots)) add('slots', 'out-of-range')
      if (goal.intervalMinutes === null) add('slotMinutes', 'missing-duration')
      if (outside(goal.intervalMinutes, min, max)) add('slotMinutes', 'out-of-range')
      // Too long in total (more than 48 hours): fewer slots fixes it.
      if (isInt(goal.slots) && isInt(goal.intervalMinutes) && goal.slots * goal.intervalMinutes > LIMITS.intervalSpanMinutes) add('slots', 'out-of-range')
      break
    }
    case 'once':
      break
  }
  // Anything `goalProblems` found that no field above took still gets a place (never silently dropped).
  for (const problem of problems) {
    if (problem === 'unconfirmed' || hints.some((h) => h.problem === problem)) continue
    add(problem === 'title' ? 'title' : goal.kind === 'once' ? 'due' : 'start', problem)
  }
  return hints
}

/** The allowed range of a number field, for "请填写 1–48 之间的数". */
export function fieldRange(field: DraftField): { min: number; max: number } | null {
  switch (field) {
    case 'days':
    case 'required':
    case 'length':
      return { min: 1, max: LIMITS.days }
    case 'every':
      return { min: 1, max: LIMITS.every }
    case 'weeks':
      return { min: 1, max: LIMITS.weeks }
    case 'perWeek':
      return { min: 1, max: 7 }
    case 'slots':
      return { min: 1, max: LIMITS.slots }
    case 'slotMinutes':
      return LIMITS.intervalMinutes
    default:
      return null
  }
}
