import { templateFor } from './templates'
import { RARITIES, type AchievementSpec, type GoalCategory, type GoalCondition, type Rarity } from './types'

/**
 * Generates a goal's achievement (name, description, icon, rarity) from the template library and the
 * goal's rule. Everything is derived locally and deterministically; the user can edit the result.
 */

export type PlanLanguage = 'zh' | 'en'

/** 0–4: how much effort the rule asks for. Rarity follows it. */
export function difficulty(condition: GoalCondition): number {
  const tier = (value: number, steps: number[]): number => {
    const index = steps.findIndex((s) => value <= s)
    return index === -1 ? steps.length : index
  }
  switch (condition.kind) {
    case 'once':
      return condition.onTime && condition.due ? 1 : 0
    case 'count':
      return tier(condition.required, [3, 10, 24, 60])
    case 'weekly':
      return tier(condition.perWeek * condition.weeks, [4, 10, 20, 40])
    case 'streak':
      return tier(condition.length, [3, 7, 14, 30])
    case 'interval':
      return tier(condition.count, [1, 4, 8, 16])
  }
}

export function rarityFor(condition: GoalCondition): Rarity {
  return RARITIES[Math.max(0, Math.min(4, difficulty(condition)))] as Rarity
}

function formatDate(key: string, language: PlanLanguage): string {
  const [, m, d] = key.split('-').map(Number)
  if (language === 'zh') return `${m}月${d}日`
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[(m ?? 1) - 1]} ${d}`
}

/** Plain-language unlock condition, e.g. "30 天内完成 30 次「背单词」". */
export function describeCondition(title: string, condition: GoalCondition, language: PlanLanguage): string {
  const zh = language === 'zh'
  const q = zh ? `「${title}」` : `"${title}"`
  switch (condition.kind) {
    case 'once':
      if (condition.due && condition.onTime) {
        return zh
          ? `在${formatDate(condition.due, language)}或之前完成任务${q}`
          : `Complete the task ${q} by ${formatDate(condition.due, language)}`
      }
      return zh ? `完成任务${q}` : `Complete the task ${q}`
    case 'count':
      if (condition.required === condition.days && condition.every === 1) {
        return zh ? `${condition.days} 天里每天完成${q}` : `Complete ${q} every day for ${condition.days} days`
      }
      return zh
        ? `${condition.days} 天内完成 ${condition.required} 次${q}`
        : `Complete ${q} ${condition.required} times within ${condition.days} days`
    case 'weekly':
      return zh
        ? `连续 ${condition.weeks} 周，每周完成 ${condition.perWeek} 次${q}`
        : `Complete ${q} ${condition.perWeek} times a week for ${condition.weeks} weeks`
    case 'streak':
      return zh ? `连续 ${condition.length} 天完成${q}` : `Complete ${q} ${condition.length} days in a row`
    case 'interval': {
      const span = formatMinutes(condition.minutes * condition.count, language)
      if (condition.count === 1) return zh ? `${span}内完成${q}` : `Complete ${q} within ${span}`
      const each = condition.minutes === 60 ? (zh ? '每小时' : 'every hour') : zh ? `每 ${formatMinutes(condition.minutes, language)}` : `every ${formatMinutes(condition.minutes, language)}`
      return zh
        ? `${span}内${each}完成一次${q}，共 ${condition.count} 次`
        : `Complete ${q} once ${each} for ${span} (${condition.count} times)`
    }
  }
}

/** "4 小时", "30 分钟", "1 小时 30 分钟" / "4 hours", "30 minutes". */
export function formatMinutes(minutes: number, language: PlanLanguage): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (language === 'zh') return [h ? `${h} 小时` : '', m ? `${m} 分钟` : ''].filter(Boolean).join(' ')
  const unit = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
  return [h ? unit(h, 'hour') : '', m ? unit(m, 'minute') : ''].filter(Boolean).join(' ')
}

export function generateAchievement(
  title: string,
  category: GoalCategory,
  condition: GoalCondition,
  language: PlanLanguage
): AchievementSpec {
  const template = templateFor(category)
  const rarity = rarityFor(condition)
  const level = RARITIES.indexOf(rarity)
  return {
    name: template.names[language][level] as string,
    description: describeCondition(title, condition, language),
    icon: condition.kind === 'streak' && level >= 2 ? 'flame' : template.icon,
    rarity
  }
}

/**
 * Whether a plan gets the "All achievements!" achievement: two or more goals, or one goal made of two
 * or more time windows ("every hour for the next 4 hours": all four nodes).
 */
export function masterEligible(conditions: readonly (GoalCondition | null)[]): boolean {
  return conditions.length >= 2 || conditions.some((c) => c?.kind === 'interval' && c.count >= 2)
}

/**
 * The extra achievement for completing every goal of a plan. Its name is fixed by the product.
 * `nodeCount` is set for a plan of a single interval goal: it counts time windows instead of goals.
 */
export function generateMasterAchievement(
  goalRarities: Rarity[],
  goalCount: number,
  language: PlanLanguage,
  nodeCount: number | null = null
): AchievementSpec {
  const highest = Math.max(0, ...goalRarities.map((r) => RARITIES.indexOf(r)))
  const zh = language === 'zh'
  return {
    name: zh ? '全成就！' : 'All Achievements!',
    description:
      goalCount === 1 && nodeCount !== null
        ? zh
          ? `按时完成本计划全部 ${nodeCount} 个时段`
          : `Complete all ${nodeCount} time slots of this plan on time`
        : zh
          ? `达成本计划全部 ${goalCount} 个目标`
          : `Achieve all ${goalCount} goals of this plan`,
    icon: 'crown',
    rarity: RARITIES[Math.min(4, highest + 1)] as Rarity
  }
}
