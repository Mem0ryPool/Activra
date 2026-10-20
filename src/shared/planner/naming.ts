import type { PlanLanguage } from './achievements'
import { daysBetween, endOfMonth, endOfWeek } from './dateMath'
import { draftCondition, occurrencesIn } from './draft'
import { ZH_NUMBER } from './numbers'
import type { DraftGoal } from './types'

/**
 * Plan names (Phase 6.2): "接下来4个小时内每个小时都喝水" → "4小时喝水挑战", "未来7天每天健身" →
 * "7天健身挑战", "本周完成3次数学复习" → "本周数学复习计划". The name is built only from what the goals
 * already say (their task, rule and length); when that is not clear enough it falls back to a
 * neutral name. It never adds a goal or a number. The user can always change it in the preview.
 *
 * "挑战" means every day / window is required; "计划" means a looser rule (some days of a span,
 * N times a week).
 */

/** Longest task wording used inside a name; longer titles leave the task out of the name. */
const MAX_NOUN = { zh: 10, en: 32 } as const

export function neutralPlanTitle(language: PlanLanguage): string {
  return language === 'zh' ? '新计划' : 'New plan'
}

const ZH_COUNTERS = '个|杯|页|章|篇|道|题|组|节|遍|首|步|课|集|本|套|次|分钟|小时|个小时|公里|千米|米'

/** The task part of a name: in Chinese without amounts ("背20个英语单词" → "背英语单词", "完成数学复习" → "数学复习"). */
export function goalNoun(title: string, language: PlanLanguage): string | null {
  let t = title.trim()
  if (language === 'zh') {
    t = t
      .replace(new RegExp(`(?:\\d+(?:\\.\\d+)?|${ZH_NUMBER})\\s*(?:${ZH_COUNTERS})`, 'g'), '')
      .replace(/\s+/g, '')
    const withoutVerb = t.replace(/^(?:完成|做完|做|进行|去)/, '')
    if (withoutVerb.length >= 2) t = withoutVerb
  } else {
    // English keeps amounts ("Read 10 pages"): without them the verb alone says too little.
    t = t.replace(/\s+/g, ' ')
    if (t) t = t[0]!.toUpperCase() + t.slice(1)
  }
  if (!t || !/[\p{L}]/u.test(t) || t.length > MAX_NOUN[language]) return null
  return t
}

const THIS_WEEK = /本周|这周|这个星期|本星期|这一周|\bthis week\b/i
const THIS_MONTH = /本月|这个月|这一个月|\bthis month\b/i

/** "本周" / "本月" when the text said so and the goal's window is exactly the rest of that week / month. */
function calendarSpan(goal: DraftGoal, days: number, today: string, sourceText: string): 'week' | 'month' | null {
  if (goal.startDate !== null && goal.startDate !== today) return null
  const said = `${goal.source} ${sourceText}`
  // The window runs from today for `days` days; it must end exactly on the week's / month's last day.
  if (THIS_WEEK.test(said) && days - 1 === daysBetween(today, endOfWeek(today))) return 'week'
  if (THIS_MONTH.test(said) && days - 1 === daysBetween(today, endOfMonth(today))) return 'month'
  return null
}

function spanText(minutes: number, language: PlanLanguage): string {
  if (minutes % 60 === 0) return language === 'zh' ? `${minutes / 60}小时` : `${minutes / 60}-hour`
  return language === 'zh' ? `${minutes}分钟` : `${minutes}-minute`
}

/** What a single goal is called: { lead, kind } is joined with the task, e.g. "7天" + "健身" + "挑战". */
interface NamePart {
  lead: string
  /** challenge: every day / window counts; plan: a looser rule. */
  kind: 'challenge' | 'plan'
}

