import { isDateKey } from '../dates'
import { ValidationError } from '../validation'
import { masterEligible } from './achievements'
import { LIMITS, occurrencesIn } from './draft'
import {
  GOAL_CATEGORIES,
  PLAN_ICONS,
  PLAN_TARGET,
  RARITIES,
  type AchievementSpec,
  type GoalCondition,
  type Plan,
  type PlanGoal,
  type PlanGoalInput,
  type PlanInput,
  type PlanUnlock,
  type Quantity
} from './types'

/** Checks for plan data crossing IPC (`validatePlanInput`) and read back from disk (`revivePlan`). */

const KEY = /^[A-Za-z0-9_-]{1,64}$/

const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function only(value: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new ValidationError(`${what}: unexpected field "${key}"`)
}

function text(value: unknown, max: number, what: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new ValidationError(`${what} must be a string`)
  const t = value.trim()
  if (!allowEmpty && !t) throw new ValidationError(`${what} is required`)
  if (t.length > max) throw new ValidationError(`${what} is too long`)
  return t
}

function int(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${what} must be a whole number from ${min} to ${max}`)
  }
  return value
}

function dateOrNull(value: unknown, what: string): string | null {
  if (value === null) return null
  if (!isDateKey(value)) throw new ValidationError(`${what} must be a date`)
  return value
}

function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
  if (!(options as readonly unknown[]).includes(value)) throw new ValidationError(`Unknown ${what}`)
  return value as T
}

export function validateAchievementSpec(value: unknown): AchievementSpec {
  if (!isRecord(value)) throw new ValidationError('Achievement must be an object')
  only(value, ['name', 'description', 'icon', 'rarity'], 'Achievement')
  return {
    name: text(value.name, LIMITS.nameLength, 'Achievement name'),
    description: text(value.description, LIMITS.descriptionLength, 'Achievement description', true),
    icon: oneOf(value.icon, PLAN_ICONS, 'icon'),
    rarity: oneOf(value.rarity, RARITIES, 'rarity')
  }
}

function validateQuantity(value: unknown): Quantity | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw new ValidationError('Quantity must be an object')
  only(value, ['amount', 'unit'], 'Quantity')
  if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0 || value.amount > 1e6) {
    throw new ValidationError('Quantity amount is invalid')
  }
  return { amount: value.amount, unit: text(value.unit, 20, 'Quantity unit') }
}

export function validateCondition(value: unknown): GoalCondition {
  if (!isRecord(value)) throw new ValidationError('Condition must be an object')
  switch (value.kind) {
    case 'once': {
      only(value, ['kind', 'due', 'onTime'], 'Condition')
      const due = dateOrNull(value.due, 'Deadline')
      if (typeof value.onTime !== 'boolean') throw new ValidationError('onTime must be a boolean')
      return { kind: 'once', due, onTime: value.onTime && due !== null }
    }
    case 'count': {
      only(value, ['kind', 'startDate', 'days', 'every', 'required'], 'Condition')
      const days = int(value.days, 1, LIMITS.days, 'days')
      const every = int(value.every, 1, LIMITS.every, 'every')
      const required = int(value.required, 1, occurrencesIn(days, every), 'required')
      return { kind: 'count', startDate: dateOrNull(value.startDate, 'Start'), days, every, required }
    }
    case 'weekly': {
      only(value, ['kind', 'startDate', 'weeks', 'perWeek', 'weekdays'], 'Condition')
      let weekdays: number[] | null = null
      if (value.weekdays !== null) {
        if (!Array.isArray(value.weekdays) || value.weekdays.length === 0) throw new ValidationError('weekdays must be a list')
        weekdays = [...new Set(value.weekdays.map((d) => int(d, 0, 6, 'weekday')))].sort((a, b) => a - b)
      }
      return {
        kind: 'weekly',
        startDate: dateOrNull(value.startDate, 'Start'),
        weeks: int(value.weeks, 1, LIMITS.weeks, 'weeks'),
        perWeek: int(value.perWeek, 1, weekdays ? weekdays.length : 7, 'perWeek'),
        weekdays
      }
    }
    case 'streak': {
      only(value, ['kind', 'startDate', 'days', 'length'], 'Condition')
      const days = int(value.days, 1, LIMITS.days, 'days')
      return { kind: 'streak', startDate: dateOrNull(value.startDate, 'Start'), days, length: int(value.length, 1, days, 'length') }
    }
    case 'interval': {
      only(value, ['kind', 'start', 'minutes', 'count'], 'Condition')
      const minutes = int(value.minutes, LIMITS.intervalMinutes.min, LIMITS.intervalMinutes.max, 'minutes')
      const count = int(value.count, 1, Math.min(LIMITS.slots, Math.floor(LIMITS.intervalSpanMinutes / minutes)), 'count')
      let start: string | null = null
      if (value.start !== null) {
        if (!isIso(value.start)) throw new ValidationError('Start must be a time')
        start = new Date(value.start).toISOString()
      }
      return { kind: 'interval', start, minutes, count }
    }
    default:
      throw new ValidationError('Unknown goal kind')
  }
}

/** A new goal's rule. Interval windows are placed by the main process when the goal starts, never by the page. */
function inputCondition(value: unknown): GoalCondition {
  const condition = validateCondition(value)
  if (condition.kind === 'interval' && condition.start !== null) throw new ValidationError('An interval goal starts when it is confirmed')
  return condition
}

function validateGoalInput(value: unknown, earlierKeys: Set<string>): PlanGoalInput {
  if (!isRecord(value)) throw new ValidationError('Goal must be an object')
  only(value, ['key', 'title', 'category', 'quantity', 'condition', 'afterKey', 'achievement'], 'Goal')
  if (typeof value.key !== 'string' || !KEY.test(value.key) || earlierKeys.has(value.key)) throw new ValidationError('Invalid goal key')
  // A step can only follow a goal listed before it, so chains never loop.
  if (value.afterKey !== null && (typeof value.afterKey !== 'string' || !earlierKeys.has(value.afterKey))) {
    throw new ValidationError('A goal can only follow an earlier goal')
  }
  return {
    key: value.key,
    title: text(value.title, LIMITS.titleLength, 'Goal title'),
    category: oneOf(value.category, GOAL_CATEGORIES, 'category'),
    quantity: validateQuantity(value.quantity),
    condition: inputCondition(value.condition),
    afterKey: value.afterKey,
    achievement: validateAchievementSpec(value.achievement)
  }
}

export function validatePlanInput(value: unknown): PlanInput {
  if (!isRecord(value)) throw new ValidationError('Plan must be an object')
  only(value, ['title', 'sourceText', 'goals', 'master'], 'Plan')
  if (!Array.isArray(value.goals) || value.goals.length === 0 || value.goals.length > LIMITS.goals) {
    throw new ValidationError(`A plan needs 1 to ${LIMITS.goals} goals`)
  }
  const keys = new Set<string>()
  const goals = value.goals.map((g) => {
    const goal = validateGoalInput(g, keys)
    keys.add(goal.key)
    return goal
  })
  return {
    title: text(value.title, LIMITS.titleLength, 'Plan title'),
    sourceText: text(value.sourceText, LIMITS.sourceLength, 'Plan text', true),
    goals,
    master: value.master === null || !masterEligible(goals.map((g) => g.condition)) ? null : validateAchievementSpec(value.master)
  }
}

function reviveUnlock(raw: unknown): PlanUnlock | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.target !== 'string' || !isIso(raw.unlockedAt)) return null
  return { id: raw.id, target: raw.target, unlockedAt: raw.unlockedAt, revokedAt: isIso(raw.revokedAt) ? raw.revokedAt : null }
}

/** A plan read back from disk, or null if it is malformed (the caller logs and drops it). */
export function revivePlan(raw: unknown): Plan | null {
  try {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || !isIso(raw.createdAt) || !Array.isArray(raw.goals)) return null
    const ids = new Set<string>()
    const goals: PlanGoal[] = []
    for (const g of raw.goals) {
      if (!isRecord(g) || typeof g.id !== 'string' || !g.id || ids.has(g.id)) return null
      const after = g.after === null || g.after === undefined ? null : g.after
      if (after !== null && (typeof after !== 'string' || !ids.has(after))) return null
      goals.push({
        id: g.id,
        title: text(g.title, LIMITS.titleLength, 'Goal title'),
        category: oneOf(g.category, GOAL_CATEGORIES, 'category'),
        quantity: validateQuantity(g.quantity),
        condition: validateCondition(g.condition),
        after,
        taskId: typeof g.taskId === 'string' && g.taskId ? g.taskId : null,
        // Absent before Phase 6.1 (schema 3): no goal had node tasks.
        nodeTaskIds: Array.isArray(g.nodeTaskIds) ? g.nodeTaskIds.filter((id): id is string => typeof id === 'string' && !!id) : [],
        startedOn: isDateKey(g.startedOn) ? g.startedOn : null,
        achievement: validateAchievementSpec(g.achievement)
      })
      ids.add(g.id)
    }
    if (goals.length === 0) return null
    const targets = new Set([...ids, PLAN_TARGET])
    const unlocks = (Array.isArray(raw.unlocks) ? raw.unlocks : [])
      .map(reviveUnlock)
      .filter((u): u is PlanUnlock => u !== null && targets.has(u.target))
    return {
      id: raw.id,
      title: text(raw.title, LIMITS.titleLength, 'Plan title'),
      sourceText: typeof raw.sourceText === 'string' ? raw.sourceText.slice(0, LIMITS.sourceLength) : '',
      createdAt: raw.createdAt,
      updatedAt: isIso(raw.updatedAt) ? raw.updatedAt : raw.createdAt,
      goals,
      master: raw.master === null || raw.master === undefined ? null : validateAchievementSpec(raw.master),
      unlocks
    }
  } catch {
    return null
  }
}
