import { CircleDashed, Link2, Minimize2 } from 'lucide-react'
import { useEffect } from 'react'
import { formatCountdown } from '../../../shared/timer'
import { useTaskName } from '../hooks/useTaskName'
import { useAppStore, useT } from '../store/appStore'
import { FocusControls, FocusProgress } from './FocusControls'
import { useFocusView } from './useFocusView'

/**
 * The quiet full-window focus view (Phase 6.7): the countdown, the task, pause/resume and end. It
 * only covers this window: no full screen, nothing stops switching to other apps, and leaving it
 * (button or Esc) never stops the timer.
 */
export function FocusMode(): React.JSX.Element {
  const t = useT()
  const view = useFocusView()
  const focus = useAppStore((s) => s.focus)
  const setFocusMode = useAppStore((s) => s.setFocusMode)
  const taskTitle = view.run ? view.run.taskTitle : ''
  // A new focus started from here uses the task chosen on the Focus page.
  const nextTaskId = focus?.state.taskId ?? null
  const tasks = useAppStore((s) => s.tasks)
  const nextTask = tasks.find((task) => task.id === nextTaskId && task.status === 'active')
  const taskName = useTaskName()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) setFocusMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFocusMode])

  return (
    <div className="animate-fade-in fixed inset-0 z-40 flex flex-col bg-app" data-testid="focus-mode" role="region" aria-label={t('focus.enterMode')}>
      <div className="drag titlebar-left-pad flex h-10 shrink-0 items-center pl-3">
        <button
          type="button"
          data-testid="focus-exit-mode"
          onClick={() => setFocusMode(false)}
          title={t('focus.exitModeHint')}
          className="no-drag inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted transition-colors hover:bg-ink/5 hover:text-fg"
        >
          <Minimize2 size={14} aria-hidden="true" />
          {t('focus.exitMode')}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-8 pb-16">
        <span className="text-sm tracking-wide text-muted" data-testid="focus-mode-phase">
          {t(`focus.phase.${view.phase}`)}
          {view.paused ? ` · ${t('focus.paused')}` : ''}
        </span>
        <span
          className={`text-[clamp(72px,16vmin,168px)] leading-none font-light tracking-tight tabular-nums ${
            view.paused ? 'text-muted' : 'text-fg'
          }`}
          data-testid="focus-mode-countdown"
          data-remaining-sec={Math.ceil(view.remainingMs / 1000)}
          role="timer"
        >
          {formatCountdown(view.remainingMs)}
        </span>
        <FocusProgress progress={view.progress} className="w-[min(420px,70vw)]" />
        {view.phase === 'focus' && (
          <p
            className="flex max-w-[min(560px,80vw)] min-w-0 items-center gap-2 text-base text-muted"
            data-testid="focus-mode-task"
            title={taskTitle || undefined}
          >
            {(view.run ? taskTitle : nextTask) ? (
              <Link2 size={16} className="shrink-0 text-accent/80" aria-hidden="true" />
            ) : (
              <CircleDashed size={16} className="shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate">
              {view.run ? taskTitle || t('focus.task.unlinked') : nextTask ? taskName(nextTask) : t('focus.task.unlinked')}
            </span>
          </p>
        )}
        <FocusControls view={view} taskId={nextTask?.id ?? null} size="large" />
      </div>
    </div>
  )
}
