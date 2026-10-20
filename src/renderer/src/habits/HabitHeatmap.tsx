import { useMemo } from 'react'
import { yearColumns, type CalendarDay, type WeekStart } from '../../../shared/calendar'
import { habitDayStatus, type HabitDayStatus } from '../../../shared/habits/streak'
import type { Habit } from '../../../shared/habits/types'
import type { TranslationKey } from '../../../shared/i18n'
import { useAppStore, useT } from '../store/appStore'

/**
 * Checked-in days are filled, paused days are an outline (shape, not only color), other days a faint
 * cell; days before the habit started or ahead of today are left out.
 */
const STATUS_CLASS: Record<HabitDayStatus, string> = {
  done: 'bg-accent',
  paused: 'ring-1 ring-inset ring-ink/30',
  empty: 'bg-ink/[0.06]',
  off: 'bg-ink/[0.02]',
  outside: 'opacity-0'
}

const STATUS_LABEL: Record<Exclude<HabitDayStatus, 'outside'>, TranslationKey> = {
  done: 'habits.day.done',
  paused: 'habits.day.paused',
  empty: 'habits.day.empty',
  off: 'habits.day.off'
}

const LEGEND_LABEL: Record<Exclude<HabitDayStatus, 'outside'>, TranslationKey> = {
  done: 'habits.legend.done',
  paused: 'habits.legend.paused',
  empty: 'habits.legend.empty',
  off: 'habits.legend.off'
}

/** The last 53 weeks of one habit, like the Statistics page's year view. */
export function HabitHeatmap({
  habit,
  days,
  today
}: {
  habit: Habit
  /** Dates with a counted check-in. */
  days: Set<string>
  today: string
}): React.JSX.Element {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  const weekStart: WeekStart = locale === 'zh-CN' ? 1 : 0
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const columns = useMemo(() => yearColumns(new Date(y, m - 1, d), weekStart), [y, m, d, weekStart])
  const fmt = useMemo(
    () => ({
      day: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }),
      month: new Intl.DateTimeFormat(locale, { month: 'short' })
    }),
    [locale]
  )
  const dateOf = (day: CalendarDay): Date => new Date(day.year, day.month, day.day)
  const total = columns.flat().filter((day) => day.key <= today && days.has(day.key)).length

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted" data-testid="habit-history-total">
        {t('habits.history.total', { count: total })}
      </p>
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1">
          <div className="flex gap-[2px] text-[10px] text-muted" aria-hidden="true">
            {columns.map((col, i) => {
              const first = col.find((day) => day.day === 1)
              return (
                <span key={i} className="w-[9px] overflow-visible whitespace-nowrap">
                  {first && i < columns.length - 1 ? fmt.month.format(dateOf(first)) : ''}
                </span>
              )
            })}
          </div>
          <div className="flex gap-[2px]" data-testid="habit-heatmap" role="img" aria-label={t('habits.history.total', { count: total })}>
            {columns.map((col, i) => (
              <div key={i} className="flex flex-col gap-[2px]">
                {col.map((day) => {
                  const status = habitDayStatus(habit, days, day.key, today)
                  const label = status === 'outside' ? undefined : `${fmt.day.format(dateOf(day))}: ${t(STATUS_LABEL[status])}`
                  return (
                    <span
                      key={day.key}
                      data-testid="habit-heatmap-day"
                      data-day={day.key}
                      data-status={status}
                      title={label}
                      className={`size-[9px] rounded-[2px] ${STATUS_CLASS[status]} ${day.key === today ? 'outline outline-1 outline-accent' : ''}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted" aria-hidden="true">
        {(habit.frequency.kind === 'weekdays' ? (['done', 'paused', 'empty', 'off'] as const) : (['done', 'paused', 'empty'] as const)).map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span className={`size-[9px] rounded-[2px] ${STATUS_CLASS[status]}`} />
            {t(LEGEND_LABEL[status])}
          </span>
        ))}
      </div>
    </div>
  )
}
