import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  /** Shown before the label in the list, and in the button while chosen. */
  icon?: LucideIcon
  /** Drawn in the muted color (e.g. "No task"). */
  muted?: boolean
  /** A thin line after this option. */
  separatorAfter?: boolean
}

interface Placement {
  left: number
  minWidth: number
  top?: number
  bottom?: number
  maxHeight: number
}

/** Room kept between the list and the window edge, the gap to the button, and the most the list grows before it scrolls. */
const EDGE = 12
const GAP = 6
const MAX_LIST = 288
const MAX_WIDTH = 360

/**
 * Activra's single-select (Phase 6.7): one look and behavior for every dropdown, after the Focus page's
 * task picker. A select-only combobox (WAI-ARIA pattern): focus stays on the button and the highlighted
 * option is announced through aria-activedescendant. Arrow keys, Home/End, Enter/Space, Esc (closes
 * only the list, never the dialog around it), Tab, outside click and type-ahead work. The list is drawn
 * in a portal at fixed coordinates, so no scrolling panel or dialog cuts it off; it opens below the
 * button, or above when there is more room there, and stays inside the window horizontally.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  labelledBy,
  name,
  disabled,
  size = 'md',
  className = '',
  testId,
  footer
}: {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  /** Accessible name, when no visible label is referenced with `labelledBy`. */
  label?: string
  labelledBy?: string
  name?: string
  disabled?: boolean
  /** 'sm' (h-9) for settings rows, 'md' (h-10) in forms. */
  size?: 'sm' | 'md'
  /** Width classes for the button (it fills its container by default). */
  className?: string
  testId?: string
  /** A muted note under the options. */
  footer?: ReactNode
}): React.JSX.Element {
  const listId = useId()
  const optionId = (index: number): string => `${listId}-opt-${index}`
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value))
  const selected = options[selectedIndex]
  const [wantOpen, setOpen] = useState(false)
  // A disabled select shows no list.
  const open = wantOpen && !disabled
  const [active, setActive] = useState(selectedIndex)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })

  const place = useCallback((): void => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const list = listRef.current
    const below = window.innerHeight - rect.bottom - EDGE
    const above = rect.top - EDGE
    const wanted = Math.min(MAX_LIST, (list?.scrollHeight ?? MAX_LIST) + 2)
    const up = below < wanted + GAP && above > below
    const maxHeight = Math.max(96, Math.min(MAX_LIST, (up ? above : below) - GAP))
    const width = Math.min(MAX_WIDTH, Math.max(rect.width, list?.offsetWidth ?? rect.width))
    const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - EDGE - width))
    setPlacement({
      left,
      minWidth: Math.min(rect.width, window.innerWidth - 2 * EDGE),
      maxHeight,
      ...(up ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP })
    })
  }, [])

  const openList = (index = selectedIndex): void => {
    if (disabled) return
    setActive(index)
    setPlacement(null)
    setOpen(true)
  }
  const close = (): void => setOpen(false)
  const choose = (index: number): void => {
    const option = options[index]
    close()
    if (option && option.value !== value) onChange(option.value)
  }

  // Placed before paint (hidden until then), and again whenever the window or a scrolling panel moves.
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place, options.length])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) close()
    }
    const onMove = (e: Event): void => {
      if (e.type === 'scroll' && listRef.current?.contains(e.target as Node)) return
      place()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, place])
  useEffect(() => {
    if (open) document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, listId])

  const typeAhead = (key: string): void => {
    const now = Date.now()
    const text = (now - typed.current.at < 700 ? typed.current.text : '') + key.toLocaleLowerCase()
    typed.current = { text, at: now }
    const start = open ? active : selectedIndex
    const order = [...options.keys()].map((i) => (start + (text.length > 1 ? 0 : 1) + i) % options.length)
    const hit = order.find((i) => options[i]?.label.toLocaleLowerCase().startsWith(text))
    if (hit === undefined) return
    if (open) setActive(hit)
    else openList(hit)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const last = options.length - 1
    const printable = e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openList()
      } else if (printable) {
        typeAhead(e.key)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => Math.min(last, i + 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => Math.max(0, i - 1))
        return
      case 'Home':
      case 'PageUp':
        e.preventDefault()
        setActive(0)
        return
      case 'End':
      case 'PageDown':
        e.preventDefault()
        setActive(last)
        return
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(active)
        return
      case 'Escape':
        // Only the list closes: not the dialog, not focus mode.
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      case 'Tab':
        close()
        return
      default:
        if (printable) typeAhead(e.key)
    }
  }

  const SelectedIcon = selected?.icon
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        name={name}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        disabled={disabled}
        data-testid={testId}
        data-value={value}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={`no-drag flex w-full min-w-0 items-center gap-2.5 bg-app px-3 text-left text-sm ring-1 transition-[box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
          size === 'sm' ? 'h-9 rounded-lg' : 'h-10 rounded-xl'
        } ${open ? 'ring-accent/70' : 'ring-line hover:ring-ink/25'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${className}`}
      >
        {SelectedIcon && (
          <SelectedIcon size={15} className={`shrink-0 ${selected?.muted ? 'text-muted' : 'text-accent'}`} aria-hidden="true" />
        )}
        <span className={`min-w-0 flex-1 truncate ${selected?.muted ? 'text-muted' : 'text-fg'}`} title={selected?.label}>
          {selected?.label}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={labelledBy ? undefined : label}
            aria-labelledby={labelledBy}
            data-testid="select-list"
            data-for={testId ?? name}
            className="animate-fade-in no-drag fixed z-[60] w-max overflow-y-auto overscroll-contain rounded-xl bg-popover p-1 shadow-xl ring-1 ring-ink/10"
            style={
              placement
                ? {
                    left: placement.left,
                    top: placement.top,
                    bottom: placement.bottom,
                    minWidth: placement.minWidth,
                    maxWidth: Math.min(MAX_WIDTH, window.innerWidth - 2 * EDGE),
                    maxHeight: placement.maxHeight
                  }
                : { left: 0, top: 0, visibility: 'hidden', maxWidth: MAX_WIDTH }
            }
          >
            {options.map((option, index) => {
              const isSelected = index === selectedIndex
              const Icon = option.icon
              return (
                <Fragment key={option.value}>
                  <div
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    data-testid="select-option"
                    data-value={option.value}
                    data-active={index === active || undefined}
                    // Keep focus on the button while clicking an option.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setActive(index)}
                    onClick={() => choose(index)}
                    className={`flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm select-none ${
                      index === active ? 'bg-ink/[0.07]' : ''
                    } ${option.muted ? 'text-muted' : 'text-fg'}`}
                  >
                    {Icon && (
                      <Icon
                        size={15}
                        className={`shrink-0 ${option.muted ? '' : isSelected ? 'text-accent' : 'text-muted/70'}`}
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate" title={option.label}>
                      {option.label}
                    </span>
                    <Check size={15} className={`shrink-0 text-accent ${isSelected ? '' : 'invisible'}`} aria-hidden="true" />
                  </div>
                  {option.separatorAfter && index < options.length - 1 && (
                    <div aria-hidden="true" className="mx-1.5 my-1 h-px bg-ink/[0.07]" />
                  )}
                </Fragment>
              )
            })}
            {footer && <div className="px-2.5 pt-1 pb-1.5 text-xs text-muted">{footer}</div>}
          </div>,
          document.body
        )}
    </>
  )
}
