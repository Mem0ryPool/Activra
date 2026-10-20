import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_REMINDER_SETTINGS, DEFAULT_SETTINGS } from '../../shared/constants'
import { normalizeDue } from '../../shared/deadline'
import { THEME_IDS, type ThemeId } from '../../shared/themes'
import type {
  CompleteTaskResult,
  CompletionEvent,
  Settings,
  SettingsPatch,
  Task,
  TaskPatch,
  TaskSnapshot,
  UndoCompletionResult
} from '../../shared/types'
import { dayKey, isDateKey } from '../../shared/dates'
import {
  addDays,
  applyRuleChange,
  plannedOn,
  occursOn,
  sameRule,
  type RecurrenceSegment
} from '../../shared/recurrence'
import {
  validateDue,
  validateRecurrence,
  validateReminderMinutes,
  validateReminderSettings,
  validateSettingsPatch,
  ValidationError,
  type ValidTaskInput
} from '../../shared/validation'
import { reviveWidgetSettings } from '../../shared/widget'
import { defaultWidgetShortcut, migrateWidgetShortcut } from '../../shared/shortcut'
import { quarantineFile, readJson, writeJsonAtomic } from './jsonFile'
import { floorToMinute, isWindowOpen, reviveWindow } from '../../shared/timeWindow'
import { evaluatePlan } from '../../shared/planner/progress'
import { goalsToStart, nodeTaskInputs, reconcileUnlocks, taskInputForGoal } from '../../shared/planner/sync'
import { revivePlan } from '../../shared/planner/validation'
import { PLAN_TARGET, type Plan, type PlanInput, type PlanUnlock } from '../../shared/planner/types'
import {
  acceptableCheckinDate,
  applyHabitAction,
  countedCheckinOn,
  isScheduled
} from '../../shared/habits/streak'
import { habitCheckinFeedback } from '../../shared/habits/feedback'
import { reviveHabit, reviveHabitCheckin } from '../../shared/habits/validation'
import type {
  Habit,
  HabitAction,
  HabitCheckin,
  HabitCheckinResult,
  HabitInput,
  HabitPatch,
  HabitUndoResult
} from '../../shared/habits/types'

/**
 * 1: tasks + settings.
 * 2: adds `completions`, one record per completion (see docs/data-migration.md).
 * 3: adds `plans` (Smart Achievement Planner). Tasks, completions and settings are unchanged.
 * 4: adds `window` to tasks (null for every existing task) and interval goals with `nodeTaskIds` to
 *    plans (Phase 6.1, timed plan nodes). Nothing existing changes meaning.
 * 5: adds `habits` and `habitCheckins` (Phase 6.6). Tasks, completions, plans and settings are unchanged.
 */
export const SCHEMA_VERSION = 5
export const DATA_FILE_NAME = 'life-unlocked-data.json'
/**
 * A copy of the habits and their check-ins, written next to the data file after every change while
 * there are habits. A version older than schema 5 drops fields it does not know when it saves the
 * data file; this copy (which such a version never touches) brings the habits back after reinstalling
 * a newer version (see docs/data-migration.md). Otherwise the data file is the source of truth.
 */
export const HABITS_MIRROR_FILE = 'life-unlocked-habits-mirror.json'
/** A click on yesterday's occurrence this many minutes after midnight still counts for yesterday. */
const MIDNIGHT_GRACE_MIN = 10

interface PersistedData {
  schemaVersion: number
  tasks: Task[]
  completions: CompletionEvent[]
  plans: Plan[]
  habits: Habit[]
  habitCheckins: HabitCheckin[]
  settings: Settings
}

/** A plan achievement that was just unlocked: the main process shows its notification. */
export interface PlanUnlockEvent {
  unlockId: string
  planId: string
  planTitle: string
  /** 'goal' for one goal's achievement, 'plan' for the plan's "All achievements!". */
  kind: 'goal' | 'plan'
  name: string
}

/** Plan achievements unlocked and withdrawn by the last changes, taken by `takePlanEvents`. */
export interface PlanEvents {
  unlocked: PlanUnlockEvent[]
  /** Unlock ids whose notification must be withdrawn if still waiting. */
  revoked: string[]
}

/** Copy of the data file as it was before a migration, written once and never overwritten. */
export function backupFileName(fromVersion: number): string {
  return `life-unlocked-data.v${fromVersion}-backup.json`
}

/** Daily copies of the data file, in this folder next to it (see docs/data-migration.md). */
export const BACKUP_DIR = 'backups'
/** How many daily copies are kept; older copies (never the data file itself) are removed. */
export const KEEP_BACKUPS = 10
const DAILY_BACKUP = /^life-unlocked-data-(\d{4}-\d{2}-\d{2})\.json$/

export function dailyBackupName(day: string): string {
  return `life-unlocked-data-${day}.json`
}

/** Something about the data file the user must be told at startup. */
export type StartupNotice =
  /** The file could not be read; it was kept aside and the newest daily copy was restored. */
  | { kind: 'recovered'; quarantined: string; restoredFrom: string }
  /** The file could not be read and there was no usable copy; the app starts empty, the file is kept aside. */
  | { kind: 'unrecoverable'; quarantined: string }
  /** Written by a newer version of the app; a copy was kept before this version touches it. */
  | { kind: 'newer-version'; version: number; backup: string | null }

