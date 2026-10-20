import { TITLE_MAX_LENGTH } from '../constants'
import { ValidationError, validateId } from '../validation'
import { DEFAULT_FOCUS_DURATIONS, FOCUS_LIMITS, INITIAL_FOCUS_STATE, LONG_BREAK_EVERY } from './timer'
import type { FocusDurations, FocusOrigin, FocusPhase, FocusRun, FocusSelection, FocusSession, FocusTimerState, PlanFocusInput, PlanFocusStart } from './types'

export function validatePlanFocus(value: unknown): PlanFocusInput {
  if (!isRecord(value)) throw new ValidationError('Plan focus must be an object')
  assertOnlyKeys(value, ['planId', 'goals'], 'Plan focus')
  const planId = validateId(value.planId)
  if (!Array.isArray(value.goals) || value.goals.length === 0 || value.goals.length > 100) throw new ValidationError('Invalid focus goals')
  const seen = new Set<string>()
  const goals = value.goals.map(goal => {
    if (!isRecord(goal)) throw new ValidationError('Invalid focus goal')
    assertOnlyKeys(goal, ['goalId', 'sessions'], 'Focus goal')
    const goalId = validateId(goal.goalId)
    if (seen.has(goalId) || typeof goal.sessions !== 'number' || !Number.isInteger(goal.sessions) || goal.sessions < 1 || goal.sessions > 24) throw new ValidationError('Invalid focus session budget')
    seen.add(goalId)
    return { goalId, sessions: goal.sessions }
  })
  return { planId, goals }
}

export function validatePlanFocusStart(value: unknown): PlanFocusStart {
  if (!isRecord(value)) throw new ValidationError('Invalid plan focus start')
  assertOnlyKeys(value, ['planId', 'goalId', 'taskId'], 'Plan focus start')
  return { planId: validateId(value.planId), goalId: validateId(value.goalId), taskId: validateId(value.taskId) }
}

export function reviveFocusOrigin(value: unknown): FocusOrigin | undefined {
  if (!isRecord(value)) return undefined
  try { return { planId: validateId(value.planId), goalId: validateId(value.goalId) } } catch { return undefined }
}

export function revivePlanTargets(value: unknown): PlanFocusInput[] {
  if (!Array.isArray(value)) return []
  const targets = new Map<string, PlanFocusInput>()
  for (const item of value) {
    try { const target = validatePlanFocus(item); targets.set(target.planId, target) } catch { /* Keep valid independent budgets. */ }
  }
  return [...targets.values()]
}

export const FOCUS_PHASES = ['focus', 'short-break', 'long-break'] as const satisfies readonly FocusPhase[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isPhase(value: unknown): value is FocusPhase {
  return (FOCUS_PHASES as readonly unknown[]).includes(value)
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ValidationError(`${what}: unexpected field "${key}"`)
  }
}

export function validateFocusPhase(value: unknown): FocusPhase {
  if (!isPhase(value)) throw new ValidationError('Unknown focus phase')
  return value
}

/** A task id, or null for focusing without a task. */
export function validateFocusTaskId(value: unknown): string | null {
  return value === null || value === undefined ? null : validateId(value)
}

export function validateFocusSelection(value: unknown): FocusSelection {
  if (!isRecord(value)) throw new ValidationError('Focus selection must be an object')
  assertOnlyKeys(value, ['phase', 'taskId'], 'Focus selection')
  const selection: FocusSelection = {}
  if ('phase' in value) selection.phase = validateFocusPhase(value.phase)
  if ('taskId' in value) selection.taskId = validateFocusTaskId(value.taskId)
  return selection
}

/** Whole minutes within FOCUS_LIMITS for each length. */
export function validateFocusDurations(value: unknown): FocusDurations {
  if (!isRecord(value)) throw new ValidationError('Focus durations must be an object')
  assertOnlyKeys(value, Object.keys(DEFAULT_FOCUS_DURATIONS), 'Focus durations')
  const result = { ...DEFAULT_FOCUS_DURATIONS }
  for (const key of Object.keys(DEFAULT_FOCUS_DURATIONS) as (keyof FocusDurations)[]) {
    const v = value[key]
    const { min, max } = FOCUS_LIMITS[key]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw new ValidationError(`${key} must be a whole number from ${min} to ${max}`)
    }
    result[key] = v
  }
  return result
}

