import { Crown, Flame, Medal, Star, Target, Trophy, type LucideIcon } from 'lucide-react'
import type { BuiltInIcon } from '../../../shared/themes'

export const ACHIEVEMENT_ICONS: Record<BuiltInIcon, LucideIcon> = {
  trophy: Trophy,
  star: Star,
  crown: Crown,
  medal: Medal,
  flame: Flame,
  target: Target
}