/** What happened when the file was loaded; kept for diagnostics and tests. */
export interface LoadReport {
  fromVersion: number | null
  migrated: boolean
  backup: string | null
  /** Completions created for completed tasks that had none (all of them when coming from version 1). */
  createdCompletions: number
  droppedTasks: number
  droppedCompletions: number
  droppedPlans: number
  /** Habits brought back from the mirror because the data file had none (an older version saved it). */
  restoredHabits: number
}

export class TaskNotFoundError extends Error {
  override name = 'TaskNotFoundError'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function reviveRule(raw: unknown): Task['recurrence'] {
  try {
    return validateRecurrence(raw)
  } catch {
    return null
  }
}

function tryOr<T>(fallback: T, fn: () => T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function reviveHistory(raw: unknown): RecurrenceSegment[] {
  if (!Array.isArray(raw)) return []
  const segments: RecurrenceSegment[] = []
  for (const item of raw) {
    if (!isRecord(item) || !isDateKey(item.until)) continue
    const rule = reviveRule(item.rule)
    // Oldest first, each ending after the one before; anything else is dropped.
    if (rule && (segments.length === 0 || item.until > (segments.at(-1) as RecurrenceSegment).until)) {
      segments.push({ rule, until: item.until })
    }
  }
  return segments
}

/** Restores a task from disk, dropping anything malformed rather than crashing the app. */
function reviveTask(raw: unknown): Task | null {
  if (!isRecord(raw)) return null
  const { id, title, description, createdAt, updatedAt, completedAt, status, timerConfig, themeOverride } = raw
  const recurrence = reviveRule(raw.recurrence)
  if (typeof id !== 'string' || typeof title !== 'string' || !isIsoString(createdAt)) return null
  if (status !== 'active' && status !== 'completed') return null
  let timer: Task['timerConfig'] = null
  if (
    isRecord(timerConfig) &&
    timerConfig.kind === 'countdown' &&
    typeof timerConfig.durationSec === 'number' &&
    isIsoString(timerConfig.startedAt)
  ) {
    timer = { kind: 'countdown', durationSec: timerConfig.durationSec, startedAt: timerConfig.startedAt }
  }
  // A repeating task is a template and is never completed itself.
  const completed = !recurrence && status === 'completed' && isIsoString(completedAt)
  return {
    id,
    title,
    description: typeof description === 'string' ? description : '',
    createdAt,
    updatedAt: isIsoString(updatedAt) ? updatedAt : createdAt,
    completedAt: completed ? completedAt : null,
    status: completed ? 'completed' : 'active',
    timerConfig: recurrence ? null : timer,
    themeOverride: (THEME_IDS as readonly unknown[]).includes(themeOverride) ? (themeOverride as ThemeId) : null,
    recurrence,
    recurrenceHistory: reviveHistory(raw.recurrenceHistory),
    skippedOccurrences: Array.isArray(raw.skippedOccurrences)
      ? [...new Set(raw.skippedOccurrences.filter(isDateKey))].sort()
      : [],
    ...deadlineFields(
      tryOr(null, () => validateDue(raw.due)),
      tryOr(null, () => validateReminderMinutes(raw.reminderMinutes)),
      !!recurrence
    ),
    // Absent before schema 4. A repeating task never has one.
    window: recurrence ? null : reviveWindow(raw.window)
  }
}

function reviveCompletion(raw: unknown): CompletionEvent | null {
  if (!isRecord(raw)) return null
  const { id, taskId, occurrence, completedAt, undoneAt, title } = raw
  if (typeof id !== 'string' || !id || typeof taskId !== 'string' || !isIsoString(completedAt)) return null
  return {
    id,
    taskId,
    occurrence: typeof occurrence === 'string' ? occurrence : null,
    completedAt,
    undoneAt: isIsoString(undoneAt) ? undoneAt : null,
    title: typeof title === 'string' ? title : ''
  }
}

/**
 * A record for a completion that predates completion records. Its id is derived from the task,
 * never random, so loading the same old file twice gives the same records.
 */
function completionFromTask(task: Task, taken: ReadonlySet<string>): CompletionEvent {
  const base = `migrated-${task.id}`
  return {
    id: taken.has(base) ? `${base}-${Date.parse(task.completedAt as string)}` : base,
    taskId: task.id,
    occurrence: null,
    completedAt: task.completedAt as string,
    undoneAt: null,
    title: task.title
  }
}

/**
 * Brings tasks and completions into agreement after loading. For a one-off task its own
 * status is what older versions wrote, so it decides:
 * - completed, but no counted completion → one is created from the task's `completedAt`
 *   (this is the whole migration from version 1);
 * - completed, several counted completions → only the latest keeps counting;
 * - in progress, but a counted completion → that completion is marked undone;
 * - completions of tasks that no longer exist → dropped (deleting a task removes its records).
 * Only hand-edited files reach the middle two cases.
 */
function reconcile(tasks: Task[], completions: CompletionEvent[]): { completions: CompletionEvent[]; created: number } {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const kept = completions.filter((e) => byId.has(e.taskId))
  const taken = new Set(kept.map((e) => e.id))
  let created = 0
  for (const task of tasks) {
    const counted = kept
      .filter((e) => e.taskId === task.id && e.occurrence === null && e.undoneAt === null)
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt))
    if (task.status === 'completed') {
      if (counted.length === 0) {
        const event = completionFromTask(task, taken)
        taken.add(event.id)
        kept.push(event)
        created += 1
      }
      const latest = counted.at(-1)
      for (const extra of counted.slice(0, -1)) extra.undoneAt = latest?.completedAt ?? extra.completedAt
    } else {
      for (const stale of counted) stale.undoneAt = task.updatedAt
    }
    // A repeating task's occurrence counts once; extra records (hand edits only) are marked undone.
    const byOccurrence = new Map<string, CompletionEvent>()
    for (const event of kept) {
      if (event.taskId !== task.id || event.occurrence === null || event.undoneAt !== null) continue
      const first = byOccurrence.get(event.occurrence)
      if (!first) byOccurrence.set(event.occurrence, event)
      else event.undoneAt = event.completedAt
    }
  }
  return { completions: kept, created }
}

