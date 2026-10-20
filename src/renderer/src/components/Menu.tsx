import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../store/appStore'

export interface MenuItem {
  label: string
  icon: LucideIcon
  onSelect: () => void
  danger?: boolean
}

export function MoreMenu({ items }: { items: MenuItem[] }): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (): void => {
    // Flip upwards near the bottom of the window so the menu is never cut off.
    const rect = ref.current?.getBoundingClientRect()
    setOpenUp(!!rect && window.innerHeight - rect.bottom < 110)
    setOpen((v) => !v)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={t('common.more')}
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/5 hover:text-fg"
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div
          role="menu"
          className={`animate-fade-in absolute right-0 z-20 min-w-36 rounded-lg bg-popover p-1 shadow-xl ring-1 ring-ink/10 ${
            openUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {items.map(({ label, icon: Icon, onSelect, danger }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onSelect()
              }}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-ink/[0.07] ${
                danger ? 'text-red-400' : 'text-fg'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
