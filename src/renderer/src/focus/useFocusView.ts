import { DEFAULT_FOCUS_DURATIONS, LONG_BREAK_EVERY, phaseSeconds, runRemainingMs } from '../../../shared/focus/timer'
import type { FocusPhase, FocusRun } from '../../../shared/focus/types'
import { useNow } from '../hooks/useNow'
import { useAppStore } from '../store/appStore'

export interface FocusView {
  run: FocusRun | null
  phase: FocusPhase
  running: boolean
  paused: boolean
  remainingMs: number
  totalMs: number
  /** 0–1 of the phase done. */
  progress: number
  /** Which focus of the round this is (1…LONG_BREAK_EVERY), for a focus phase. */
  round: number
}

/**
 * What the focus timer shows right now. The time is derived from the run's timestamps on every
 * render (re-rendered four times a second while running), so a hidden or throttled window shows the
 * right time the moment it is looked at again.
 */
export function useFocusView(): FocusView {
  const focus = useAppStore((s) => s.focus)
  const run = focus?.state.run ?? null
  const running = !!run && run.resumedAt !== null
  const now = useNow(running, 250)
  const phase = run?.phase ?? focus?.state.nextPhase ?? 'focus'
  const totalMs = run ? run.plannedSec * 1000 : phaseSeconds(phase, focus?.durations ?? DEFAULT_FOCUS_DURATIONS) * 1000
  const remainingMs = run ? Math.max(0, runRemainingMs(run, now)) : totalMs
  return {
    run,
    phase,
    running,
    paused: !!run && run.resumedAt === null,
    remainingMs,
    totalMs,
    progress: totalMs > 0 ? 1 - remainingMs / totalMs : 0,
    round: ((focus?.state.cycle ?? 0) % LONG_BREAK_EVERY) + 1
  }
}