/** A reminder needs a deadline; a repeating task's deadline has no date of its own. */
function deadlineFields(
  due: Task['due'],
  reminderMinutes: number | null,
  repeating: boolean
): Pick<Task, 'due' | 'reminderMinutes'> {
  const normalized = normalizeDue(due, repeating)
  return { due: normalized, reminderMinutes: normalized ? reminderMinutes : null }
}

/**
 * Check-ins of habits that no longer exist are dropped; a second counted check-in for the same habit
 * and day (hand edits only) is marked undone, so a day is never counted twice.
 */
function reconcileCheckins(habits: Habit[], checkins: HabitCheckin[]): HabitCheckin[] {
  const ids = new Set(habits.map((h) => h.id))
  const kept = checkins.filter((c) => ids.has(c.habitId))
  const seen = new Set<string>()
  for (const c of [...kept].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))) {
    if (c.undoneAt !== null) continue
    const key = `${c.habitId}@${c.date}`
    if (seen.has(key)) c.undoneAt = c.checkedAt
    else seen.add(key)
  }
  return kept
}

function copyHabit(habit: Habit): Habit {
  return { ...habit, frequency: { ...habit.frequency }, pauses: habit.pauses.map((p) => ({ ...p })) }
}

function copyPlan(plan: Plan): Plan {
  return structuredClone(plan)
}

function copyTask(task: Task): Task {
  return {
    ...task,
    recurrenceHistory: [...task.recurrenceHistory],
    skippedOccurrences: [...task.skippedOccurrences],
    due: task.due ? { ...task.due } : null,
    window: task.window ? { ...task.window } : null
  }
}

function reviveSettings(raw: unknown, platform: string): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS, widgetShortcut: defaultWidgetShortcut(platform) }
  if (!isRecord(raw)) return settings
  // Apply each known field on its own so one bad value does not reset the rest.
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    try {
      Object.assign(settings, validateSettingsPatch({ [key]: raw[key] }))
    } catch {
      // keep default
    }
  }
  // Widget fields are restored one by one, so an older file keeps its visibility and position choices.
  settings.widget = reviveWidgetSettings(raw.widget)
  // The widget shortcut's earlier default (Ctrl+Alt+W) becomes the current one; a custom choice stays.
  settings.widgetShortcut = migrateWidgetShortcut(settings.widgetShortcut)
  // Reminder fields one by one too, so one bad value keeps the others.
  const reminders = isRecord(raw.reminders) ? raw.reminders : {}
  settings.reminders = { ...DEFAULT_REMINDER_SETTINGS }
  for (const key of Object.keys(DEFAULT_REMINDER_SETTINGS) as (keyof Settings['reminders'])[]) {
    if (!(key in reminders)) continue
    const candidate = { ...settings.reminders, [key]: reminders[key] }
    settings.reminders = tryOr(settings.reminders, () => validateReminderSettings(candidate))
  }
  return settings
}

export interface DataStoreOptions {
  directory: string
  now?: () => Date
  createId?: () => string
  /** process.platform by default; tests pass one to check the macOS default shortcut. */
  platform?: string
}

/**
 * Owns all persisted app data. Lives in the main process only; the renderer
 * reaches it through validated IPC calls. Writes are serialized.
 */
export class DataStore {
  readonly filePath: string
  private tasks: Task[] = []
  private completions: CompletionEvent[] = []
  private plans: Plan[] = []
  private habits: Habit[] = []
  private habitCheckins: HabitCheckin[] = []
  private planEvents: PlanEvents = { unlocked: [], revoked: [] }
  private readonly platform: string
  private settings: Settings
  private report: LoadReport | null = null
  private notice: StartupNotice | null = null
  /** The local day of the newest daily copy known to exist; checked before each write. */
  private backedUpDay: string | null = null
  private writeChain: Promise<void> = Promise.resolve()
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(options: DataStoreOptions) {
    this.filePath = path.join(options.directory, DATA_FILE_NAME)
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
    this.platform = options.platform ?? process.platform
    // A new profile (no data file yet) starts from the same defaults a file without settings gets.
    this.settings = reviveSettings(undefined, this.platform)
  }

