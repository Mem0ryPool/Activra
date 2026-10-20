import { CheckCircle2, X } from 'lucide-react'
import { useEffect } from 'react'
import { UNDO_WINDOW_MS } from '../../../shared/completions'
import type { Translate } from '../../../shared/i18n'
import { TaskName } from './TaskName'

export interface UndoToastEntry {
  eventId: string
  /** The task's display name. */
  title: string
  /** The end of `title` that stays visible when it is shortened (" · 第2/4次"). */
  suffix?: string
  shownAt: number
}

/** At most this many toasts at once; older ones still can be undone from the task's menu. */
const MAX_VISIBLE = 3

function UndoToast({
  entry,
  t,
  compact,
  onUndo,
  onDismiss
}: {
  entry: UndoToastEntry
  t: Translate
  compact: boolean
  onUndo: (eventId: string) => void
  onDismiss: (eventId: string) => void
}): React.JSX.Element {
  useEffect(() => {
    const left = Math.max(0, entry.shownAt + UNDO_WINDOW_MS - Date.now())
    const id = window.setTimeout(() => onDismiss(entry.eventId), left)
    return () => window.clearTimeout(id)
  }, [entry, onDismiss])

  return (
    <div
      data-testid="undo-toast"
      data-event={entry.eventId}
      className={`animate-fade-in pointer-events-auto flex items-center gap-3 rounded-lg bg-popover shadow-xl ring-1 ring-ink/10 ${
        compact ? 'px-3 py-2' : 'px-4 py-2.5'
      }`}
    >
      <CheckCircle2 size={compact ? 15 : 17} className="shrink-0 text-gold" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t('undo.toast')}</p>
        <p className="text-xs text-muted">
          <TaskName
            testId="undo-toast-title"
            display={{
              full: entry.title,
              name: entry.suffix && entry.title.endsWith(entry.suffix) ? entry.title.slice(0, -entry.suffix.length) : entry.title,
              suffix: entry.suffix && entry.title.endsWith(entry.suffix) ? entry.suffix : ''
            }}
          />
        </p>
      </div>
      <button
        type="button"
        onClick={() => onUndo(entry.eventId)}
        className="shrink-0 rounded-md px-2.5 py-1 text-sm font-semibold text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        {t('undo.action')}
      </button>
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={() => onDismiss(entry.eventId)}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-ink/10 hover:text-fg"
      >
        <X size={14} />
      </button>
    </div>
  )
}

/**
 * "Task completed · Undo", shown for UNDO_WINDOW_MS in the window where the task was completed.
 * Announced politely to screen readers; Undo is a normal, focusable button.
 */
export function UndoToasts({
  entries,
  t,
  compact = false,
  onUndo,
  onDismiss
}: {
  entries: readonly UndoToastEntry[]
  t: Translate
  compact?: boolean
  onUndo: (eventId: string) => void
  onDismiss: (eventId: string) => void
}): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed z-40 flex flex-col gap-2 ${
        compact ? 'inset-x-2 bottom-2' : 'bottom-5 left-1/2 w-[min(420px,calc(100%-2rem))] -translate-x-1/2'
      }`}
    >
      {entries.slice(-MAX_VISIBLE).map((entry) => (
        <UndoToast key={entry.eventId} entry={entry} t={t} compact={compact} onUndo={onUndo} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
