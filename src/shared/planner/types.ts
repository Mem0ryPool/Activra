/**
 * Smart Achievement Planner (Phase 6).
 *
 * Text → `PlanDraft` (parser, may be uncertain) → user edits and confirms → `PlanInput` (validated)
 * → stored `Plan` (main process) → progress and unlocks computed by deterministic local rules only.
 * Nothing here ever trusts the parser to decide that something is achieved.
 */

/** What kind of real-life activity a goal is; picks the achievement template (icon, names). */
export type GoalCategory =
  | 'vocabulary'
  | 'language'
  | 'reading'
  | 'homework'
  | 'study'
  | 'coding'
  | 'fitness'
  | 'running'
  | 'mindfulness'
  | 'sleep'
  | 'health'
  | 'writing'
  | 'music'
  | 'chores'
  | 'finance'
  | 'work'
  | 'general'

export const GOAL_CATEGORIES = [
  'vocabulary',
  'language',
  'reading',
  'homework',
  'study',
  'coding',
  'fitness',
  'running',
  'mindfulness',
  'sleep',
  'health',
  'writing',
  'music',
  'chores',
  'finance',
  'work',
  'general'
] as const satisfies readonly GoalCategory[]

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const satisfies readonly Rarity[]

/** Icons a plan achievement can use; the renderer maps each to a drawn (lucide) icon. */
export const PLAN_ICONS = [
  'book-open',
  'languages',
  'graduation-cap',
  'notebook-pen',
  'code',
  'dumbbell',
  'footprints',
  'flower',
  'moon',
  'heart-pulse',
  'pen-line',
  'music',
  'sparkles',
  'piggy-bank',
  'briefcase',
  'target',
  'flame',
  'trophy',
  'crown'
] as const
export type PlanIcon = (typeof PLAN_ICONS)[number]

export interface AchievementSpec {
  name: string
  description: string
  icon: PlanIcon
  rarity: Rarity
}

/** "20 words", "30 minutes": shown with the goal. The app cannot measure it; the user ticks the task. */
export interface Quantity {
  amount: number
  unit: string
}

/**
 * When a goal counts as achieved. Windows are whole local days; `startDate` null means "the day the goal
 * starts" (a chain step starts when the step before it is achieved).
 *
 * - once:   the one-off task is completed (on or before `due` when `onTime`).
 * - count:  at least `required` days completed within `days` days, the task occurring every `every` days.
 * - weekly: in each of `weeks` 7-day blocks from the start, at least `perWeek` days completed. With
 *           `weekdays` the task occurs only on those weekdays; with null it can be done on any day.
 * - streak: `length` consecutive days completed within `days` days.
 * - interval: `count` back-to-back time windows of `minutes` each ("every hour for the next 4 hours"),
 *           each completed inside its own window. `start` (ISO instant) is set by the main process
 *           when the goal starts (the plan is confirmed, or the step before is achieved); null until then.
 */
export type GoalCondition =
  | { kind: 'once'; due: string | null; onTime: boolean }
  | { kind: 'count'; startDate: string | null; days: number; every: number; required: number }
  | { kind: 'weekly'; startDate: string | null; weeks: number; perWeek: number; weekdays: number[] | null }
  | { kind: 'streak'; startDate: string | null; days: number; length: number }
  | { kind: 'interval'; start: string | null; minutes: number; count: number }

export type GoalKind = GoalCondition['kind']
export const GOAL_KINDS = ['once', 'count', 'weekly', 'streak', 'interval'] as const satisfies readonly GoalKind[]

export interface PlanGoal {
  id: string
  /** Title of the task it creates. */
  title: string
  category: GoalCategory
  quantity: Quantity | null
  condition: GoalCondition
  /** Goal that must be achieved first (a chain step), or null for an independent goal. */
  after: string | null
  /** The task this goal is measured on; null while a chain step waits for the step before it. */
  taskId: string | null
  /**
   * Interval goals: one one-off task per time window, in order (`taskId` is the first). Empty for
   * every other kind.
   */
  nodeTaskIds: string[]
  /** Day the goal started (its task was created). */
  startedOn: string | null
  achievement: AchievementSpec
}

