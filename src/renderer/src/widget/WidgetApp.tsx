import { Check, Clock, ExternalLink, ListTodo, Repeat, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SETTINGS } from '../../../shared/constants'
import { createTranslator, resolveLocale } from '../../../shared/i18n'
import { selectTodayTasks, type TodayItem } from '../../../shared/taskOrder'
import { formatCountdown, getRemainingMs } from '../../../shared/timer'
import type { Locale, Settings, TaskSnapshot } from '../../../shared/types'
import { taskDisplayName } from '../../../shared/planner/displayName'
import type { Plan } from '../../../shared/planner/types'
import { TaskName } from '../components/TaskName'
import { UndoToasts, type UndoToastEntry } from '../components/UndoToasts'
import { undoToastFor } from '../lib/undoToast'
import { useAppearance } from '../hooks/useAppearance'
import { dueLabel } from '../lib/dueText'
import { useNow } from '../hooks/useNow'

const api = (): Window['lifeUnlockedWidget'] => window.lifeUnlockedWidget
const EMPTY_PLANS: readonly Plan[] = []

export function WidgetApp(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null)
  const tasks = snapshot?.tasks ?? null
  const plans = snapshot?.plans ?? EMPTY_PLANS
  const [undoToasts, setUndoToasts] = useState<UndoToastEntry[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [systemLocale, setSystemLocale] = useState<Locale>('en')
  // Ids with a completion request in flight, so a double click sends only one.
  const [completing, setCompleting] = useState<ReadonlySet<string>>(new Set())
  const inFlight = useRef(new Set<string>())
  // Ticks every second: drives countdowns and moves "today" over at midnight.
  const now = useNow(true)
  // 'hidden' until the window is on screen, so the show transition is actually seen.
  const [phase, setPhase] = useState<'hidden' | 'shown'>('hidden')

  useEffect(() => {
    const offEnter = api().widget.onEnter(() => requestAnimationFrame(() => setPhase('shown')))
    const offExit = api().widget.onExit(() => setPhase('hidden'))
    // Never stay invisible if the show message was missed.
    const fallback = window.setTimeout(() => setPhase((p) => (p === 'hidden' ? 'shown' : p)), 800)
    return () => {
      offEnter()
      offExit()
      window.clearTimeout(fallback)
    }
  }, [])

  useEffect(() => {
    const offTasks = api().tasks.onChanged(setSnapshot)
    const offSettings = api().settings.onChanged(setSettings)
    void Promise.all([api().tasks.snapshot(), api().settings.get(), api().app.info()]).then(([t, s, info]) => {
      setSnapshot(t)
      setSettings(s)
      setSystemLocale(info.systemLocale)
    })
    return () => {
      offTasks()
      offSettings()
    }
  }, [])

  useAppearance(settings.widget.appearance)
  const locale = resolveLocale(settings.language, systemLocale)
  const t = useMemo(() => createTranslator(locale), [locale])
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const today = useMemo(() => selectTodayTasks(tasks ?? [], snapshot?.completions ?? [], now), [tasks, snapshot, now])
  const percent = today.total === 0 ? 0 : Math.round((today.completed / today.total) * 100)

  const complete = async (item: TodayItem): Promise<void> => {
    const { key, occurrence } = item
    const id = item.task.id
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    setCompleting(new Set(inFlight.current))
    try {
      // Same IPC call as the main window: the main process saves, broadcasts and fires the achievement once.
      const { task, event } = await api().tasks.complete(id, occurrence)
      setSnapshot((snap) =>
        snap
          ? {
              ...snap,
              tasks: snap.tasks.map((x) => (x.id === id ? task : x)),
              completions:
                event && !snap.completions.some((e) => e.id === event.id)
                  ? [...snap.completions, event]
                  : snap.completions
            }
          : snap
      )
      if (event) setUndoToasts((list) => [...list, undoToastFor(event.id, { ...task, title: event.title }, snapshot?.plans ?? [], t)])
    } catch (error) {
      console.error('[Widget] Complete failed', error)
    } finally {
      inFlight.current.delete(key)
      setCompleting(new Set(inFlight.current))
    }
  }

  const dismissToast = useCallback(
    (eventId: string) => setUndoToasts((list) => list.filter((x) => x.eventId !== eventId)),
    []
  )
  const undo = (eventId: string): void => {
    dismissToast(eventId)
    // The main process saves it and tells every window, this one included.
    void api()
      .tasks.undoCompletion(eventId)
      .catch((error) => console.error('[Widget] Undo failed', error))
  }

  return (
    <div
      data-testid="widget-panel"
      data-anim={settings.widget.animation}
      data-phase={phase}
      data-shape={settings.widget.shape}
      className={`widget-root flex h-full flex-col overflow-hidden bg-app text-fg ring-1 ring-inset ring-ink/10 ${
        settings.widget.shape === 'rounded' ? 'rounded-xl' : 'rounded-none'
      }`}
    >
      <header data-testid="widget-drag-handle" className="drag flex h-10 shrink-0 items-center gap-2 pr-1.5 pl-4">
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{t('widget.title')}</h1>
        <IconButton label={t('widget.openMain')} onClick={() => void api().widget.openMain()}>
          <ExternalLink size={14} />
        </IconButton>
        <IconButton label={t('widget.close')} onClick={() => void api().widget.close()}>
          <X size={15} />
        </IconButton>
      </header>

      {tasks !== null && today.total > 0 && (
        <div className="shrink-0 px-4 pb-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
            <span data-testid="widget-progress">
              {t('widget.progress', { done: today.completed, total: today.total })}
            </span>
            <span className="tabular-nums">{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={today.total}
            aria-valuenow={today.completed}
            className="h-1.5 overflow-hidden rounded-full bg-ink/10"
          >
            <div
              className="h-full rounded-full bg-gold transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {tasks === null ? null : today.total === 0 ? (
          <div data-testid="widget-empty" className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-ink/5 text-muted">
              <ListTodo size={20} />
            </div>
            <p className="text-sm font-medium">{t('widget.empty.title')}</p>
            <p className="mt-1 text-xs text-muted">{t('widget.empty.body')}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {today.items.map((item) => {
              const { task, done } = item
              // Same name as the main window ("喝水 · 第2/4次"); the stored title is untouched.
              const display = taskDisplayName(task, plans, t)
              const remaining = !done && task.timerConfig ? getRemainingMs(task.timerConfig, now) : null
              const due = done ? null : dueLabel(task, item.occurrence, now, t, locale)
              return (
                <li
                  key={item.key}
                  className="widget-row"
                  data-testid="widget-task"
                  data-status={done ? 'completed' : 'active'}
                  data-occurrence={item.occurrence ?? undefined}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={t(done ? 'widget.completed' : 'widget.complete', { title: display.full })}
                    disabled={done || completing.has(item.key)}
                    onClick={() => void complete(item)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors enabled:hover:bg-ink/[0.06] disabled:cursor-default"
                  >
                    <span
                      className={`flex size-[18px] shrink-0 items-center justify-center rounded-[5px] ring-1 ring-inset transition-colors ${
                        done ? 'widget-check-done bg-gold text-app ring-gold' : 'ring-ink/30'
                      }`}
                    >
                      {done && <Check size={13} strokeWidth={3} />}
                    </span>
                    <TaskName
                      display={display}
                      testId="widget-task-title"
                      className={`flex-1 text-sm ${done ? 'text-muted line-through' : ''}`}
                    />
                    {item.occurrence && (
                      <Repeat size={12} aria-label={t('repeat.badge')} className="shrink-0 text-muted" />
                    )}
                    {due && (
                      <span
                        data-testid="widget-due"
                        data-overdue={due.overdue}
                        className={`shrink-0 text-xs tabular-nums ${due.overdue ? 'text-warn' : 'text-muted'}`}
                      >
                        {due.text}
                      </span>
                    )}
                    {remaining !== null && (
                      <span
                        data-testid="widget-countdown"
                        className={`inline-flex shrink-0 items-center gap-1 text-xs tabular-nums ${
                          remaining === 0 ? 'text-warn' : 'text-muted'
                        }`}
                      >
                        <Clock size={12} />
                        {remaining === 0 ? t('tasks.timeUp') : formatCountdown(remaining)}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <UndoToasts entries={undoToasts} t={t} compact onUndo={undo} onDismiss={dismissToast} />
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="no-drag flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-ink/10 hover:text-fg"
    >
      {children}
    </button>
  )
}