function namePart(goal: DraftGoal, today: string, sourceText: string, language: PlanLanguage): NamePart | null {
  const c = draftCondition(goal)
  const zh = language === 'zh'
  if (!c) return null
  switch (c.kind) {
    case 'interval':
      return { lead: spanText(c.minutes * c.count, language), kind: 'challenge' }
    case 'count': {
      const all = c.required >= occurrencesIn(c.days, c.every)
      const calendar = calendarSpan(goal, c.days, today, sourceText)
      if (calendar === 'week') return { lead: zh ? '本周' : "this week's", kind: 'plan' }
      if (calendar === 'month') return { lead: zh ? '本月' : "this month's", kind: 'plan' }
      return { lead: zh ? `${c.days}天` : `${c.days}-day`, kind: all ? 'challenge' : 'plan' }
    }
    case 'streak':
      return { lead: zh ? `连续${c.length}天` : `${c.length}-day streak`, kind: 'challenge' }
    case 'weekly':
      return { lead: zh ? `${c.weeks}周` : `${c.weeks}-week`, kind: 'plan' }
    case 'once':
      return null
  }
}

function joinZh(part: NamePart, noun: string | null): string {
  return `${part.lead}${noun ?? ''}${part.kind === 'challenge' ? '挑战' : '计划'}`
}

function joinEn(part: NamePart, noun: string | null): string {
  const tail = part.lead.endsWith('streak') ? part.lead : `${part.lead} ${part.kind}`
  if (!noun) return tail[0]!.toUpperCase() + tail.slice(1)
  return `${noun}: ${tail}`
}

/** The span every repeating goal shares (all "30天" → "30天"), or null. */
function sharedLead(goals: readonly DraftGoal[], language: PlanLanguage): string | null {
  const spans = new Set<number>()
  for (const goal of goals) {
    const c = draftCondition(goal)
    if (!c || c.kind === 'once') continue
    if (c.kind === 'count' || c.kind === 'streak') spans.add(c.days)
    else if (c.kind === 'weekly') spans.add(c.weeks * 7)
    else return null
  }
  if (spans.size !== 1) return null
  const days = [...spans][0]!
  return language === 'zh' ? `${days}天` : `${days}-day`
}

/**
 * A short name for a plan made of these goals, in the text's language. `taken` are names already
 * used (other plans); a repeat gets a number ("4小时喝水挑战 2") instead of the same name twice.
 */
export function suggestPlanTitle(
  goals: readonly DraftGoal[],
  options: { language: PlanLanguage; today: string; sourceText: string; taken?: readonly string[] }
): string {
  const { language, today, sourceText } = options
  const zh = language === 'zh'
  let name: string | null = null
  if (goals.length === 1) {
    const goal = goals[0]!
    const noun = goalNoun(goal.title, language)
    const part = namePart(goal, today, sourceText, language)
    if (part) name = zh ? joinZh(part, noun) : joinEn(part, noun)
    else if (goal.kind === 'once' && goal.title.trim() && goal.title.trim().length <= MAX_NOUN[language]) name = goal.title.trim()
    else if (noun) name = zh ? `${noun}计划` : `${noun} plan`
  } else if (goals.length > 1) {
    const nouns = goals.map((g) => goalNoun(g.title, language))
    const lead = sharedLead(goals, language)
    const [a, b] = nouns
    if (a && b && goals.length === 2) {
      name = zh ? `${lead ?? ''}${a}和${b}计划` : `${a} & ${b[0]!.toLowerCase()}${b.slice(1)}${lead ? `: ${lead} plan` : ''}`
    } else if (a) {
      name = zh
        ? `${lead ?? ''}${a}等${goals.length}项计划`
        : `${a} + ${goals.length - 1} more goals${lead ? `: ${lead} plan` : ''}`
    } else {
      name = zh ? `${lead ?? ''}${goals.length}项目标计划` : `${lead ? `${lead[0]!.toUpperCase()}${lead.slice(1)} plan` : 'Plan'} · ${goals.length} goals`
    }
  }
  const base = name ?? neutralPlanTitle(language)
  const taken = new Set((options.taken ?? []).map((t) => t.trim()))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!taken.has(candidate)) return candidate
  }
}
