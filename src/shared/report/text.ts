import type { Translate } from '../i18n'
import type { Locale } from '../types'
import type { WeeklyInsight, WeeklyReport } from './weekly'

function dateLabel(key: string, locale: Locale): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d))
}

/** "10月12日 – 10月18日" / "Oct 12 – Oct 18". */
export function weekRange(report: Pick<WeeklyReport, 'start' | 'end'>, t: Translate, locale: Locale): string {
  return t('report.range', { start: dateLabel(report.start, locale), end: dateLabel(report.end, locale) })
}

/** Monday = 0 … Sunday = 6, as the report counts days. */
export function weekdayLong(index: number, locale: Locale): string {
  // 2023-01-02 was a Monday.
  return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(2023, 0, 2 + index))
}

export function weekdayShort(index: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2023, 0, 2 + index))
}

export function insightText(insight: WeeklyInsight, t: Translate, locale: Locale): string {
  switch (insight.kind) {
    case 'best-day':
      return t('report.insight.bestDay', { weekday: weekdayLong(insight.weekday, locale), count: insight.count })
    case 'tasks-up':
    case 'tasks-down':
      return t(insight.kind === 'tasks-up' ? 'report.insight.tasksUp' : 'report.insight.tasksDown', {
        percent: insight.percent,
        previous: insight.previous,
        current: insight.current
      })
    case 'tasks-first':
      return t('report.insight.tasksFirst', { current: insight.current })
    case 'focus-up':
    case 'focus-down':
      return t(insight.kind === 'focus-up' ? 'report.insight.focusUp' : 'report.insight.focusDown', {
        percent: insight.percent,
        previous: insight.previousMin,
        current: insight.currentMin
      })
    case 'habit-perfect':
      return t('report.insight.habitPerfect', { name: insight.name })
    case 'habit-attention':
      return t('report.insight.habitAttention', { name: insight.name, done: insight.done, due: insight.due })
    case 'focus-unfinished':
      return t('report.insight.focusUnfinished', { early: insight.endedEarly, completed: insight.completed })
    case 'quiet-week':
      return t('report.insight.quietWeek')
  }
}

const minutes = (sec: number): number => Math.round(sec / 60)

/** The report as plain text, for "Copy report" (pasting into notes or a chat). */
export function weeklyReportText(r: WeeklyReport, t: Translate, locale: Locale): string {
  const lines: string[] = [t('report.copyTitle', { start: dateLabel(r.start, locale), end: dateLabel(r.end, locale) })]
  if (r.current) lines.push(t('report.inProgress'))
  lines.push('')
  lines.push(`${t('report.tasks')}: ${r.tasks.completed} (${t('report.vsLast', { count: r.tasks.previous })})`)
  lines.push(`${t('report.activeDays')}: ${t('report.activeDaysValue', { count: r.tasks.activeDays })}`)
  lines.push(
    `${t('report.focus')}: ${t('report.focusValue', { minutes: minutes(r.focus.focusedSec) })} · ${t('report.focusSessions', {
      completed: r.focus.completed,
      early: r.focus.endedEarly
    })}`
  )
  const due = r.habits.reduce((s, h) => s + h.due, 0)
  if (due > 0) lines.push(`${t('report.habits')}: ${t('report.habitsValue', { done: r.habits.reduce((s, h) => s + h.done, 0), due })}`)
  if (r.insights.length > 0) {
    lines.push('', `${t('report.insights')}:`)
    for (const i of r.insights) lines.push(`- ${insightText(i, t, locale)}`)
  }
  const achievements = [...r.plans.goals.map((g) => g.name), ...r.plans.plansCompleted.map((p) => t('report.planDone', { name: p.name }))]
  if (achievements.length > 0) {
    lines.push('', `${t('report.plans')}:`)
    for (const a of achievements) lines.push(`- ${a}`)
  }
  return lines.join('\n')
}
