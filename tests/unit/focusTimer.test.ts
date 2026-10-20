import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FocusService } from '../../src/main/focus/focusService'
import { FOCUS_FILE_NAME, FocusStore } from '../../src/main/focus/focusStore'
import { createTranslator } from '../../src/shared/i18n'
import { focusCardText } from '../../src/shared/focus/notify'
import {
  clockJumpCredit,
  DEFAULT_FOCUS_DURATIONS,
  focusedOnTask,
  focusToday,
  INITIAL_FOCUS_STATE,
  isRunDue,
  newRun,
  pauseRun,
  reanchorRun,
  resumeRun,
  runDueAt,
  runElapsedMs,
  runRemainingMs,
  sessionFor,
  stateAfter
} from '../../src/shared/focus/timer'
import type { FocusFinished, FocusSession } from '../../src/shared/focus/types'
import { reviveFocusSessions, reviveFocusState, validateFocusDurations } from '../../src/shared/focus/validation'

const T0 = Date.parse('2026-10-17T09:00:00.000Z')
const MIN = 60_000

describe('focus timer rules', () => {
  it('counts from timestamps: running, paused and resumed', () => {
    let run = newRun('r1', 'focus', { id: 't1', title: 'Write' }, DEFAULT_FOCUS_DURATIONS, T0)
    expect(run.plannedSec).toBe(25 * 60)
    expect(runRemainingMs(run, T0 + 10 * MIN)).toBe(15 * MIN)
    run = pauseRun(run, T0 + 10 * MIN)
    // Paused: an hour later nothing more has been counted.
    expect(runRemainingMs(run, T0 + 70 * MIN)).toBe(15 * MIN)
    expect(isRunDue(run, T0 + 999 * MIN)).toBe(false)
    run = resumeRun(run, T0 + 70 * MIN)
    expect(runRemainingMs(run, T0 + 80 * MIN)).toBe(5 * MIN)
    expect(runDueAt(run)).toBe(T0 + 85 * MIN)
    expect(isRunDue(run, T0 + 85 * MIN)).toBe(true)
  })

  it('never goes negative or past the planned length', () => {
    const run = newRun('r1', 'focus', null, DEFAULT_FOCUS_DURATIONS, T0)
    // Clock set back before the start: no time counted, never more than planned left.
    expect(runElapsedMs(run, T0 - 60 * MIN)).toBe(0)
    expect(runRemainingMs(run, T0 - 60 * MIN)).toBe(25 * MIN)
    expect(runRemainingMs(run, T0 + 600 * MIN)).toBe(0)
    expect(runElapsedMs(run, T0 + 600 * MIN)).toBe(25 * MIN)
  })

  it('re-bases a running stretch on a changed clock, counting only the credited time', () => {
    const run = newRun('r1', 'focus', null, DEFAULT_FOCUS_DURATIONS, T0)
    // 4 minutes really passed, then the clock jumped back an hour.
    const moved = reanchorRun(run, T0 - 56 * MIN, 4 * MIN)
    expect(runRemainingMs(moved, T0 - 56 * MIN)).toBe(21 * MIN)
    expect(runRemainingMs(moved, T0 - 46 * MIN)).toBe(11 * MIN)
  })

  it('tells a change of the system time from sleep', () => {
    const last = { wall: T0, mono: 1000 }
    expect(clockJumpCredit(last, { wall: T0 + 500, mono: 1500 }, false)).toBeNull()
    // Set forward by an hour within half a second: only the half second counts.
    expect(clockJumpCredit(last, { wall: T0 + 3_600_500, mono: 1500 }, false)).toBe(500)
    // Set back.
    expect(clockJumpCredit(last, { wall: T0 - 3_600_000, mono: 1500 }, false)).toBe(500)
    // After sleep: a forward difference is real time away; a backward one counts as nothing.
    expect(clockJumpCredit(last, { wall: T0 + 3_600_000, mono: 1500 }, true)).toBeNull()
    expect(clockJumpCredit(last, { wall: T0 - 3_600_000, mono: 1500 }, true)).toBe(0)
  })

  it('records a completed focus in full and an early end with the time focused', () => {
    const run = newRun('r1', 'focus', { id: 't1', title: 'Write' }, DEFAULT_FOCUS_DURATIONS, T0)
    expect(sessionFor(run, 'completed', T0 + 25 * MIN)).toMatchObject({ id: 'r1', focusedSec: 1500, outcome: 'completed', taskId: 't1' })
    expect(sessionFor(run, 'ended-early', T0 + 12 * MIN + 30_000)).toMatchObject({ focusedSec: 750, outcome: 'ended-early' })
    // Under a minute: an accidental start, no record. Breaks are never recorded.
    expect(sessionFor(run, 'ended-early', T0 + 59_000)).toBeNull()
    expect(sessionFor(newRun('b', 'short-break', null, DEFAULT_FOCUS_DURATIONS, T0), 'completed', T0 + 5 * MIN)).toBeNull()
  })

  it('offers a long break after every fourth completed focus, back to focus after a break', () => {
    let state = { ...INITIAL_FOCUS_STATE }
    const focus = newRun('f', 'focus', { id: 't1', title: 'x' }, DEFAULT_FOCUS_DURATIONS, T0)
    const phases: string[] = []
    for (let i = 0; i < 4; i++) {
      state = stateAfter(state, focus, 'completed')
      phases.push(state.nextPhase)
    }
    expect(phases).toEqual(['short-break', 'short-break', 'short-break', 'long-break'])
    expect(state.taskId).toBe('t1')
    expect(stateAfter(state, newRun('b', 'long-break', null, DEFAULT_FOCUS_DURATIONS, T0), 'completed').nextPhase).toBe('focus')
    // Ending a focus early earns no break; a reset keeps the phase.
    expect(stateAfter(state, focus, 'ended-early')).toMatchObject({ nextPhase: 'focus', cycle: 0 })
    expect(stateAfter(state, newRun('b', 'short-break', null, DEFAULT_FOCUS_DURATIONS, T0), 'reset').nextPhase).toBe('short-break')
  })

  it('sums today and per task, each record once', () => {
    const day = new Date(2026, 9, 17, 15).getTime()
    const s = (id: string, endedAt: number, focusedSec: number, outcome: FocusSession['outcome'], taskId: string | null = 't1'): FocusSession => ({
      id,
      taskId,
      taskTitle: '',
      plannedSec: 1500,
      focusedSec,
      startedAt: new Date(endedAt - focusedSec * 1000).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      outcome
    })
    const list = [s('a', day, 1500, 'completed'), s('b', day + MIN, 600, 'ended-early'), s('c', day - 24 * 60 * MIN, 1500, 'completed', null)]
    expect(focusToday(list, day + 2 * MIN)).toMatchObject({ focusedSec: 2100, completed: 1 })
    expect(focusToday(list, day + 2 * MIN).sessions.map((x) => x.id)).toEqual(['b', 'a'])
    expect(focusedOnTask(list, 't1')).toBe(2100)
  })

  it('validates durations and drops broken or duplicate records from disk', () => {
    expect(validateFocusDurations({ focusMin: 50, shortBreakMin: 10, longBreakMin: 30 })).toEqual({ focusMin: 50, shortBreakMin: 10, longBreakMin: 30 })
    expect(() => validateFocusDurations({ focusMin: 0, shortBreakMin: 5, longBreakMin: 15 })).toThrow()
    expect(() => validateFocusDurations({ focusMin: 25.5, shortBreakMin: 5, longBreakMin: 15 })).toThrow()
    expect(() => validateFocusDurations({ focusMin: 25, shortBreakMin: 5, longBreakMin: 15, x: 1 })).toThrow()
    const good = { id: 'a', taskId: null, taskTitle: '', plannedSec: 1500, focusedSec: 9999, startedAt: '2026-10-17T09:00:00Z', endedAt: '2026-10-17T09:25:00Z', outcome: 'completed' }
    const sessions = reviveFocusSessions([good, { ...good }, { ...good, id: 'b', outcome: 'nope' }, null])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.focusedSec).toBe(1500)
    expect(reviveFocusState({ run: { id: 'x', phase: 'focus', plannedSec: 5, startedAt: 'bad' }, cycle: 9 })).toEqual(INITIAL_FOCUS_STATE)
  })

  it('words the end-of-focus card from the run', () => {
    const t = createTranslator('zh-CN')
    const run = newRun('r1', 'focus', { id: 't1', title: '写报告' }, DEFAULT_FOCUS_DURATIONS, T0)
    const finished = (r: typeof run): FocusFinished => ({ run: r, session: null, endedAt: new Date(T0).toISOString() })
    expect(focusCardText(finished(run), t)).toEqual({ heading: '专注完成', taskTitle: '写报告 · 25 分钟', titleSuffix: ' · 25 分钟' })
    expect(focusCardText(finished({ ...run, taskTitle: '' }), t)).toEqual({ heading: '专注完成', taskTitle: '25 分钟专注' })
    expect(focusCardText(finished(newRun('b', 'short-break', null, DEFAULT_FOCUS_DURATIONS, T0)), t).heading).toBe('休息结束')
  })
})

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'lu-focus-'))
}

