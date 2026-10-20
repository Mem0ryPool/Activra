import { completionDay, isCounted } from '../completions'
import { dayKey } from '../dates'
import { occursOn } from '../recurrence'
import { inWindow, intervalWindows, windowState } from '../timeWindow'
import type { CompletionEvent, Task, TaskWindow } from '../types'
import { addDays } from './dateMath'
import type { Plan, PlanGoal } from './types'

/**
 * Plan progress, computed only from local records: the goal's rule, its task and that task's
 * completion records (undone ones never count). The same inputs always give the same answer, so the
 * main process (unlocks) and the pages (progress bars) agree, and a restart changes nothing.
 *
 * A completion counts for the local day it belongs to (`completionDay`: the occurrence date, or the
 * day a one-off task was completed); each day counts once.
 *
 * Interval goals ("every hour for the next 4 hours") are measured on their node tasks instead: a node
 * counts when its task has a completion whose time lies inside the node's window, and is missed once
 * the window has closed without one. `now` decides only which windows are open or closed.
 */

export type GoalStatus =
  /** A chain step whose previous step is not achieved yet; its task does not exist yet. */
  | 'waiting'
  /** Starts on a later date. */
  | 'upcoming'
  | 'active'
  | 'achieved'
  /** Its own rule holds, but the step before it is no longer achieved (e.g. undone). */
  | 'blocked'
  /** Can no longer be reached in its window (missed or skipped days, a missed deadline). */
  | 'failed'
  /** Its task was deleted. */
  | 'broken'

export interface PeriodProgress {
  start: string
  end: string
  done: number
  target: number
}

/** One time window of an interval goal. */
export interface NodeProgress {
  index: number
  taskId: string | null
  window: TaskWindow
  /** done: completed inside its window; missed: closed without that; broken: its task was deleted. */
  state: 'done' | 'open' | 'upcoming' | 'missed' | 'broken'
}

export interface GoalProgress {
  goalId: string
  status: GoalStatus
  /** Progress toward `target`, capped at it (weekly: summed per week, each capped). */
  done: number
  target: number
  /** The day the rule was first met (latest of it and the previous step's), or null. */
  achievedOn: string | null
  windowStart: string | null
  windowEnd: string | null
  /** Weekly goals: one entry per 7-day block. */
  periods: PeriodProgress[]
  /** Interval goals: one entry per time window, in order. */
  nodes: NodeProgress[]
}

export interface PlanProgress {
  goals: GoalProgress[]
  achieved: boolean
  achievedOn: string | null
  /** True once some goal can no longer be achieved (or its task was deleted). */
  failed: boolean
  achievedCount: number
}

/** Days (YYYY-MM-DD, sorted, unique) on which the task has a completion that counts. */
export function completedDays(taskId: string, completions: readonly CompletionEvent[]): string[] {
  const days = new Set<string>()
  for (const event of completions) if (event.taskId === taskId && isCounted(event)) days.add(completionDay(event))
  return [...days].sort()
}


/** Done days in the window plus days still ahead (from today) on which the task occurs. */
function possibleDays(task: Task, done: Set<string>, start: string, end: string, today: string): Set<string> {
  const possible = new Set(done)
  const from = start > today ? start : today
  for (let d = from; d <= end; d = addDays(d, 1)) if (!done.has(d) && occursOn(task, d)) possible.add(d)
  return possible
}

/** Longest run of consecutive days in a sorted list, and the day it first reached `length`. */
function runs(days: string[], length: number): { best: number; reachedOn: string | null } {
  let best = 0
  let run = 0
  let previous: string | null = null
  let reachedOn: string | null = null
  for (const day of days) {
    run = previous !== null && addDays(previous, 1) === day ? run + 1 : 1
    previous = day
    best = Math.max(best, run)
    if (reachedOn === null && run >= length) reachedOn = day
  }
  return { best, reachedOn }
}