  async load(): Promise<void> {
    let result = await readJson(this.filePath)
    // Valid JSON that is not a data object (e.g. `null` or a list) is as unreadable as broken JSON:
    // treating it as "no data" would overwrite it on the first change.
    if (result.kind === 'corrupt' || (result.kind === 'ok' && !isRecord(result.value))) {
      const quarantined = await quarantineFile(this.filePath)
      console.warn(`[DataStore] Unreadable data file moved to ${quarantined}`)
      const restoredFrom = await this.restoreNewestBackup()
      if (!restoredFrom) {
        this.notice = { kind: 'unrecoverable', quarantined }
        return
      }
      console.warn(`[DataStore] Restored data from ${restoredFrom}`)
      this.notice = { kind: 'recovered', quarantined, restoredFrom }
      result = await readJson(this.filePath)
    }
    if (result.kind !== 'ok' || !isRecord(result.value)) return
    const data = result.value
    const fromVersion = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1
    const rawTasks = Array.isArray(data.tasks) ? data.tasks : []
    const rawCompletions = Array.isArray(data.completions) ? data.completions : []
    const tasks = rawTasks.map(reviveTask).filter((task): task is Task => task !== null)
    const revived = rawCompletions.map(reviveCompletion).filter((e): e is CompletionEvent => e !== null)
    const { completions, created } = reconcile(tasks, revived)
    const rawPlans = Array.isArray(data.plans) ? data.plans : []
    const plans = rawPlans.map(revivePlan).filter((plan): plan is Plan => plan !== null)
    if (plans.length !== rawPlans.length) console.warn(`[DataStore] Dropped ${rawPlans.length - plans.length} unreadable plan(s)`)
    // A file without `habits` was written by a version before schema 5 (maybe after going back to
    // one): the mirror holds the habits that version could not keep.
    const habitSource = Array.isArray(data.habits) ? data : await this.readHabitsMirror()
    const habits = (Array.isArray(habitSource?.habits) ? habitSource.habits : [])
      .map(reviveHabit)
      .filter((h): h is Habit => h !== null)
    const rawCheckins = Array.isArray(habitSource?.habitCheckins) ? habitSource.habitCheckins : []
    const habitCheckins = reconcileCheckins(
      habits,
      rawCheckins.map(reviveHabitCheckin).filter((c): c is HabitCheckin => c !== null)
    )
    const restoredHabits = habitSource === data ? 0 : habits.length
    if (restoredHabits > 0) console.warn(`[DataStore] Restored ${restoredHabits} habit(s) from ${HABITS_MIRROR_FILE}`)

    // Check the result: every completed one-off task has exactly one counted completion, every other none.
    for (const task of tasks) {
      const counted = completions.filter((e) => e.taskId === task.id && e.occurrence === null && e.undoneAt === null)
      if (counted.length !== (task.status === 'completed' ? 1 : 0)) {
        console.error(`[DataStore] Completion check failed for task ${task.id}: ${counted.length} counted`)
      }
    }

    let backup: string | null = null
    const migrated = fromVersion !== SCHEMA_VERSION
    if (migrated) backup = await this.backupOriginal(fromVersion)
    if (fromVersion > SCHEMA_VERSION) {
      console.warn(`[DataStore] Data file is version ${fromVersion}, newer than this app (${SCHEMA_VERSION})`)
      this.notice ??= { kind: 'newer-version', version: fromVersion, backup }
    }
    await this.backupDaily()

    this.tasks = tasks
    this.completions = completions
    this.plans = plans
    this.habits = habits
    this.habitCheckins = habitCheckins
    this.settings = reviveSettings(data.settings, this.platform)
    // Bring unlock records in line with the records as loaded (e.g. after a crash); no notifications.
    this.syncPlans()
    this.planEvents = { unlocked: [], revoked: [] }
    this.report = {
      fromVersion,
      migrated,
      backup,
      createdCompletions: created,
      droppedTasks: rawTasks.length - tasks.length,
      droppedCompletions: rawCompletions.length - (completions.length - created),
      droppedPlans: rawPlans.length - plans.length,
      restoredHabits
    }
    if (migrated) {
      console.info(
        `[DataStore] Migrated data from version ${fromVersion} to ${SCHEMA_VERSION}: ` +
          `${tasks.length} tasks, ${created} completion records created, backup ${backup ?? 'not written'}`
      )
    }
  }

  /** Something the user must be told about the data file, found by `load`; null when all is well. */
  get startupNotice(): StartupNotice | null {
    return this.notice
  }

  /** For diagnostics and tests: what the last `load` found and changed. */
  get loadReport(): LoadReport | null {
    return this.report
  }

  listTasks(): Task[] {
    return this.tasks.map(copyTask)
  }

  listCompletions(): CompletionEvent[] {
    return this.completions.map((event) => ({ ...event }))
  }

  listPlans(): Plan[] {
    return this.plans.map(copyPlan)
  }

  listHabits(): Habit[] {
    return this.habits.map(copyHabit)
  }

  listHabitCheckins(): HabitCheckin[] {
    return this.habitCheckins.map((c) => ({ ...c }))
  }

  snapshot(): TaskSnapshot {
    return {
      tasks: this.listTasks(),
      completions: this.listCompletions(),
      plans: this.listPlans(),
      habits: this.listHabits(),
      habitCheckins: this.listHabitCheckins()
    }
  }

  async createHabit(input: Required<HabitInput>): Promise<Habit> {
    const nowDate = this.now()
    const now = nowDate.toISOString()
    const habit: Habit = {
      id: this.createId(),
      name: input.name,
      note: input.note,
      frequency: { ...input.frequency },
      startDate: dayKey(nowDate),
      state: 'active',
      pauses: [],
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    }
    this.habits.push(habit)
    await this.persist()
    return copyHabit(habit)
  }

  /** Name and note change only the habit; a new frequency is applied to its whole history. */
  async updateHabit(id: string, patch: HabitPatch): Promise<Habit> {
    const habit = this.findHabit(id)
    if (patch.name !== undefined) habit.name = patch.name
    if (patch.note !== undefined) habit.note = patch.note
    if (patch.frequency !== undefined) habit.frequency = { ...patch.frequency }
    habit.updatedAt = this.now().toISOString()
    await this.persist()
    return copyHabit(habit)
  }

