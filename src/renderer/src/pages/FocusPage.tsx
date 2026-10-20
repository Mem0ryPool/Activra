import { CheckCircle2, CircleDashed, Clock, Link2, Maximize2, Timer } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { formatCountdown } from '../../../shared/timer'
import { focusedOnTask, focusToday, LONG_BREAK_EVERY } from '../../../shared/focus/timer'
import type { FocusPhase, FocusSession } from '../../../shared/focus/types'
import type { Task } from '../../../shared/types'
import { Button } from '../components/Button'
import { PageHeader } from '../components/PageHeader'
import { FocusControls, FocusProgress } from '../focus/FocusControls'
import { FocusDurationsDialog } from '../focus/FocusDurationsDialog'
import { TaskPicker } from '../focus/TaskPicker'
import { useFocusView } from '../focus/useFocusView'
import { useNow } from '../hooks/useNow'
import { useTaskName } from '../hooks/useTaskName'
import { useAppStore, useT } from '../store/appStore'

const PHASES: FocusPhase[] = ['focus', 'short-break', 'long-break']

/** Tasks a focus can be linked to: one-off tasks in progress (a timed plan step only until it closes) and repeating tasks. */
function focusableTasks(tasks: readonly Task[], now: number): Task[] {
  return tasks
    .filter((task) => task.status === 'active' && (!task.window || Date.parse(task.window.end) > now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function minutes(sec: number): number {
  return Math.round(sec / 60)
}

function Record({ session }: { session: FocusSession }): React.JSX.Element {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(session.endedAt))
  const done = session.outcome === 'completed'
  return (
    <li className="flex items-center gap-3 py-2" data-testid="focus-record" data-outcome={session.outcome}>
      {done ? (
        <CheckCircle2 size={16} className="shrink-0 text-accent" aria-hidden="true" />
      ) : (
        <CircleDashed size={16} className="shrink-0 text-muted" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm" title={session.taskTitle || undefined}>
        {session.taskTitle || <span className="text-muted">{t('focus.record.noTask')}</span>}
      </span>
      <span className={`shrink-0 text-xs ${done ? 'text-fg' : 'text-muted'}`}>
        {t(done ? 'focus.record.completed' : 'focus.record.endedEarly')}
      </span>
      <span className="w-24 shrink-0 text-right text-xs text-muted tabular-nums">
        {t('focus.record.duration', { focused: minutes(session.focusedSec), planned: minutes(session.plannedSec) })}
      </span>
      <span className="w-12 shrink-0 text-right text-xs text-muted tabular-nums">{time}</span>
    </li>
  )
}

export function FocusPage(): React.JSX.Element {
  const t = useT()
  const focus = useAppStore((s) => s.focus)
  const tasks = useAppStore((s) => s.tasks)
  const busy = useAppStore((s) => s.focusBusy)
  const selectFocus = useAppStore((s) => s.selectFocus)
  const setFocusMode = useAppStore((s) => s.setFocusMode)
  const taskName = useTaskName()
  const view = useFocusView()
  const [editing, setEditing] = useState(false)
  const taskLabelId = useId()
  // The day's list and the task list follow the clock (midnight, a plan step closing) without a change.
  const now = useNow(true, 30_000)
  const options = useMemo(() => focusableTasks(tasks, now), [tasks, now])
  const sessions = useMemo(() => focus?.sessions ?? [], [focus])
  const today = useMemo(() => focusToday(sessions, now), [sessions, now])
  const chosen = focus?.state.taskId ?? null
  const chosenTask = options.find((task) => task.id === chosen)
  const selectedId = view.run ? view.run.taskId : (chosenTask?.id ?? null)
  const taskTotal = selectedId ? focusedOnTask(sessions, selectedId) : 0
  const select = (selection: Parameters<typeof selectFocus>[0]): void =>
    void selectFocus(selection).catch((error) => console.error('[Focus] Select failed', error))

  const durationsButton = (
    <Button data-testid="focus-durations" onClick={() => setEditing(true)}>
      <Clock size={16} aria-hidden="true" />
      {t('focus.durations')}
    </Button>
  )
  return (
    <>
      <PageHeader title={t('nav.focus')} subtitle={t('focus.subtitle')} actions={durationsButton} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8" data-testid="focus-page">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          <section className="flex flex-col items-center gap-5 rounded-[var(--radius-card)] bg-card px-6 py-6 ring-1 ring-ink/[0.04]">
            <div className="flex w-full max-w-sm gap-1 rounded-lg bg-ink/[0.04] p-1" role="radiogroup" aria-label={t('nav.focus')}>
              {PHASES.map((phase) => {
                const on = view.phase === phase
                return (
                  <button
                    key={phase}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-testid={`focus-phase-${phase}`}
                    disabled={!!view.run || busy}
                    onClick={() => select({ phase })}
                    className={`h-8 flex-1 truncate rounded-md px-2 text-sm transition-colors disabled:cursor-not-allowed ${
                      on ? 'bg-card font-medium text-fg shadow-sm ring-1 ring-ink/[0.06]' : 'text-muted enabled:hover:text-fg'
                    }`}
                  >
                    {t(`focus.phase.${phase}`)}
                  </button>
                )
              })}
            </div>

            <div className="flex flex-col items-center gap-1">
              <span
                className={`text-[clamp(56px,9vw,80px)] leading-none font-semibold tracking-tight tabular-nums ${
                  view.paused ? 'text-muted' : 'text-fg'
                }`}
                data-testid="focus-countdown"
                data-remaining-sec={Math.ceil(view.remainingMs / 1000)}
                data-state={view.run ? (view.paused ? 'paused' : 'running') : 'idle'}
                role="timer"
              >
                {formatCountdown(view.remainingMs)}
              </span>
              <span className="h-5 text-xs text-muted" data-testid="focus-status">
                {view.paused
                  ? t('focus.paused')
                  : view.phase === 'focus'
                    ? t('focus.cycle', { n: view.round, total: LONG_BREAK_EVERY })
                    : ''}
              </span>
            </div>
            <FocusProgress progress={view.progress} className="w-full max-w-sm" />

            {view.phase === 'focus' &&
              (view.run ? (
                // During a focus the link is read, not edited: one quiet line, no box.
                <p
                  className={`flex max-w-sm min-w-0 items-center gap-1.5 text-sm ${view.run.taskTitle ? 'text-fg' : 'text-muted'}`}
                  data-testid="focus-run-task"
                  data-linked={view.run.taskTitle ? 'true' : 'false'}
                >
                  {view.run.taskTitle ? (
                    <Link2 size={15} className="shrink-0 text-accent" aria-hidden="true" />
                  ) : (
                    <CircleDashed size={15} className="shrink-0" aria-hidden="true" />
                  )}
                  <span className="sr-only">{t('focus.task.label')}: </span>
                  <span className="min-w-0 truncate" title={view.run.taskTitle || undefined}>
                    {view.run.taskTitle || t('focus.task.unlinked')}
                  </span>
                </p>
              ) : (
                <div className="flex w-full max-w-sm flex-col gap-1.5">
                  <span id={taskLabelId} className="text-xs text-muted">
                    {t('focus.task.label')}
                  </span>
                  <TaskPicker
                    labelId={taskLabelId}
                    options={options.map((task) => ({ id: task.id, label: taskName(task) }))}
                    value={selectedId}
                    onChange={(taskId) => select({ taskId })}
                  />
                  <span className="text-[11px] text-muted" data-testid="focus-task-hint">
                    {selectedId && taskTotal > 0
                      ? `${t('focus.task.total', { count: minutes(taskTotal) })} · ${t('focus.task.hint')}`
                      : t('focus.task.hint')}
                  </span>
                </div>
              ))}

            <div className="flex flex-wrap items-center justify-center gap-2">
              <FocusControls view={view} taskId={selectedId} />
              <Button variant="ghost" data-testid="focus-enter-mode" onClick={() => setFocusMode(true)}>
                <Maximize2 size={15} aria-hidden="true" />
                {t('focus.enterMode')}
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-card px-5 py-4 ring-1 ring-ink/[0.04]">
            <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="text-sm font-semibold">{t('focus.today.title')}</h2>
              <span className="text-xs text-muted tabular-nums" data-testid="focus-today-minutes" data-value={minutes(today.focusedSec)}>
                {t('focus.today.minutes', { count: minutes(today.focusedSec) })}
              </span>
              <span className="text-xs text-muted tabular-nums" data-testid="focus-today-completed" data-value={today.completed}>
                {t('focus.today.completed', { count: today.completed })}
              </span>
            </header>
            {today.sessions.length === 0 ? (
              <p className="flex items-center gap-2 py-2 text-sm text-muted">
                <Timer size={16} aria-hidden="true" />
                {t('focus.today.empty')}
              </p>
            ) : (
              <ul className="divide-y divide-ink/[0.05]">
                {today.sessions.map((session) => (
                  <Record key={session.id} session={session} />
                ))}
              </ul>
            )}
          </section>
          <p className="px-1 text-xs text-muted">{t('focus.help')}</p>
        </div>
      </div>
      {editing && <FocusDurationsDialog onClose={() => setEditing(false)} />}
    </>
  )
}
