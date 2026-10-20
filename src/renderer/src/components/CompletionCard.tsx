import { Clock, RotateCcw, Trash2, Trophy } from 'lucide-react'
import { taskDisplayName } from '../../../shared/planner/displayName'
import { planNodeLabel } from '../../../shared/planner/nodeLabel'
import type { CompletionEvent, Task } from '../../../shared/types'
import { useFormatDate } from '../hooks/useFormatDate'
import { useAppStore, useT } from '../store/appStore'
import { formatDateKey } from '../lib/recurrenceText'
import { formatWindow } from '../lib/windowText'
import { TaskName } from './TaskName'
import { MoreMenu, type MenuItem } from './Menu'

/** One counted completion in the Completed list. */
export function CompletionCard({
  event,
  task,
  onDelete
}: {
  event: CompletionEvent
  task: Task | undefined
  onDelete: (task: Task) => void
}): React.JSX.Element {
  const t = useT()
  const formatDate = useFormatDate()
  const undoCompletion = useAppStore((s) => s.undoCompletion)
  const locale = useAppStore((s) => s.locale)
  const plans = useAppStore((s) => s.plans)
  // A timed plan node reads "喝水 · 第2/4次" with its window, like on the In progress list.
  const node = task ? planNodeLabel({ ...task, title: event.title }, plans) : null
  const display = task ? taskDisplayName({ ...task, title: event.title }, plans, t) : { full: event.title, name: event.title, suffix: '' }
  const description = node?.generatedDescription ? '' : task?.description

  const menuItems: MenuItem[] = [
    { label: t('tasks.restore'), icon: RotateCcw, onSelect: () => void undoCompletion(event.id) },
    ...(task && event.occurrence === null
      ? [{ label: t('common.delete'), icon: Trash2, onSelect: () => onDelete(task), danger: true }]
      : [])
  ]

  return (
    <div
      data-testid="task-card"
      data-event={event.id}
      className="group flex items-center gap-4 rounded-[var(--radius-card)] bg-card px-4 py-3.5 ring-1 ring-ink/[0.04] transition-colors hover:bg-card-hover"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold/12 text-gold">
        <Trophy size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          <TaskName display={display} testId="task-title" />
        </p>
        {description && (
          <p className="mt-0.5 line-clamp-2 text-sm break-words text-muted" title={description}>
            {description}
          </p>
        )}
        {task?.window && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted tabular-nums" data-testid="window-badge" data-state="done">
            <Clock size={12} />
            {formatWindow(task.window, Date.parse(event.completedAt), t, locale)} · {t('tasks.node.done')}
          </p>
        )}
        <p className="mt-1.5 text-xs text-muted">
          {event.occurrence && (
            <span className="mr-2">{t('repeat.occurrence', { date: formatDateKey(event.occurrence, locale) })}</span>
          )}
          {t('tasks.completedAt', { date: formatDate(event.completedAt) })}
        </p>
      </div>
      <MoreMenu items={menuItems} />
    </div>
  )
}
