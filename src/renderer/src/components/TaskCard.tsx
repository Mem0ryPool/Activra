import {
  AlarmClock,
  Check,
  CheckCircle2,
  Clock,
  Palette,
  Pencil,
  Repeat,
  RotateCcw,
  SkipForward,
  Trash2,
  Trophy,
  Undo2
} from 'lucide-react'
import { countedCompletionFor } from '../../../shared/completions'
import { dayKey } from '../../../shared/dates'
import { addDays, nextOccurrence, plannedOn, seriesEnded } from '../../../shared/recurrence'
import { formatCountdown, getRemainingMs } from '../../../shared/timer'
import { taskDisplayName } from '../../../shared/planner/displayName'
import { planNodeLabel } from '../../../shared/planner/nodeLabel'
import { windowState } from '../../../shared/timeWindow'
import type { Task } from '../../../shared/types'
import { useFormatDate } from '../hooks/useFormatDate'
import { useNow } from '../hooks/useNow'
import { useAppStore, useT } from '../store/appStore'
import { Button } from './Button'
import { dueLabel } from '../lib/dueText'
import { describeRule, formatDateKey } from '../lib/recurrenceText'
import { formatWindow } from '../lib/windowText'
import { TaskName } from './TaskName'
import { MoreMenu, type MenuItem } from './Menu'

