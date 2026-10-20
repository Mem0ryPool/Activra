import { Ban, Check, CircleDot, Clock, X, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { NodeProgress } from '../../../shared/planner/progress'
import { formatWindow } from '../lib/windowText'
import { useAppStore, useT } from '../store/appStore'

type SlotState = NodeProgress['state']

/**
 * Each state has its own icon and fill pattern, not only its own color, so it reads the same with any
 * color vision: done = filled with a check, open = outlined with a dot, not open yet = dashed with a
 * clock, missed = striped with a cross.
 */
const SEGMENT: Record<SlotState, { icon: LucideIcon; className: string }> = {
  done: { icon: Check, className: 'bg-emerald-600 text-white ring-1 ring-emerald-600' },
  open: { icon: CircleDot, className: 'bg-accent/15 text-accent ring-2 ring-inset ring-accent' },
  upcoming: { icon: Clock, className: 'border border-dashed border-ink/30 bg-ink/[0.03] text-muted' },
  missed: { icon: X, className: 'slot-missed text-danger-fg ring-1 ring-inset ring-danger/50' },
  broken: { icon: Ban, className: 'slot-missed text-danger-fg ring-1 ring-inset ring-danger/50' }
}

const LEGEND: SlotState[] = ['done', 'open', 'upcoming', 'missed']

/** At most this many segments per row; more slots wrap onto further rows instead of overflowing. */
const PER_ROW = 12

/**
 * A timed goal as one block per time slot (Phase 6.3). Pointing at a block shows its window and state
 * as a tooltip; clicking or focusing it shows the same text below the blocks (also read out to screen
 * readers). Display only: the states come from `evaluatePlan`, nothing here decides progress.
 */
export function SlotSegments({
  nodes,
  now,
  legend = true
}: {
  nodes: NodeProgress[]
  now: number
  /** The legend (and the idle hint) can live elsewhere, e.g. in a card's details. */
  legend?: boolean
}): React.JSX.Element {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  const [selected, setSelected] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const describe = (node: NodeProgress): string =>
    t('plans.segment.label', { n: node.index + 1, window: formatWindow(node.window, now, t, locale), state: t(`plans.node.${node.state}`) })
  const shown = nodes.find((n) => n.index === (hovered ?? selected)) ?? null

  return (
    <div className="flex flex-col gap-1.5">
      <ol
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.min(nodes.length, PER_ROW)}, minmax(0, 1fr))` }}
        aria-label={t('plans.segments.label')}
        data-testid="plan-segments"
      >
        {nodes.map((node) => {
          const { icon: Icon, className } = SEGMENT[node.state]
          const label = describe(node)
          return (
            <li key={node.index} className="min-w-0">
              <button
                type="button"
                data-testid="plan-node"
                data-state={node.state}
                aria-label={label}
                aria-pressed={selected === node.index}
                title={label}
                onClick={() => setSelected(node.index)}
                onFocus={() => setSelected(node.index)}
                onMouseEnter={() => setHovered(node.index)}
                onMouseLeave={() => setHovered(null)}
                className={`flex h-6 w-full items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className} ${
                  selected === node.index ? 'outline-2 outline-offset-1 outline-fg/40' : ''
                }`}
              >
                <Icon size={13} strokeWidth={2.5} aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ol>
      {(legend || shown) && (
        <p className="min-h-4 text-[11px] text-muted tabular-nums" aria-live="polite" data-testid="plan-segment-detail">
          {shown ? describe(shown) : t('plans.segments.hint')}
        </p>
      )}
      {legend && <SlotLegend />}
    </div>
  )
}

/** What each block style means. */
export function SlotLegend(): React.JSX.Element {
  const t = useT()
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted" data-testid="plan-segment-legend" aria-label={t('plans.segments.legend')}>
      {LEGEND.map((state) => {
        const { icon: Icon, className } = SEGMENT[state]
        return (
          <li key={state} className="inline-flex items-center gap-1">
            <span className={`flex size-3.5 items-center justify-center rounded-[3px] ${className}`} aria-hidden="true">
              <Icon size={9} strokeWidth={3} />
            </span>
            {t(`plans.node.${state}`)}
          </li>
        )
      })}
    </ul>
  )
}
