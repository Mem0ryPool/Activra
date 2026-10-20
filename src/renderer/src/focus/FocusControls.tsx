import { Pause, Play, RotateCcw, Square } from 'lucide-react'
import type { FocusPhase } from '../../../shared/focus/types'
import { Button } from '../components/Button'
import { useAppStore, useT, type FocusRunAction } from '../store/appStore'
import type { FocusView } from './useFocusView'

/**
 * Start / pause / resume / end now / reset, the same on the Focus page and in focus mode.
 * `taskId` is the task chosen for a new focus.
 */
export function FocusControls({
  view,
  taskId,
  size = 'normal'
}: {
  view: FocusView
  taskId: string | null
  size?: 'normal' | 'large'
}): React.JSX.Element {
  const t = useT()
  const busy = useAppStore((s) => s.focusBusy)
  const startFocus = useAppStore((s) => s.startFocus)
  const focusRun = useAppStore((s) => s.focusRun)
  const big = size === 'large' ? 'h-11 px-5 text-[15px]' : ''
  const start = (phase: FocusPhase): void =>
    void startFocus(phase, phase === 'focus' ? taskId : null).catch((error) => console.error('[Focus] Start failed', error))
  const act = (action: FocusRunAction): void => {
    if (!view.run) return
    void focusRun(action, view.run.id).catch((error) => console.error(`[Focus] ${action} failed`, error))
  }

  if (!view.run) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" className={big} disabled={busy} data-testid="focus-start" onClick={() => start(view.phase)}>
          <Play size={16} aria-hidden="true" />
          {t('focus.start')}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {view.paused ? (
        <Button variant="primary" className={big} disabled={busy} data-testid="focus-resume" onClick={() => act('resume')}>
          <Play size={16} aria-hidden="true" />
          {t('focus.resume')}
        </Button>
      ) : (
        <Button variant="primary" className={big} disabled={busy} data-testid="focus-pause" onClick={() => act('pause')}>
          <Pause size={16} aria-hidden="true" />
          {t('focus.pause')}
        </Button>
      )}
      <Button className={big} disabled={busy} data-testid="focus-end" onClick={() => act('end')}>
        <Square size={14} aria-hidden="true" />
        {t('focus.end')}
      </Button>
      <Button variant="ghost" className={big} disabled={busy} data-testid="focus-reset" onClick={() => act('reset')}>
        <RotateCcw size={15} aria-hidden="true" />
        {t('focus.reset')}
      </Button>
    </div>
  )
}

/** The thin bar under the countdown. No transition: it moves with the time, nothing more. */
export function FocusProgress({ progress, className = '' }: { progress: number; className?: string }): React.JSX.Element {
  const pct = Math.min(100, Math.max(0, progress * 100))
  return (
    <div
      className={`h-1 overflow-hidden rounded-full bg-ink/[0.07] ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  )
}