/** Each length on its own, so one bad value keeps the others. */
export function reviveFocusDurations(raw: unknown): FocusDurations {
  const result = { ...DEFAULT_FOCUS_DURATIONS }
  if (!isRecord(raw)) return result
  for (const key of Object.keys(DEFAULT_FOCUS_DURATIONS) as (keyof FocusDurations)[]) {
    const v = raw[key]
    const { min, max } = FOCUS_LIMITS[key]
    if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) result[key] = v
  }
  return result
}

function reviveTitle(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, TITLE_MAX_LENGTH) : ''
}

function reviveTaskId(value: unknown): string | null {
  try {
    return validateFocusTaskId(value)
  } catch {
    return null
  }
}

export function reviveFocusRun(raw: unknown): FocusRun | null {
  if (!isRecord(raw)) return null
  const { id, phase, plannedSec, startedAt, resumedAt, elapsedMs } = raw
  if (typeof id !== 'string' || !id || !isPhase(phase) || !isIso(startedAt)) return null
  if (typeof plannedSec !== 'number' || !Number.isInteger(plannedSec) || plannedSec < 60 || plannedSec > 180 * 60) return null
  if (resumedAt !== null && !isIso(resumedAt)) return null
  const elapsed = typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) ? elapsedMs : 0
  return {
    id,
    phase,
    ...(phase === 'focus' && reviveFocusOrigin(raw.origin) ? { origin: reviveFocusOrigin(raw.origin) } : {}),
    taskId: phase === 'focus' ? reviveTaskId(raw.taskId) : null,
    taskTitle: phase === 'focus' ? reviveTitle(raw.taskTitle) : '',
    plannedSec,
    startedAt,
    resumedAt,
    elapsedMs: Math.min(plannedSec * 1000, Math.max(0, elapsed))
  }
}

export function reviveFocusState(raw: unknown): FocusTimerState {
  if (!isRecord(raw)) return { ...INITIAL_FOCUS_STATE }
  const cycle = typeof raw.cycle === 'number' && Number.isInteger(raw.cycle) ? raw.cycle : 0
  return {
    run: reviveFocusRun(raw.run),
    nextPhase: isPhase(raw.nextPhase) ? raw.nextPhase : 'focus',
    taskId: reviveTaskId(raw.taskId),
    cycle: cycle >= 0 && cycle < LONG_BREAK_EVERY ? cycle : 0
  }
}

export function reviveFocusSession(raw: unknown): FocusSession | null {
  if (!isRecord(raw)) return null
  const { id, plannedSec, focusedSec, startedAt, endedAt, outcome } = raw
  if (typeof id !== 'string' || !id || !isIso(startedAt) || !isIso(endedAt)) return null
  if (outcome !== 'completed' && outcome !== 'ended-early') return null
  if (typeof plannedSec !== 'number' || !Number.isInteger(plannedSec) || plannedSec <= 0) return null
  if (typeof focusedSec !== 'number' || !Number.isFinite(focusedSec) || focusedSec < 0) return null
  return {
    id,
    ...(reviveFocusOrigin(raw.origin) ? { origin: reviveFocusOrigin(raw.origin) } : {}),
    taskId: reviveTaskId(raw.taskId),
    taskTitle: reviveTitle(raw.taskTitle),
    plannedSec,
    focusedSec: Math.min(plannedSec, Math.floor(focusedSec)),
    startedAt,
    endedAt,
    outcome
  }
}

/** Revives the records; a second record with the same id (hand edits only) is dropped, so none counts twice. */
export function reviveFocusSessions(raw: unknown): FocusSession[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const sessions: FocusSession[] = []
  for (const item of raw) {
    const session = reviveFocusSession(item)
    if (!session || seen.has(session.id)) continue
    seen.add(session.id)
    sessions.push(session)
  }
  return sessions
}
