import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useT } from '../store/appStore'

/** How many dialogs are open (one can open over another); the title bar is dimmed while any is. */
let openDialogs = 0

function setModalOpen(open: boolean): void {
  window.lifeUnlocked.window
    .setModalOpen(open)
    .catch((error: unknown) => console.warn('[Dialog] Could not update the title bar', error))
}

/**
 * Centered modal.
 * The Windows minimize/maximize/close buttons are drawn by the OS above the page, so the scrim cannot cover them;
 * the main process repaints them in the scrim's color instead (they keep working). The strip at the top stays a
 * window drag handle so the window can still be moved while a dialog is open. The panel scrolls internally so it is never clipped at the minimum window size. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 'max-w-md'
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer: ReactNode
  width?: string
}): React.JSX.Element {
  const t = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    if (openDialogs++ === 0) setModalOpen(true)
    return () => {
      if (--openDialogs === 0) setModalOpen(false)
    }
  }, [])

  return (
    <div
      data-testid="dialog-scrim"
      className="no-drag animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-6 pt-12 pb-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div aria-hidden className="drag absolute inset-x-0 top-0 h-10" data-testid="dialog-drag-strip" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`no-drag animate-pop-in flex max-h-full w-full ${width} flex-col rounded-xl bg-card shadow-2xl ring-1 ring-ink/10`}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-md p-1 text-muted hover:bg-ink/5 hover:text-fg"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div>
        <div className="flex justify-end gap-2 px-5 pt-3 pb-4">{footer}</div>
      </div>
    </div>
  )
}