function Countdown({ task }: { task: Task }): React.JSX.Element | null {
  const t = useT()
  const timer = task.timerConfig
  const now = useNow(!!timer)
  if (!timer) return null
  const remaining = getRemainingMs(timer, now)
  const timeUp = remaining === 0
  return (
    <span
      data-testid="countdown"
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ${
        timeUp ? 'bg-warn/15 text-warn' : 'bg-ink/5 text-muted'
      }`}
    >
      <Clock size={13} />
      {timeUp ? t('tasks.timeUp') : formatCountdown(remaining)}
    </span>
  )
}

export function TaskCard({
  task,
  highlighted = false,
  onEdit,
  onDelete
}: {
  task: Task
  highlighted?: boolean
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
}): React.JSX.Element {
  const t = useT()
  const formatDate = useFormatDate()
  const locale = useAppStore((s) => s.locale)
  const completing = useAppStore((s) => !!s.completing[task.id])
  const completeTask = useAppStore((s) => s.completeTask)
  const undoCompletion = useAppStore((s) => s.undoCompletion)
  const skipOccurrence = useAppStore((s) => s.skipOccurrence)
  const completions = useAppStore((s) => s.completions)
  const plans = useAppStore((s) => s.plans)
  // Once a minute is enough to move a repeating task on to the next day and to update "overdue".
  // A timed plan step opens and closes to the minute, so it checks more often.
  const now = useNow(!!task.recurrence || !!task.due || !!task.window, task.window ? 5_000 : 60_000)
  const done = task.status === 'completed'
  const slot = task.window && !done ? windowState(task.window, now) : null
  // A timed plan node: "喝水 · 第2/4次", its window and state, without the plan's text on every card.
  const node = planNodeLabel(task, plans)
  const display = taskDisplayName(task, plans, t)
  const description = node?.generatedDescription ? '' : task.description

  // A repeating task shows today's occurrence, or else when the next one is.
  const rule = task.recurrence
  const today = dayKey(new Date(now))
  const plannedToday = !!rule && plannedOn(task, today)
  const skippedToday = plannedToday && task.skippedOccurrences.includes(today)
  const doneToday = plannedToday ? countedCompletionFor(completions, task.id, today) : undefined
  const ended = !!rule && seriesEnded(task, today)
  const next =
    rule && !plannedToday
      ? nextOccurrence(task, today)
      : rule && skippedToday
        ? nextOccurrence(task, addDays(today, 1))
        : null
  const canComplete = rule ? plannedToday && !skippedToday && !doneToday : !done && (slot === null || slot === 'open')
  // The deadline shown: the task's own, or the occurrence's (today's, else the next one).
  const dueOccurrence = rule ? (plannedToday && !skippedToday ? today : next) : null
  const due = !done && !doneToday && (!rule || dueOccurrence) ? dueLabel(task, dueOccurrence, now, t, locale) : null

  const menuItems: MenuItem[] = [
    ...(done ? [] : [{ label: t('common.edit'), icon: Pencil, onSelect: () => onEdit(task) }]),
    ...(doneToday
      ? [{ label: t('tasks.restore'), icon: RotateCcw, onSelect: () => void undoCompletion(doneToday.id) }]
      : []),
    ...(rule && plannedToday && !doneToday
      ? [
          skippedToday
            ? { label: t('repeat.unskip'), icon: Undo2, onSelect: () => void skipOccurrence(task.id, today, false) }
            : { label: t('repeat.skip'), icon: SkipForward, onSelect: () => void skipOccurrence(task.id, today, true) }
        ]
      : []),
    { label: t('common.delete'), icon: Trash2, onSelect: () => onDelete(task), danger: true }
  ]

  return (
    <div
      data-testid="task-card"
      data-task={task.id}
      data-highlighted={highlighted || undefined}
      tabIndex={-1}
      className={`group flex items-center gap-4 rounded-[var(--radius-card)] bg-card px-4 py-3.5 outline-none transition-colors hover:bg-card-hover ${
        highlighted ? 'ring-2 ring-accent' : 'ring-1 ring-ink/[0.04]'
      }`}
    >
      {done && (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold/12 text-gold">
          <Trophy size={18} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          <TaskName display={display} testId="task-title" />
        </p>
        {description && (
          <p className="mt-0.5 line-clamp-2 text-sm break-words text-muted" title={description}>
            {description}
          </p>
        )}
        {done && task.completedAt ? (
          <p className="mt-1.5 text-xs text-muted">{t('tasks.completedAt', { date: formatDate(task.completedAt) })}</p>
        ) : (
          (task.timerConfig || task.themeOverride || rule || due || task.window) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {task.window && slot && (
                <span
                  data-testid="window-badge"
                  data-state={slot}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ${
                    slot === 'closed' ? 'bg-warn/15 text-warn' : slot === 'open' ? 'bg-accent/12 text-accent' : 'bg-ink/5 text-muted'
                  }`}
                >
                  <Clock size={12} />
                  {formatWindow(task.window, now, t, locale)}
                  <span className="font-normal" data-testid="window-state">
                    · {t(slot === 'upcoming' ? 'tasks.node.upcoming' : slot === 'open' ? 'tasks.node.open' : 'tasks.node.missed')}
                  </span>
                </span>
              )}
              {due && (
                <span
                  data-testid="due-badge"
                  data-overdue={due.overdue}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ${
                    due.overdue ? 'bg-warn/15 text-warn' : 'bg-ink/5 text-muted'
                  }`}
                >
                  <AlarmClock size={12} />
                  {due.text}
                </span>
              )}
              {rule && (
                <span
                  data-testid="repeat-badge"
                  className="inline-flex items-center gap-1.5 rounded-md bg-ink/5 px-2 py-0.5 text-xs text-muted"
                >
                  <Repeat size={12} />
                  {describeRule(rule, t, locale)}
                </span>
              )}
              {rule && (
                <span data-testid="occurrence-state" className="text-xs text-muted">
                  {doneToday ? (
                    <span className="inline-flex items-center gap-1 text-gold">
                      <CheckCircle2 size={13} />
                      {t('repeat.doneToday')}
                    </span>
                  ) : ended ? (
                    t('repeat.ended')
                  ) : skippedToday ? (
                    `${t('repeat.skippedToday')}${next ? ` · ${t('repeat.next', { date: formatDateKey(next, locale) })}` : ''}`
                  ) : !plannedToday && next ? (
                    t('repeat.next', { date: formatDateKey(next, locale) })
                  ) : null}
                </span>
              )}
              <Countdown task={task} />
              {task.themeOverride && (
                <span
                  data-testid="theme-badge"
                  className="inline-flex items-center gap-1.5 rounded-md bg-ink/5 px-2 py-0.5 text-xs text-muted"
                >
                  <Palette size={12} />
                  {t(`theme.${task.themeOverride}`)}
                </span>
              )}
            </div>
          )
        )}
      </div>
      {canComplete && (
        <Button variant="primary" disabled={completing} onClick={() => void completeTask(task.id, rule ? today : null)}>
          <Check size={16} strokeWidth={2.5} />
          {t('tasks.complete')}
        </Button>
      )}
      <MoreMenu items={menuItems} />
    </div>
  )
}