export function goalWindow(goal: PlanGoal): { start: string | null; end: string | null } {
  const c = goal.condition
  if (c.kind === 'once') return { start: goal.startedOn, end: c.due }
  if (c.kind === 'interval') {
    if (!c.start) return { start: null, end: null }
    const end = Date.parse(c.start) + c.minutes * c.count * 60_000 - 1
    return { start: dayKey(new Date(c.start)), end: dayKey(new Date(end)) }
  }
  const start = c.startDate ?? goal.startedOn
  if (!start) return { start: null, end: null }
  const length = c.kind === 'weekly' ? c.weeks * 7 : c.days
  return { start, end: addDays(start, length - 1) }
}

function targetOf(goal: PlanGoal): number {
  const c = goal.condition
  switch (c.kind) {
    case 'once':
      return 1
    case 'count':
      return c.required
    case 'weekly':
      return c.perWeek * c.weeks
    case 'streak':
      return c.length
    case 'interval':
      return c.count
  }
}

/** An interval goal: each node is its own one-off task, done only by a completion inside its window. */
function evaluateInterval(
  goal: PlanGoal,
  c: Extract<PlanGoal['condition'], { kind: 'interval' }>,
  byTask: ReadonlyMap<string, Task>,
  completions: readonly CompletionEvent[],
  now: number,
  base: GoalProgress
): GoalProgress {
  if (goal.taskId === null || c.start === null) return { ...base, status: 'waiting' }
  const nodes: NodeProgress[] = intervalWindows(c.start, c.minutes, c.count).map((window, index) => {
    const taskId = goal.nodeTaskIds[index] ?? null
    const task = taskId ? byTask.get(taskId) : undefined
    if (!task) return { index, taskId, window, state: 'broken' }
    const done = completions.some((e) => e.taskId === task.id && isCounted(e) && inWindow(window, e.completedAt))
    if (done) return { index, taskId, window, state: 'done' }
    const state = windowState(window, now)
    return { index, taskId, window, state: state === 'closed' ? 'missed' : state }
  })
  const done = nodes.filter((n) => n.state === 'done').length
  let status: GoalStatus = 'active'
  let achievedOn: string | null = null
  if (nodes.some((n) => n.state === 'broken')) status = 'broken'
  else if (nodes.some((n) => n.state === 'missed')) status = 'failed'
  else if (done === c.count) {
    status = 'achieved'
    // The local day of the latest completion that counted (the last window to be done).
    const days = completions
      .filter((e) => isCounted(e) && nodes.some((n) => n.taskId === e.taskId && inWindow(n.window, e.completedAt)))
      .map((e) => dayKey(new Date(e.completedAt)))
      .sort()
    achievedOn = days.at(-1) ?? null
  } else if (nodes[0]!.state === 'upcoming') status = 'upcoming'
  return { ...base, status, done, achievedOn, nodes }
}