function clockStore(directory: string, start = T0): { store: FocusStore; clock: { now: number } } {
  const clock = { now: start }
  let n = 0
  const store = new FocusStore({ directory, now: () => clock.now, createId: () => `run-${++n}` })
  return { store, clock }
}

describe('FocusStore', () => {
  it('runs start → pause → resume → complete once, and keeps it across a restart', async () => {
    const dir = await tempDir()
    const { store, clock } = clockStore(dir)
    await store.load()
    expect(await store.start('focus', { id: 't1', title: 'Write' })).toBe(true)
    // A second start while running is refused.
    expect(await store.start('focus', null)).toBe(false)
    const runId = store.snapshot().state.run?.id as string
    clock.now += 10 * MIN
    expect(await store.pause(runId)).toBe(true)
    clock.now += 30 * MIN
    expect(await store.resume(runId)).toBe(true)
    // Stale ids change nothing.
    expect(await store.pause('other')).toBe(false)
    clock.now += 15 * MIN
    const [a, b] = await Promise.all([store.finishDue(), store.finishDue()])
    expect(a?.session).toMatchObject({ id: runId, focusedSec: 1500, outcome: 'completed', taskId: 't1' })
    expect(b).toBeNull()
    expect(await store.finishDue()).toBeNull()
    expect(store.snapshot().state).toMatchObject({ run: null, nextPhase: 'short-break', taskId: 't1', cycle: 1 })
    await store.flush()

    const reloaded = clockStore(dir, clock.now).store
    await reloaded.load()
    expect(reloaded.snapshot().sessions).toHaveLength(1)
    expect(reloaded.snapshot().state.nextPhase).toBe('short-break')
  })

  it('records a run that ran out while the app was closed at the moment it ran out', async () => {
    const dir = await tempDir()
    const { store, clock } = clockStore(dir)
    await store.load()
    await store.start('focus', null)
    clock.now += 5 * MIN
    await store.flush()
    // "Quit", come back three hours later.
    const later = clockStore(dir, clock.now + 180 * MIN).store
    await later.load()
    const finished = await later.finishDue()
    expect(finished?.endedAt).toBe(new Date(T0 + 25 * MIN).toISOString())
    expect(finished?.session?.endedAt).toBe(new Date(T0 + 25 * MIN).toISOString())
    expect(await later.finishDue()).toBeNull()
  })

  it('a paused run stays paused across a restart; a clock set back while closed never adds time', async () => {
    const dir = await tempDir()
    const { store, clock } = clockStore(dir)
    await store.load()
    await store.start('focus', null)
    clock.now += 10 * MIN
    await store.flush()
    // Reopened with the clock an hour behind: the run is re-based, 15 minutes left, not 75.
    const back = clockStore(dir, T0 - 50 * MIN).store
    await back.load()
    const run = back.snapshot().state.run
    expect(run?.resumedAt).toBe(new Date(T0 - 50 * MIN).toISOString())
    expect(runRemainingMs(run!, T0 - 50 * MIN)).toBe(25 * MIN)
    await back.pause(run!.id)
    await back.flush()
    const again = clockStore(dir, T0 + 999 * MIN).store
    await again.load()
    expect(again.snapshot().state.run?.resumedAt).toBeNull()
    expect(await again.finishDue()).toBeNull()
  })

  it('ending early records the time focused (1 minute or more); reset records nothing', async () => {
    const dir = await tempDir()
    const { store, clock } = clockStore(dir)
    await store.load()
    await store.start('focus', { id: 't1', title: 'Write' })
    let runId = store.snapshot().state.run!.id
    clock.now += 7 * MIN + 20_000
    const ended = await store.end(runId)
    expect(ended.session).toMatchObject({ outcome: 'ended-early', focusedSec: 440 })
    expect(await store.end(runId)).toEqual({ ended: false, session: null })
    await store.start('focus', null)
    runId = store.snapshot().state.run!.id
    clock.now += 30_000
    expect((await store.end(runId)).session).toBeNull()
    await store.start('focus', null)
    runId = store.snapshot().state.run!.id
    clock.now += 20 * MIN
    expect(await store.reset(runId)).toBe(true)
    expect(store.snapshot().sessions).toHaveLength(1)
    expect(store.snapshot().state.run).toBeNull()
  })

  it('ending after the time is up records it as completed, not early', async () => {
    const { store, clock } = clockStore(await tempDir())
    await store.load()
    await store.start('focus', null)
    const runId = store.snapshot().state.run!.id
    clock.now += 26 * MIN
    expect((await store.end(runId)).session).toMatchObject({ outcome: 'completed', focusedSec: 1500 })
    expect(store.snapshot().sessions).toHaveLength(1)
  })

  it('keeps an unreadable file aside and starts empty', async () => {
    const dir = await tempDir()
    await writeFile(path.join(dir, FOCUS_FILE_NAME), '{ broken', 'utf8')
    const { store } = clockStore(dir)
    await store.load()
    expect(store.quarantined).toContain('.corrupt-')
    expect(store.snapshot().sessions).toEqual([])
    expect((await readdir(dir)).some((f) => f.startsWith(`${FOCUS_FILE_NAME}.corrupt-`))).toBe(true)
  })

  it('new durations apply from the next start and are saved', async () => {
    const dir = await tempDir()
    const { store } = clockStore(dir)
    await store.load()
    await store.start('focus', null)
    await store.setDurations({ focusMin: 50, shortBreakMin: 10, longBreakMin: 20 })
    expect(store.snapshot().state.run?.plannedSec).toBe(1500)
    await store.reset(store.snapshot().state.run!.id)
    await store.start('focus', null)
    expect(store.snapshot().state.run?.plannedSec).toBe(3000)
    await store.flush()
    const saved = JSON.parse(await readFile(path.join(dir, FOCUS_FILE_NAME), 'utf8'))
    expect(saved).toMatchObject({ version: 1, durations: { focusMin: 50 } })
  })
})