  /**
   * Deletes a habit and its check-ins for good (the page asks first and offers archiving instead).
   * Returns the ids of its check-ins, so a milestone card still waiting can be withdrawn.
   */
  async deleteHabit(id: string): Promise<string[]> {
    this.findHabit(id)
    const removed = this.habitCheckins.filter((c) => c.habitId === id).map((c) => c.id)
    this.habits = this.habits.filter((h) => h.id !== id)
    this.habitCheckins = this.habitCheckins.filter((c) => c.habitId !== id)
    await this.persist()
    return removed
  }

  /** Pause, resume, archive or unarchive. An action that does not fit the habit's state changes nothing. */
  async setHabitState(id: string, action: HabitAction): Promise<Habit> {
    const habit = this.findHabit(id)
    const nowDate = this.now()
    const next = applyHabitAction(habit, action, dayKey(nowDate), nowDate.toISOString())
    if (!next) return copyHabit(habit)
    Object.assign(habit, next)
    await this.persist()
    return copyHabit(habit)
  }

  /**
   * Checks a habit in for `date` (the day the page showed). Only today can be checked in, or yesterday
   * in the first minutes after midnight; a paused or archived habit, a day before it started, or a day
   * that already has a check-in records nothing. Checked and recorded before any await, so repeated
   * clicks can never record a day twice.
   */
  async checkInHabit(id: string, date?: string | null): Promise<HabitCheckinResult> {
    const habit = this.findHabit(id)
    const nowDate = this.now()
    const day = acceptableCheckinDate(date ?? null, nowDate)
    const refused: HabitCheckinResult = { habit: copyHabit(habit), checkedIn: false, checkin: null, milestone: null, feedback: null }
    if (day === null || habit.state !== 'active' || day < habit.startDate || !isScheduled(habit, day)) return refused
    if (countedCheckinOn(this.habitCheckins, id, day)) return refused
    const today = dayKey(nowDate)
    const previous = [...this.habitCheckins]
    const checkin: HabitCheckin = { id: this.createId(), habitId: id, date: day, checkedAt: nowDate.toISOString(), undoneAt: null }
    this.habitCheckins.push(checkin)
    const feedback = habitCheckinFeedback(habit, previous, this.habitCheckins, checkin, today)
    await this.persist()
    return { habit: copyHabit(habit), checkedIn: true, checkin: { ...checkin }, milestone: feedback.milestone, feedback }
  }

  /**
   * Cancels a check-in: the record is kept and marked undone. Only a check-in for a day that could be
   * checked in again right now (today, or yesterday just after midnight) can be cancelled, so a past
   * day is never lost for good. Cancelling twice changes nothing.
   */
  async undoHabitCheckin(checkinId: string): Promise<HabitUndoResult> {
    const checkin = this.habitCheckins.find((c) => c.id === checkinId)
    const habit = checkin ? this.habits.find((h) => h.id === checkin.habitId) : undefined
    const result: HabitUndoResult = { habit: habit ? copyHabit(habit) : null, undone: false }
    if (!checkin || checkin.undoneAt !== null) return result
    const nowDate = this.now()
    if (acceptableCheckinDate(checkin.date, nowDate) === null) return result
    checkin.undoneAt = nowDate.toISOString()
    await this.persist()
    return { ...result, undone: true }
  }

  /** Plan achievements unlocked or withdrawn since the last call (each event is returned once). */
  takePlanEvents(): PlanEvents {
    const events = this.planEvents
    this.planEvents = { unlocked: [], revoked: [] }
    return events
  }

  /**
   * Creates a plan and the tasks of its goals in one write. A chain step's task is created later, when
   * the step before it is achieved. Nothing is unlocked here: unlocks only follow completions.
   */
  async createPlan(input: PlanInput): Promise<Plan> {
    const nowDate = this.now()
    const now = nowDate.toISOString()
    const today = dayKey(nowDate)
    const ids = new Map(input.goals.map((g) => [g.key, this.createId()]))
    const plan: Plan = {
      id: this.createId(),
      title: input.title,
      sourceText: input.sourceText,
      createdAt: now,
      updatedAt: now,
      goals: input.goals.map((g) => ({
        id: ids.get(g.key) as string,
        title: g.title,
        category: g.category,
        quantity: g.quantity,
        condition: g.condition,
        after: g.afterKey === null ? null : (ids.get(g.afterKey) as string),
        taskId: null,
        nodeTaskIds: [],
        startedOn: null,
        achievement: g.achievement
      })),
      master: input.master,
      unlocks: []
    }
    for (const goal of plan.goals) if (goal.after === null) this.startGoal(plan, goal, today)
    this.plans.push(plan)
    this.syncPlans()
    await this.persist()
    return copyPlan(plan)
  }

  /**
   * Deletes a plan and its achievements. Its tasks and their completion records stay, as ordinary tasks.
   * Returns the ids of its achievements that counted, so waiting notifications can be withdrawn.
   */
  async deletePlan(id: string): Promise<string[]> {
    const plan = this.plans.find((p) => p.id === id)
    if (!plan) throw new TaskNotFoundError(`Plan ${id} not found`)
    this.plans = this.plans.filter((p) => p.id !== id)
    await this.persist()
    return plan.unlocks.filter((u) => u.revokedAt === null).map((u) => u.id)
  }

