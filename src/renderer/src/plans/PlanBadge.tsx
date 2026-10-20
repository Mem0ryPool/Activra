import {
  BookOpen,
  Briefcase,
  Code,
  Crown,
  Dumbbell,
  Flame,
  Flower,
  Footprints,
  GraduationCap,
  HeartPulse,
  Languages,
  Lock,
  Moon,
  Music,
  NotebookPen,
  PenLine,
  PiggyBank,
  Sparkles,
  Target,
  Trophy,
  type LucideIcon
} from 'lucide-react'
import type { AchievementSpec, PlanIcon, Rarity } from '../../../shared/planner/types'
import { useT } from '../store/appStore'

export const PLAN_ICON_COMPONENTS: Record<PlanIcon, LucideIcon> = {
  'book-open': BookOpen,
  languages: Languages,
  'graduation-cap': GraduationCap,
  'notebook-pen': NotebookPen,
  code: Code,
  dumbbell: Dumbbell,
  footprints: Footprints,
  flower: Flower,
  moon: Moon,
  'heart-pulse': HeartPulse,
  'pen-line': PenLine,
  music: Music,
  sparkles: Sparkles,
  'piggy-bank': PiggyBank,
  briefcase: Briefcase,
  target: Target,
  flame: Flame,
  trophy: Trophy,
  crown: Crown
}

/** Rarity colors; readable on both the light and the dark appearance. */
export const RARITY_TEXT: Record<Rarity, string> = {
  common: 'text-muted',
  uncommon: 'text-emerald-500',
  rare: 'text-sky-500',
  epic: 'text-violet-500',
  legendary: 'text-gold'
}

const RARITY_RING: Record<Rarity, string> = {
  common: 'ring-ink/15',
  uncommon: 'ring-emerald-500/40',
  rare: 'ring-sky-500/45',
  epic: 'ring-violet-500/45',
  legendary: 'ring-gold/60'
}

export function RarityLabel({ rarity }: { rarity: Rarity }): React.JSX.Element {
  const t = useT()
  return (
    <span data-testid="rarity" data-rarity={rarity} className={`text-[11px] font-medium ${RARITY_TEXT[rarity]}`}>
      {t(`rarity.${rarity}`)}
    </span>
  )
}

/** Square achievement icon. Locked ones are dimmed with a small lock; the plan's master gets a gold frame. */
export function PlanBadge({
  spec,
  unlocked,
  master = false,
  size = 'md'
}: {
  spec: Pick<AchievementSpec, 'icon' | 'rarity'>
  unlocked: boolean
  master?: boolean
  size?: 'sm' | 'md'
}): React.JSX.Element {
  const Icon = PLAN_ICON_COMPONENTS[spec.icon]
  const box = size === 'sm' ? 'size-9' : 'size-11'
  return (
    <div
      className={`relative flex ${box} shrink-0 items-center justify-center rounded-lg ring-1 ${
        unlocked
          ? `bg-gradient-to-b from-badge-from to-badge-to ${RARITY_TEXT[spec.rarity]} ${RARITY_RING[spec.rarity]}`
          : 'bg-ink/[0.05] text-muted/70 ring-ink/10'
      } ${master && unlocked ? 'plan-master-badge' : ''}`}
    >
      <Icon size={size === 'sm' ? 17 : 20} />
      {!unlocked && (
        <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-card text-muted ring-1 ring-line">
          <Lock size={9} />
        </span>
      )}
    </div>
  )
}
