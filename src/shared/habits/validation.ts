import { isDateKey } from '../dates'
import { ValidationError } from '../validation'
import {
  HABIT_ACTIONS,
  HABIT_NAME_MAX_LENGTH,
  HABIT_NOTE_MAX_LENGTH,
  HABIT_TIMES_PER_WEEK_MAX,
  type Habit,
  type HabitAction,
  type HabitCheckin,
  type HabitFrequency,
  type HabitInput,
  type HabitPatch,
  type HabitPause,
  type HabitState
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ValidationError(`${what}: unexpected field "${key}"`)
  }
}

function validateName(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError('Habit name must be a string')
  const name = value.trim()
  if (name.length === 0) throw new ValidationError('Habit name is required')
  if (name.length > HABIT_NAME_MAX_LENGTH) throw new ValidationError('Habit name is too long')
  return name
}

function validateNote(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new ValidationError('Habit note must be a string')
  const note = value.trim()
  if (note.length > HABIT_NOTE_MAX_LENGTH) throw new ValidationError('Habit note is too long')
  return note
}

export function validateHabitFrequency(value: unknown): HabitFrequency {
  if (!isRecord(value)) throw new ValidationError('Habit frequency must be an object')
  if (value.kind === 'daily') {
    assertOnlyKeys(value, ['kind'], 'Habit frequency')
    return { kind: 'daily' }
  }
  if (value.kind === 'weekly') {
    assertOnlyKeys(value, ['kind', 'timesPerWeek'], 'Habit frequency')
    const times = value.timesPerWeek
    if (typeof times !== 'number' || !Number.isInteger(times) || times < 1 || times > HABIT_TIMES_PER_WEEK_MAX) {
      throw new ValidationError('timesPerWeek must be 1–7')
    }
    return { kind: 'weekly', timesPerWeek: times }
  }
  if (value.kind === 'weekdays') {
    assertOnlyKeys(value, ['kind', 'weekdays'], 'Habit frequency')
    const days = value.weekdays
    if (!Array.isArray(days) || days.length === 0 || days.some((d) => typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new ValidationError('weekdays must be days 0–6')
    }
    return { kind: 'weekdays', weekdays: [...new Set(days as number[])].sort((a, b) => a - b) }
  }
  throw new ValidationError('Unknown habit frequency')
}

export function validateHabitInput(value: unknown): Required<HabitInput> {
  if (!isRecord(value)) throw new ValidationError('Habit must be an object')
  assertOnlyKeys(value, ['name', 'note', 'frequency'], 'Habit')
  return { name: validateName(value.name), note: validateNote(value.note), frequency: validateHabitFrequency(value.frequency) }
}

export function validateHabitPatch(value: unknown): HabitPatch {
  if (!isRecord(value)) throw new ValidationError('Habit patch must be an object')
  assertOnlyKeys(value, ['name', 'note', 'frequency'], 'Habit patch')
  const patch: HabitPatch = {}
  if (value.name !== undefined) patch.name = validateName(value.name)
  if (value.note !== undefined) patch.note = validateNote(value.note)
  if (value.frequency !== undefined) patch.frequency = validateHabitFrequency(value.frequency)
  return patch
}

export function validateHabitAction(value: unknown): HabitAction {
  if (typeof value !== 'string' || !(HABIT_ACTIONS as readonly string[]).includes(value)) {
    throw new ValidationError('Unknown habit action')
  }
  return value as HabitAction
}

const STATES: readonly HabitState[] = ['active', 'paused', 'archived']

function revivePauses(raw: unknown): HabitPause[] {
  if (!Array.isArray(raw)) return []
  const pauses: HabitPause[] = []
  for (const item of raw) {
    if (!isRecord(item) || !isDateKey(item.from)) continue
    const until = isDateKey(item.until) && item.until >= item.from ? item.until : null
    const last = pauses.at(-1)
    // Oldest first, not overlapping, and only the last one may still be open.
    if (last && (last.until === null || item.from <= last.until)) continue
    pauses.push({ from: item.from, until })
  }
  return pauses
}

/** Restores a habit from disk, or null when it is unusable (the rest of the file still loads). */
export function reviveHabit(raw: unknown): Habit | null {
  if (!isRecord(raw)) return null
  const { id, name, createdAt } = raw
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim() || !isIso(createdAt)) return null
  let frequency: HabitFrequency
  try {
    frequency = validateHabitFrequency(raw.frequency)
  } catch {
    return null
  }
  const state = STATES.includes(raw.state as HabitState) ? (raw.state as HabitState) : 'active'
  return {
    id,
    name: name.trim().slice(0, HABIT_NAME_MAX_LENGTH),
    note: typeof raw.note === 'string' ? raw.note.slice(0, HABIT_NOTE_MAX_LENGTH) : '',
    frequency,
    startDate: isDateKey(raw.startDate) ? raw.startDate : createdAt.slice(0, 10),
    state,
    pauses: revivePauses(raw.pauses),
    createdAt,
    updatedAt: isIso(raw.updatedAt) ? raw.updatedAt : createdAt,
    archivedAt: state === 'archived' && isIso(raw.archivedAt) ? raw.archivedAt : null
  }
}

export function reviveHabitCheckin(raw: unknown): HabitCheckin | null {
  if (!isRecord(raw)) return null
  const { id, habitId, date, checkedAt, undoneAt } = raw
  if (typeof id !== 'string' || !id || typeof habitId !== 'string' || !isDateKey(date) || !isIso(checkedAt)) return null
  return { id, habitId, date, checkedAt, undoneAt: isIso(undoneAt) ? undoneAt : null }
}