describe('FocusService', () => {
  it('re-bases on a changed system time and finishes a run exactly once', async () => {
    const { store, clock } = clockStore(await tempDir())
    await store.load()
    const mono = { now: 0 }
    const finished: FocusFinished[] = []
    let changes = 0
    const service = new FocusService({
      store,
      onChanged: () => changes++,
      onFinished: (f) => finished.push(f),
      wallNow: () => clock.now,
      monoNow: () => mono.now,
      tickMs: 60 * 60 * 1000
    })
    await store.start('focus', null)
    service.sync()
    // 1 s passes, but the clock is set forward by 2 hours: only the second counts.
    clock.now += 2 * 60 * MIN + 1000
    mono.now += 1000
    await service.check()
    expect(changes).toBe(1)
    expect(runRemainingMs(store.snapshot().state.run!, clock.now)).toBe(25 * MIN - 1000)
    expect(finished).toHaveLength(0)
    // The rest really passes; two ticks at once still finish it once.
    clock.now += 25 * MIN
    mono.now += 25 * MIN
    await Promise.all([service.check(), service.check()])
    await service.check()
    expect(finished).toHaveLength(1)
    expect(store.snapshot().sessions).toHaveLength(1)
    service.stop()
  })

  it('counts time asleep as real time', async () => {
    const { store, clock } = clockStore(await tempDir())
    await store.load()
    const mono = { now: 0 }
    const finished: FocusFinished[] = []
    const service = new FocusService({
      store,
      onChanged: () => {},
      onFinished: (f) => finished.push(f),
      wallNow: () => clock.now,
      monoNow: () => mono.now,
      tickMs: 60 * 60 * 1000
    })
    await store.start('focus', null)
    service.sync()
    service.noteSuspend()
    clock.now += 40 * MIN
    mono.now += 1000
    await service.noteResume()
    expect(finished).toHaveLength(1)
    expect(finished[0]?.endedAt).toBe(new Date(T0 + 25 * MIN).toISOString())
    service.stop()
  })
})
