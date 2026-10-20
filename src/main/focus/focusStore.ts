import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dayKey } from '../../shared/dates'
import {
  DEFAULT_FOCUS_DURATIONS,
  INITIAL_FOCUS_STATE,
  isRunDue,
  newRun,
  pauseRun,
  reanchorRun,
  resumeRun,
  runDueAt,
  sessionFor,
  stateAfter
} from '../../shared/focus/timer'
import type {
  FocusDurations,
  FocusOrigin,
  PlanFocusInput,
  FocusFinished,
  FocusPhase,
  FocusSelection,
  FocusSession,
  FocusSnapshot,
  FocusTimerState
} from '../../shared/focus/types'
import { reviveFocusDurations, reviveFocusSessions, reviveFocusState, revivePlanTargets, validatePlanFocus } from '../../shared/focus/validation'
import { quarantineFile, readJson, writeJsonAtomic } from '../storage/jsonFile'
import { BACKUP_DIR, KEEP_BACKUPS } from '../storage/dataStore'

/**
 * The focus timer's own file (Phase 6.7), next to the data file. The main data file and its schema
 * stay exactly as they were: an older version of the app never reads or writes this file, so going
 * back and forth between versions keeps both intact (see docs/data-migration.md).
 */
export const FOCUS_FILE_NAME = 'life-unlocked-focus.json'
export const FOCUS_FILE_VERSION = 1
const DAILY_COPY = /^life-unlocked-focus-(\d{4}-\d{2}-\d{2})\.json$/

interface FocusFile {
  planTargets?: PlanFocusInput[]
  version: number
  durations: FocusDurations
  state: FocusTimerState
  sessions: FocusSession[]
}

export interface FocusStoreOptions {
  directory: string
  now?: () => number
  createId?: () => string
}

/**
 * Owns the focus timer and its records in the main process. Every change is decided synchronously
 * before any await (so a double click or a tick racing a click can never record a run twice) and
 * written atomically, one write after the other.
 */
export class FocusStore {
  readonly filePath: string
  private durations: FocusDurations = { ...DEFAULT_FOCUS_DURATIONS }
  private state: FocusTimerState = { ...INITIAL_FOCUS_STATE }
  private sessions: FocusSession[] = []
  private planTargets: PlanFocusInput[] = []
  private backedUpDay: string | null = null
  private writeChain: Promise<void> = Promise.resolve()
  /** Set by `load` when the file could not be read and was kept aside. */
  quarantined: string | null = null
  private readonly now: () => number
  private readonly createId: () => string

  constructor(options: FocusStoreOptions) {
    this.filePath = path.join(options.directory, FOCUS_FILE_NAME)
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
  }

  /**
   * Reads the file. An unreadable one is kept aside (never overwritten) and the timer starts empty;
   * tasks, habits and every other data are not involved. A run whose clock was set back while the app
   * was closed is re-based on the current time, so it never shows more than it had left.
   */
  async load(): Promise<void> {
    const result = await readJson(this.filePath).catch(() => ({ kind: 'corrupt' as const }))
    if (result.kind === 'corrupt' || (result.kind === 'ok' && (typeof result.value !== 'object' || result.value === null))) {
      this.quarantined = await quarantineFile(this.filePath).catch(() => null)
      console.warn(`[Focus] Unreadable focus file kept aside as ${this.quarantined ?? '(could not move)'}`)
      return
    }
    if (result.kind !== 'ok') return
    const data = result.value as Record<string, unknown>
    this.durations = reviveFocusDurations(data.durations)
    this.sessions = reviveFocusSessions(data.sessions)
    this.planTargets = revivePlanTargets(data.planTargets)
    this.state = reviveFocusState(data.state)
    const run = this.state.run
    // A run already recorded (crash between the two, hand edits) is not run again.
    if (run && this.sessions.some((s) => s.id === run.id)) this.state = stateAfter(this.state, run, 'completed')
    const now = this.now()
    if (this.state.run?.resumedAt && Date.parse(this.state.run.resumedAt) > now) {
      this.state = { ...this.state, run: reanchorRun(this.state.run, now, 0) }
    }
  }

  snapshot(): FocusSnapshot {
    return {
      state: structuredClone(this.state),
      sessions: structuredClone(this.sessions),
      durations: { ...this.durations },
      planTargets: structuredClone(this.planTargets)
    }
  }

  /** Starts a run of `phase`; refused (nothing changes) while another run exists. */
  async start(phase: FocusPhase, task: { id: string; title: string } | null, origin?: FocusOrigin): Promise<boolean> {
    if (this.state.run) return false
    const run = newRun(this.createId(), phase, task, this.durations, this.now())
    if (phase === 'focus' && task && origin) run.origin = { ...origin }
    this.state = { ...this.state, run, taskId: phase === 'focus' ? run.taskId : this.state.taskId }
    await this.persist()
    return true
  }

  async pause(runId: string): Promise<boolean> {
    const run = this.state.run
    if (!run || run.id !== runId || run.resumedAt === null) return false
    // Time already up: the tick records it as completed instead of pausing a finished run.
    if (isRunDue(run, this.now())) return false
    this.state = { ...this.state, run: pauseRun(run, this.now()) }
    await this.persist()
    return true
  }