  /**
   * Creates the task a goal is measured on (no write; the caller persists). An interval goal gets one
   * task per window, the windows placed from the current local time (to the minute): when the plan is
   * confirmed, or when the step before it is achieved.
   */
  private startGoal(plan: Plan, goal: Plan['goals'][number], today: string): void {
    if (goal.condition.kind === 'interval') {
      const nowDate = this.now()
      const start = goal.condition.start ?? new Date(floorToMinute(nowDate.getTime())).toISOString()
      goal.condition = { ...goal.condition, start }
      const created = nodeTaskInputs(plan, goal).map((input) => {
        const task = this.newTask(input.title, input.description, nowDate.toISOString())
        task.window = input.window
        this.tasks.push(task)
        return task.id
      })
      goal.nodeTaskIds = created
      goal.taskId = created[0] ?? null
      goal.startedOn = today
      return
    }
    const input = taskInputForGoal(plan, goal, today)
    const now = this.now().toISOString()
    const reminders = this.settings.reminders
    const task: Task = {
      id: this.createId(),
      title: input.title,
      description: input.description,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      status: 'active',
      timerConfig: null,
      themeOverride: null,
      recurrence: input.recurrence,
      recurrenceHistory: [],
      skippedOccurrences: [],
      ...deadlineFields(input.due, input.due && reminders.enabled ? reminders.defaultMinutes : null, !!input.recurrence),
      window: null
    }
    this.tasks.push(task)
    goal.taskId = task.id
    goal.startedOn = today
    // A chain step starts on the day it is unlocked; its window is counted from then.
    if (goal.condition.kind !== 'once' && goal.condition.startDate === null) {
      goal.condition = { ...goal.condition, startDate: today }
    }
  }

  /**
   * Applies the plan rules to the current records: starts chain steps whose previous step is achieved,
   * adds unlock records for newly met goals and plans, and revokes those no longer met. Runs
   * synchronously inside every change, before it is written, so records and file always agree.
   */
  private syncPlans(): void {
    const nowDate = this.now()
    const now = nowDate.toISOString()
    const today = dayKey(nowDate)
    for (const plan of this.plans) {
      let progress = evaluatePlan(plan, this.tasks, this.completions, today, nowDate.getTime())
      // Starting a step can never complete it, but loop in case a later step waits on it.
      for (let guard = 0; guard <= plan.goals.length; guard++) {
        const ready = goalsToStart(plan, progress)
        if (ready.length === 0) break
        for (const goal of ready) this.startGoal(plan, goal, today)
        plan.updatedAt = now
        progress = evaluatePlan(plan, this.tasks, this.completions, today, nowDate.getTime())
      }
      const changes = reconcileUnlocks(plan, progress, now, this.createId)
      if (changes.unlocked.length === 0 && changes.revoked.length === 0) continue
      plan.unlocks = changes.unlocks
      plan.updatedAt = now
      for (const unlock of changes.unlocked) this.planEvents.unlocked.push(this.unlockEvent(plan, unlock))
      for (const unlock of changes.revoked) {
        this.planEvents.unlocked = this.planEvents.unlocked.filter((e) => e.unlockId !== unlock.id)
        this.planEvents.revoked.push(unlock.id)
      }
    }
  }

  /** A plain one-off task in progress (plan nodes add their window). */
  private newTask(title: string, description: string, now: string): Task {
    return {
      id: this.createId(),
      title,
      description,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      status: 'active',
      timerConfig: null,
      themeOverride: null,
      recurrence: null,
      recurrenceHistory: [],
      skippedOccurrences: [],
      due: null,
      reminderMinutes: null,
      window: null
    }
  }

  private unlockEvent(plan: Plan, unlock: PlanUnlock): PlanUnlockEvent {
    const goal = plan.goals.find((g) => g.id === unlock.target)
    const isPlan = unlock.target === PLAN_TARGET
    return {
      unlockId: unlock.id,
      planId: plan.id,
      planTitle: plan.title,
      kind: isPlan ? 'plan' : 'goal',
      name: isPlan ? (plan.master?.name ?? plan.title) : (goal?.achievement.name ?? '')
    }
  }

  getSettings(): Settings {
    return { ...this.settings }
  }

  async createTask(
    input: Omit<ValidTaskInput, 'recurrence' | 'due' | 'reminderMinutes'> &
      Partial<Pick<ValidTaskInput, 'recurrence' | 'due' | 'reminderMinutes'>>
  ): Promise<Task> {
    const now = this.now().toISOString()
    const recurrence = input.recurrence ?? null
    const task: Task = {
      id: this.createId(),
      title: input.title,
      description: input.description,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      status: 'active',
      // A countdown runs once, so a repeating task has none.
      timerConfig:
        input.timerDurationSec && !recurrence
          ? { kind: 'countdown', durationSec: input.timerDurationSec, startedAt: now }
          : null,
      themeOverride: input.themeOverride,
      recurrence,
      recurrenceHistory: [],
      skippedOccurrences: [],
      ...deadlineFields(input.due ?? null, input.reminderMinutes ?? null, !!recurrence),
      window: null
    }
    this.tasks.push(task)
    await this.persist()
    return copyTask(task)
  }

