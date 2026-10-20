import { useState, type ReactNode } from 'react'
import { Select as BaseSelect } from './Select'

export function Section({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <section>
      <h2 className="mb-1 px-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {hint && <p className="mb-2 px-1 text-xs text-muted/80">{hint}</p>}
      {!hint && <div className="mb-1" />}
      <div className="divide-y divide-ink/[0.05] rounded-[var(--radius-card)] bg-card ring-1 ring-ink/[0.04]">
        {children}
      </div>
    </section>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && (
          <p className="truncate text-xs text-muted" title={hint}>
            {hint}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  )
}

/** Slider that saves when released, not on every pixel of movement. */
export function RangeSetting({
  value,
  min,
  max,
  format,
  onCommit,
  onPreview,
  label
}: {
  value: number
  min: number
  max: number
  format: (v: number) => string
  onCommit: (v: number) => void
  /** Called on every movement, for a live preview that is not saved. */
  onPreview?: (v: number) => void
  label?: string
}): React.JSX.Element {
  // Holds the value while dragging and until that value is saved; otherwise the saved value is shown.
  const [draft, setDraft] = useState<number | null>(null)
  const [savedValue, setSavedValue] = useState(value)
  if (savedValue !== value) {
    setSavedValue(value)
    // An older save landing mid-drag must not yank the thumb back.
    if (draft === value) setDraft(null)
  }
  const shown = draft ?? value
  // Reads the input itself: a quick key press can release before React re-renders with the new draft.
  const commit = (e: React.SyntheticEvent<HTMLInputElement>): void => {
    const next = Number(e.currentTarget.value)
    if (next !== value) onCommit(next)
    else setDraft(null)
  }
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        value={shown}
        aria-label={label}
        onChange={(e) => {
          const v = Number(e.target.value)
          setDraft(v)
          onPreview?.(v)
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="w-44 accent-accent"
      />
      <span className="w-14 text-right text-sm tabular-nums text-muted">{format(shown)}</span>
    </>
  )
}

/** A settings row's single-select: the shared Select at the row's height and width. */
export function Select({
  value,
  options,
  onChange,
  label
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  label?: string
}): React.JSX.Element {
  return <BaseSelect value={value} options={options} onChange={onChange} label={label} size="sm" className="w-48!" />
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-ink/15'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  )
}