/**
 * One unlock of a plan achievement. Like a completion record it is never deleted: when the rules stop
 * holding (an undo, a deleted task) it is marked `revokedAt`, and a later unlock is a new record.
 */
export interface PlanUnlock {
  id: string
  /** Goal id, or PLAN_TARGET for the plan's "All achievements!" achievement. */
  target: string
  unlockedAt: string
  revokedAt: string | null
}

export const PLAN_TARGET = 'plan'

export interface Plan {
  id: string
  title: string
  /** The text the plan was generated from, kept for reference. */
  sourceText: string
  createdAt: string
  updatedAt: string
  goals: PlanGoal[]
  /** The extra "All achievements!" achievement for the whole plan, or null when not wanted. */
  master: AchievementSpec | null
  unlocks: PlanUnlock[]
}

/** What the renderer sends to create a plan (validated in the main process). */
export interface PlanGoalInput {
  /** Temporary id used only to link chain steps inside this input. */
  key: string
  title: string
  category: GoalCategory
  quantity: Quantity | null
  condition: GoalCondition
  afterKey: string | null
  achievement: AchievementSpec
}

export interface PlanInput {
  title: string
  sourceText: string
  goals: PlanGoalInput[]
  master: AchievementSpec | null
}

// ---------------------------------------------------------------------------------------------
// Parser output

/**
 * Something the parser could not decide. `blocking` problems must be fixed by editing the field;
 * the others are guesses the user must confirm (or change) before the plan can be imported.
 */
export type DraftIssueCode =
  /** A repeating goal has no length ("每天背单词" with no "30 天"). */
  | 'missing-duration'
  /** "N 次" with nothing to count against. */
  | 'missing-count'
  /** The text says how long only roughly (e.g. 30 days for a per-week goal → whole weeks). */
  | 'weeks-rounded'
  /** A weekday or date that could mean two days ("周五" said on a Friday, "下周"). */
  | 'ambiguous-date'
  /** A date without a year that was placed in next year. */
  | 'year-assumed'
  /** A deadline or start already in the past. */
  | 'date-past'
  /** Vague words ("尽量", "多", "a few") the rules cannot turn into a number. */
  | 'vague'
  /** Numbers that do not fit together (more times than days, deadline before the start). */
  | 'inconsistent'
  /** A chain step's relative date was counted from today, not from when the step starts. */
  | 'chain-date'
  /** "4 小时内喝水 3 次": the time was split evenly into windows; the user must confirm the split. */
  | 'interval-assumed'
  /** Hourly words that cannot be placed reliably ("每天每小时", a clock time, a start date, days of windows). */
  | 'hourly-unsupported'

export interface DraftIssue {
  code: DraftIssueCode
  /** The words in the text it is about. */
  text: string
}

/** One parsed goal, every number nullable: null means "not in the text", never a made-up value. */
export interface DraftGoal {
  key: string
  title: string
  /** The clause of the input it came from. */
  source: string
  category: GoalCategory
  quantity: Quantity | null
  kind: GoalKind
  startDate: string | null
  /** count / streak window length in days. */
  days: number | null
  /** count: days required; streak: run length. */
  required: number | null
  every: number
  /** interval: minutes per window. */
  intervalMinutes: number | null
  /** interval: number of windows (nodes). */
  slots: number | null
  weeks: number | null
  perWeek: number | null
  weekdays: number[] | null
  due: string | null
  onTime: boolean
  /** True when the text says this goal comes after the one before it ("然后", "then"). */
  afterPrevious: boolean
  /** Guesses waiting for the user's confirmation; edited fields drop theirs. */
  issues: DraftIssue[]
  achievement: AchievementSpec
}

export interface PlanDraft {
  title: string
  sourceText: string
  goals: DraftGoal[]
  /** Parts of the text no goal was made from; shown so nothing is silently dropped. */
  unparsed: string[]
  /** Create the "All achievements!" achievement (only offered with two or more goals). */
  master: AchievementSpec | null
  /** Language the text was written in; generated names use it. */
  language: 'zh' | 'en'
}

export interface ParseOptions {
  /** Local date (YYYY-MM-DD) everything relative is counted from. */
  today: string
}

/** The seam for a future AI parser: anything that turns text into a draft for the same preview. */
export interface PlanParser {
  parse(text: string, options: ParseOptions): PlanDraft
}