  async updateTask(id: string, patch: TaskPatch): Promise<Task> {
    const task = this.find(id)
    const now = this.now().toISOString()
    if (patch.title !== undefined) task.title = patch.title
    if (patch.description !== undefined) task.description = patch.description
    if (patch.themeOverride !== undefined) task.themeOverride = patch.themeOverride
    if (patch.timerDurationSec !== undefined) {
      const duration = patch.timerDurationSec
      if (duration === null) {
        task.timerConfig = null
      } else if (!task.timerConfig || task.timerConfig.durationSec !== duration || patch.restartTimer) {
        task.timerConfig = { kind: 'countdown', durationSec: duration, startedAt: now }
      }
    } else if (patch.restartTimer && task.timerConfig) {
      task.timerConfig = { ...task.timerConfig, startedAt: now }
    }
    // A plan node's time window is its rule: it never repeats and has no separate deadline.
    if (task.window && (patch.recurrence || patch.due)) {
      throw new ValidationError('A timed plan step cannot repeat or have a deadline')
    }
    if (patch.recurrence !== undefined && !sameRule(patch.recurrence, task.recurrence)) {
      if (task.status === 'completed' && patch.recurrence) {
        throw new ValidationError('Restore a completed task before making it repeat')
      }
      Object.assign(task, applyRuleChange(task, patch.recurrence, dayKey(this.now())))
    }
    if (task.recurrence) task.timerConfig = null
    Object.assign(
      task,
      deadlineFields(
        patch.due !== undefined ? patch.due : task.due,
        patch.reminderMinutes !== undefined ? patch.reminderMinutes : task.reminderMinutes,
        !!task.recurrence
      )
    )
    task.updatedAt = now
    this.syncPlans()
    await this.persist()
    return copyTask(task)
  }

  /**
   * Deletes the task and its completion records, as before completion records existed. A plan goal
   * measured on it can no longer be achieved; its achievements are withdrawn, the plan is kept.
   */
  async deleteTask(id: string): Promise<void> {
    this.find(id)
    this.tasks = this.tasks.filter((task) => task.id !== id)
    this.completions = this.completions.filter((event) => event.taskId !== id)
    this.syncPlans()
    await this.persist()
  }

  /**
   * Marks a task (or one occurrence of a repeating task) completed and records the completion.
   * The checks and the change happen synchronously before any await, so repeated calls can never
   * unlock the same task or occurrence twice.
   *
   * For a repeating task `occurrence` is the date the page showed. Only today's occurrence can be
   * completed, or yesterday's in the first minutes after midnight (the click raced the date change).
   * Missed days are never completed for the user.
   *
   * A plan node with a time window can only be completed while its window is open (by the clock at
   * the moment of the click); before it opens, or once it has closed, nothing is recorded.
   */
  async completeTask(id: string, occurrence?: string | null): Promise<CompleteTaskResult> {
    const task = this.find(id)
    const nowDate = this.now()
    const now = nowDate.toISOString()
    let date: string | null = null
    if (task.recurrence) {
      const today = dayKey(nowDate)
      date = occurrence ?? today
      const justAfterMidnight = nowDate.getHours() === 0 && nowDate.getMinutes() < MIDNIGHT_GRACE_MIN
      const allowed = date === today || (justAfterMidnight && date === addDays(today, -1))
      const taken = this.completions.some((e) => e.taskId === id && e.occurrence === date && e.undoneAt === null)
      if (!allowed || !occursOn(task, date) || taken) return { task: copyTask(task), unlocked: false, event: null }
    } else {
      if (task.status === 'completed' || !isWindowOpen(task, nowDate.getTime())) {
        return { task: copyTask(task), unlocked: false, event: null }
      }
      task.status = 'completed'
      task.completedAt = now
      task.updatedAt = now
    }
    const event: CompletionEvent = {
      id: this.createId(),
      taskId: task.id,
      occurrence: date,
      completedAt: now,
      undoneAt: null,
      title: task.title
    }
    this.completions.push(event)
    this.syncPlans()
    await this.persist()
    return { task: copyTask(task), unlocked: true, event: { ...event } }
  }

  /**
   * Undoes one completion: the record is kept and marked undone, and the task goes back to
   * in progress. Only that completion's achievement is withdrawn. Undoing twice changes nothing.
   */
  async undoCompletion(eventId: string): Promise<UndoCompletionResult> {
    const event = this.completions.find((e) => e.id === eventId)
    const task = event ? this.tasks.find((t) => t.id === event.taskId) : undefined
    if (!event || event.undoneAt !== null) return { task: task ? copyTask(task) : null, undone: false }
    const now = this.now().toISOString()
    event.undoneAt = now
    if (task && event.occurrence === null) {
      task.status = 'active'
      task.completedAt = null
      task.updatedAt = now
    }
    this.syncPlans()
    await this.persist()
    return { task: task ? copyTask(task) : null, undone: true }
  }