  async resume(runId: string): Promise<boolean> {
    const run = this.state.run
    if (!run || run.id !== runId || run.resumedAt !== null) return false
    this.state = { ...this.state, run: resumeRun(run, this.now()) }
    await this.persist()
    return true
  }

  /**
   * Ends the run before its time is up. A focus of at least MIN_RECORDED_SEC is recorded as
   * 'ended-early' with the time actually focused; a break, or a shorter focus, leaves no record.
   * A run whose time is already up is recorded as completed instead (the tick may be a moment late).
   */
  async end(runId: string): Promise<{ ended: boolean; session: FocusSession | null }> {
    const run = this.state.run
    if (!run || run.id !== runId) return { ended: false, session: null }
    const now = this.now()
    if (isRunDue(run, now)) {
      const finished = this.finishDueSync(now)
      await this.persist()
      return { ended: true, session: finished?.session ?? null }
    }
    const session = sessionFor(run, 'ended-early', now)
    if (session && !this.sessions.some((s) => s.id === session.id)) this.sessions.push(session)
    this.state = stateAfter(this.state, run, 'ended-early')
    await this.persist()
    return { ended: true, session }
  }

  /** Throws the run away: no record, back to the full length of the same phase. */
  async reset(runId: string): Promise<boolean> {
    const run = this.state.run
    if (!run || run.id !== runId) return false
    this.state = stateAfter(this.state, run, 'reset')
    await this.persist()
    return true
  }

  /** Chooses the next phase or task while no run exists; refused during a run. */
  async select(selection: FocusSelection): Promise<boolean> {
    if (this.state.run) return false
    this.state = {
      ...this.state,
      ...(selection.phase ? { nextPhase: selection.phase } : {}),
      ...(selection.taskId !== undefined ? { taskId: selection.taskId } : {})
    }
    await this.persist()
    return true
  }

  /** New lengths apply from the next start; a run in progress keeps its own. */
  async setDurations(durations: FocusDurations): Promise<void> {
    this.durations = { ...durations }
    await this.persist()
  }

  async setPlanTargets(input: PlanFocusInput): Promise<void> {
    const target = validatePlanFocus(input)
    this.planTargets = [...this.planTargets.filter(p => p.planId !== target.planId), target]
    await this.persist()
  }

  /**
   * The system time changed: the running stretch is re-based on `now`, counting `creditMs` (the time
   * that really passed since the last trusted moment). No-op while paused or idle.
   */
  async reanchor(creditMs: number): Promise<boolean> {
    const run = this.state.run
    if (!run || run.resumedAt === null) return false
    this.state = { ...this.state, run: reanchorRun(run, this.now(), creditMs) }
    await this.persist()
    return true
  }

  /**
   * Records a running run whose time is up, once: a focus becomes a 'completed' record ending at the
   * moment its time was up (also when that was while the app was closed or the PC asleep), and the
   * timer moves on to the next phase. Returns null when nothing was due.
   */
  async finishDue(): Promise<FocusFinished | null> {
    const finished = this.finishDueSync(this.now())
    if (finished) await this.persist()
    return finished
  }

  /** The running run, for the tick. */
  get running(): boolean {
    return this.state.run?.resumedAt != null
  }

  flush(): Promise<void> {
    return this.writeChain
  }

  private finishDueSync(now: number): FocusFinished | null {
    const run = this.state.run
    if (!run || !isRunDue(run, now)) return null
    const endedAt = Math.min(now, runDueAt(run))
    const session = sessionFor(run, 'completed', endedAt)
    const fresh = session && !this.sessions.some((s) => s.id === session.id) ? session : null
    if (fresh) this.sessions.push(fresh)
    this.state = stateAfter(this.state, run, 'completed')
    return { run, session: fresh, endedAt: new Date(endedAt).toISOString() }
  }

  private get backupDir(): string {
    return path.join(path.dirname(this.filePath), BACKUP_DIR)
  }

  /** Once a day, before the first change, the file as it was goes to `backups/` (newest KEEP_BACKUPS kept). */
  private async backupDaily(): Promise<void> {
    const today = dayKey(new Date(this.now()))
    if (this.backedUpDay === today) return
    try {
      await fs.mkdir(this.backupDir, { recursive: true })
      await fs.copyFile(this.filePath, path.join(this.backupDir, `life-unlocked-focus-${today}.json`), fs.constants.COPYFILE_EXCL)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return
      if (code !== 'EEXIST') {
        console.error('[Focus] Daily backup failed', error)
        return
      }
    }
    this.backedUpDay = today
    try {
      const copies = (await fs.readdir(this.backupDir)).filter((f) => DAILY_COPY.test(f)).sort()
      for (const old of copies.slice(0, Math.max(0, copies.length - KEEP_BACKUPS))) {
        await fs.rm(path.join(this.backupDir, old), { force: true })
      }
    } catch (error) {
      console.error('[Focus] Could not tidy old backups', error)
    }
  }

  private persist(): Promise<void> {
    const data: FocusFile = { version: FOCUS_FILE_VERSION, ...this.snapshot() }
    const write = this.writeChain.then(async () => {
      await this.backupDaily()
      await writeJsonAtomic(this.filePath, data)
    })
    this.writeChain = write.catch((error) => console.error('[Focus] Write failed', error))
    return write
  }
}
