import { AlertCircle, Undo2 } from 'lucide-react'
import type { Translate } from '../../../shared/i18n'
import type { HabitNotice } from '../store/appStore'

/**
 * "Check-in cancelled" or the save error after a habit check-in. It sits where the task undo toasts
 * sit, closes by itself and lets clicks through. A successful check-in is answered in the
 * notification corner instead (light, flame, gold or milestone card, Phase 6.6.2b).
 */
export function HabitNoticeToast({ notice, t }: { notice: HabitNotice | null; t: Translate }): React.JSX.Element {
  const Icon = notice?.kind === 'error' ? AlertCircle : Undo2
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 left-1/2 z-40 flex w-[min(360px,calc(100%-2rem))] -translate-x-1/2 justify-center"
    >
      {notice && (
        <div
          key={notice.id}
          data-testid="habit-notice"
          data-kind={notice.kind}
          className="animate-pop-in flex max-w-full items-center gap-2.5 rounded-lg bg-popover px-4 py-2.5 shadow-xl ring-1 ring-ink/10"
        >
          <Icon size={17} aria-hidden="true" className={`shrink-0 ${notice.kind === 'error' ? 'text-danger-fg' : 'text-muted'}`} />
          <p className="flex min-w-0 items-baseline gap-2 text-sm">
            <span className="shrink-0 font-medium" data-testid="habit-notice-text">
              {t(notice.kind === 'error' ? 'habits.error.save' : 'habits.feedback.undone')}
            </span>
            {notice.habitName && <span className="min-w-0 truncate text-xs text-muted">{notice.habitName}</span>}
          </p>
        </div>
      )}
    </div>
  )
}