/** A goal's own rule, ignoring chain order. */
function evaluateOwn(
  goal: PlanGoal,
  byTask: ReadonlyMap<string, Task>,
  completions: readonly CompletionEvent[],
  today: string,
  now: number
): GoalProgress {
  const task = goal.taskId ? byTask.get(goal.taskId) : undefined
  const { start, end } = goalWindow(goal)
  const base: GoalProgress = {
    goalId: goal.id,
    status: 'active',
    done: 0,
    target: targetOf(goal),
    achievedOn: null,
    windowStart: start,
    windowEnd: end,
    periods: [],
    nodes: []
  }
  if (goal.condition.kind === 'interval') return evaluateInterval(goal, goal.condition, byTask, completions, now, base)
  if (goal.taskId === null) return { ...base, status: 'waiting' }
  if (!task) return { ...base, status: 'broken' }
  const all = completedDays(task.id, completions)
  const c = goal.condition

  if (c.kind === 'once') {
    const day = all[0] ?? null
    if (day !== null) {
      if (c.onTime && c.due !== null && day > c.due) return { ...base, status: 'failed', done: 1 }
      return { ...base, status: 'achieved', done: 1, achievedOn: day }
    }
    if (c.onTime && c.due !== null && today > c.due) return { ...base, status: 'failed' }
    return base
  }

  const s = start as string
  const e = end as string
  const inWindow = all.filter((d) => d >= s && d <= e)
  const done = new Set(inWindow)
  const possible = possibleDays(task, done, s, e, today)
  let status: GoalStatus = 'active'
  let achievedOn: string | null = null
  let progress = 0
  const periods: PeriodProgress[] = []

  if (c.kind === 'count') {
    progress = Math.min(inWindow.length, c.required)
    if (inWindow.length >= c.required) achievedOn = inWindow[c.required - 1] as string
    else if (possible.size < c.required) status = 'failed'
  } else if (c.kind === 'weekly') {
    let allMet = true
    let latest = ''
    for (let i = 0; i < c.weeks; i++) {
      const blockStart = addDays(s, i * 7)
      const blockEnd = addDays(blockStart, 6)
      const blockDone = inWindow.filter((d) => d >= blockStart && d <= blockEnd)
      const blockPossible = [...possible].filter((d) => d >= blockStart && d <= blockEnd).length
      periods.push({ start: blockStart, end: blockEnd, done: Math.min(blockDone.length, c.perWeek), target: c.perWeek })
      progress += Math.min(blockDone.length, c.perWeek)
      if (blockDone.length >= c.perWeek) {
        const met = blockDone[c.perWeek - 1] as string
        if (met > latest) latest = met
      } else {
        allMet = false
        if (blockPossible < c.perWeek) status = 'failed'
      }
    }
    if (allMet) achievedOn = latest
  } else {
    const { best, reachedOn } = runs(inWindow, c.length)
    progress = Math.min(best, c.length)
    if (reachedOn !== null) achievedOn = reachedOn
    else if (runs([...possible].sort(), c.length).best < c.length) status = 'failed'
  }

  if (achievedOn !== null) status = 'achieved'
  else if (status !== 'failed' && today < s) status = 'upcoming'
  return { ...base, status, done: progress, achievedOn, periods }
}

/**
 * `today` is the local date the day-based rules use; `now` (ms) the moment interval windows are
 * checked against. Pass both from the same clock reading.
 */
export function evaluatePlan(
  plan: Pick<Plan, 'goals'>,
  tasks: readonly Task[],
  completions: readonly CompletionEvent[],
  today: string,
  now: number
): PlanProgress {
  const byTask = new Map(tasks.map((t) => [t.id, t]))
  const results = new Map<string, GoalProgress>()
  const goals: GoalProgress[] = []
  for (const goal of plan.goals) {
    const own = evaluateOwn(goal, byTask, completions, today, now)
    const previous = goal.after ? results.get(goal.after) : undefined
    let result = own
    if (goal.after) {
      if (!previous || previous.status !== 'achieved') {
        // The step before is not (or no longer) achieved: this step cannot count yet.
        if (own.status === 'achieved') result = { ...own, status: 'blocked', achievedOn: null }
      } else if (own.achievedOn && previous.achievedOn && previous.achievedOn > own.achievedOn) {
        result = { ...own, achievedOn: previous.achievedOn }
      }
    }
    results.set(goal.id, result)
    goals.push(result)
  }
  const achieved = goals.length > 0 && goals.every((g) => g.status === 'achieved')
  return {
    goals,
    achieved,
    achievedOn: achieved ? (goals.map((g) => g.achievedOn as string).sort().at(-1) ?? null) : null,
    failed: goals.some((g) => g.status === 'failed' || g.status === 'broken'),
    achievedCount: goals.filter((g) => g.status === 'achieved').length
  }
}


/** At a glance for an interval goal's nodes (Phase 6.2): how many are done or missed, and which window is open or next. */
export interface IntervalOverview {
  done: number
  total: number
  missed: number
  /** The node whose window is open now, if any. */
  current: NodeProgress | null
  /** The first node whose window has not opened yet, if any. */
  next: NodeProgress | null
}

export function intervalOverview(nodes: readonly NodeProgress[]): IntervalOverview {
  return {
    done: nodes.filter((n) => n.state === 'done').length,
    total: nodes.length,
    missed: nodes.filter((n) => n.state === 'missed').length,
    current: nodes.find((n) => n.state === 'open') ?? null,
    next: nodes.find((n) => n.state === 'upcoming') ?? null
  }
}