  /** "Skip this time" for one occurrence of a repeating task, or undo that. The series is unchanged. */
  async skipOccurrence(id: string, date: string, skip: boolean): Promise<Task> {
    const task = this.find(id)
    if (!task.recurrence || !plannedOn(task, date)) throw new ValidationError('No occurrence on that date')
    if (date < dayKey(this.now())) throw new ValidationError('Past occurrences cannot be skipped')
    const has = task.skippedOccurrences.includes(date)
    if (skip === has) return copyTask(task)
    if (skip && this.completions.some((e) => e.taskId === id && e.occurrence === date && e.undoneAt === null)) {
      throw new ValidationError('That occurrence is already completed')
    }
    task.skippedOccurrences = skip
      ? [...task.skippedOccurrences, date].sort()
      : task.skippedOccurrences.filter((d) => d !== date)
    task.updatedAt = this.now().toISOString()
    this.syncPlans()
    await this.persist()
    return copyTask(task)
  }

  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    this.settings = { ...this.settings, ...patch }
    await this.persist()
    return this.getSettings()
  }

  /** Resolves once every queued write has reached disk. */
  flush(): Promise<void> {
    return this.writeChain
  }

  private findHabit(id: string): Habit {
    const habit = this.habits.find((h) => h.id === id)
    if (!habit) throw new TaskNotFoundError(`Habit ${id} not found`)
    return habit
  }

  private async readHabitsMirror(): Promise<Record<string, unknown> | null> {
    const result = await readJson(path.join(path.dirname(this.filePath), HABITS_MIRROR_FILE)).catch(() => null)
    return result?.kind === 'ok' && isRecord(result.value) ? result.value : null
  }

  private find(id: string): Task {
    const task = this.tasks.find((t) => t.id === id)
    if (!task) throw new TaskNotFoundError(`Task ${id} not found`)
    return task
  }

  /**
   * Keeps the file exactly as it was before migrating. An existing backup is never replaced: when one
   * with that name already exists and differs (e.g. migrating again after going back to an older
   * version), this copy gets its own time-stamped name next to it.
   */
  private async backupOriginal(fromVersion: number): Promise<string | null> {
    const target = path.join(path.dirname(this.filePath), backupFileName(fromVersion))
    try {
      await fs.copyFile(this.filePath, target, fs.constants.COPYFILE_EXCL)
      return target
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        console.error('[DataStore] Could not back up data before migrating', error)
        return null
      }
    }
    try {
      const [current, existing] = await Promise.all([fs.readFile(this.filePath), fs.readFile(target)])
      if (current.equals(existing)) return target
      const stamp = this.now().toISOString().replace(/[:.]/g, '-')
      const extra = target.replace(/\.json$/, `-${stamp}.json`)
      await fs.copyFile(this.filePath, extra, fs.constants.COPYFILE_EXCL)
      return extra
    } catch (error) {
      console.error('[DataStore] Could not back up data before migrating', error)
      return target
    }
  }

  private get backupDir(): string {
    return path.join(path.dirname(this.filePath), BACKUP_DIR)
  }

  /**
   * Once per local day, before the first change of that day, copies the data file as it is into
   * `backups/` (the state the previous day ended with). Only the newest KEEP_BACKUPS copies are kept.
   * A failed backup is logged and never stops the write.
   */
  private async backupDaily(): Promise<void> {
    const today = dayKey(this.now())
    if (this.backedUpDay === today) return
    try {
      await fs.mkdir(this.backupDir, { recursive: true })
      await fs.copyFile(this.filePath, path.join(this.backupDir, dailyBackupName(today)), fs.constants.COPYFILE_EXCL)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // ENOENT: nothing saved yet. EEXIST: today's copy is already there.
      if (code !== 'ENOENT' && code !== 'EEXIST') {
        console.error('[DataStore] Daily backup failed', error)
        return
      }
      if (code === 'ENOENT') return
    }
    this.backedUpDay = today
    try {
      const copies = (await fs.readdir(this.backupDir)).filter((f) => DAILY_BACKUP.test(f)).sort()
      for (const old of copies.slice(0, Math.max(0, copies.length - KEEP_BACKUPS))) {
        await fs.rm(path.join(this.backupDir, old), { force: true })
      }
    } catch (error) {
      console.error('[DataStore] Could not tidy old backups', error)
    }
  }

  /** Puts the newest readable daily copy in place of the data file. Returns the copy used, or null. */
  private async restoreNewestBackup(): Promise<string | null> {
    let copies: string[]
    try {
      copies = (await fs.readdir(this.backupDir)).filter((f) => DAILY_BACKUP.test(f)).sort().reverse()
    } catch {
      return null
    }
    for (const name of copies) {
      const source = path.join(this.backupDir, name)
      const candidate = await readJson(source).catch(() => ({ kind: 'corrupt' as const }))
      if (candidate.kind !== 'ok' || !isRecord(candidate.value)) continue
      try {
        await fs.copyFile(source, this.filePath)
        return source
      } catch (error) {
        console.error('[DataStore] Could not restore backup', error)
        return null
      }
    }
    return null
  }

  private persist(): Promise<void> {
    const snapshot: PersistedData = {
      schemaVersion: SCHEMA_VERSION,
      tasks: this.listTasks(),
      completions: this.listCompletions(),
      plans: this.listPlans(),
      habits: this.listHabits(),
      habitCheckins: this.listHabitCheckins(),
      settings: this.getSettings()
    }
    const write = this.writeChain.then(async () => {
      await this.backupDaily()
      await writeJsonAtomic(this.filePath, snapshot)
      // Kept current once it exists, also after the last habit is deleted: a stale copy must never
      // bring deleted habits back.
      const mirror = path.join(path.dirname(this.filePath), HABITS_MIRROR_FILE)
      const mirrorExists = await fs.access(mirror).then(
        () => true,
        () => false
      )
      if (snapshot.habits.length > 0 || mirrorExists) {
        await writeJsonAtomic(mirror, {
          schemaVersion: SCHEMA_VERSION,
          habits: snapshot.habits,
          habitCheckins: snapshot.habitCheckins
        })
      }
    })
    // Keep the chain alive after a failed write; the caller still sees the error.
    this.writeChain = write.catch((error) => console.error('[DataStore] Write failed', error))
    return write
  }
}
