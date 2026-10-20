import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  activityLevel,
  completionsByDay,
  dayKey,
  monthGrid,
  yearColumns,
  type CalendarDay,
  type WeekStart
} from '../../../shared/calendar'
import { missedByDay } from '../../../shared/recurrence'
import { flexibleTaskIds } from '../../../shared/planner/sync'
import type { CompletionEvent, Task } from '../../../shared/types'
import { useTaskName } from '../hooks/useTaskName'
import { useAppStore, useT } from '../store/appStore'

type View = 'month' | 'year'

/** Fill per activity level. Level 0 is a neutral cell: a day without completions is not a failure. */
const LEVEL_CLASS = ['bg-ink/[0.04]', 'bg-accent/25', 'bg-accent/45', 'bg-accent/70', 'bg-accent'] as const

function dateOf(day: CalendarDay): Date {
  return new Date(day.year, day.month, day.day)
}

export function ActivityCalendar({
  tasks,
  completions,
  now
}: {
  tasks: readonly Task[]
  completions: readonly CompletionEvent[]
  now: number
}): React.JSX.Element {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  const weekStart: WeekStart = locale === 'zh-CN' ? 1 : 0
  const today = new Date(now)
  const todayKey = dayKey(today)

  const [view, setView] = useState<View>('month')
  const [shown, setShown] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }))
  const [selected, setSelected] = useState<string>(todayKey)

  const byDay = useMemo(() => completionsByDay(completions), [completions])
  const count = (key: string): number => byDay.get(key)?.length ?? 0

  const fmt = useMemo(
    () => ({
      month: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }),
      monthShort: new Intl.DateTimeFormat(locale, { month: 'short' }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      day: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
    }),
    [locale]
  )

  const grid = useMemo(() => monthGrid(shown.year, shown.month, weekStart), [shown, weekStart])
  // Repeating-task days that were planned but not done. Shown apart from "nothing planned", never as failure.
  // A plan goal like "3 times a week" can be done on any day, so its other days are not missed.
  const plans = useAppStore((s) => s.plans)
  const fixedTasks = useMemo(() => {
    const flexible = flexibleTaskIds(plans)
    return tasks.filter((task) => !flexible.has(task.id))
  }, [tasks, plans])
  const missed = useMemo(
    () => missedByDay(fixedTasks, completions, grid[0]?.key ?? todayKey, grid.at(-1)?.key ?? todayKey, todayKey),
    [fixedTasks, completions, grid, todayKey]
  )
  const selectedMissed = useMemo(
    () => missedByDay(fixedTasks, completions, selected, selected, todayKey).get(selected) ?? [],
    [fixedTasks, completions, selected, todayKey]
  )
  // Weekday names starting from weekStart; 2023-01-01 was a Sunday.
  const weekdays = Array.from({ length: 7 }, (_, i) => fmt.weekday.format(new Date(2023, 0, 1 + ((weekStart + i) % 7))))
  const isCurrentMonth = shown.year === today.getFullYear() && shown.month === today.getMonth()
  const shiftMonth = (delta: number): void =>
    setShown((s) => {
      const d = new Date(s.year, s.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })

  const selectedTasks = byDay.get(selected) ?? []
  const taskName = useTaskName()
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const [sy, sm, sd] = selected.split('-').map(Number) as [number, number, number]

  return (
    <section
      data-testid="activity-calendar"
      className="mt-6 rounded-[var(--radius-card)] bg-card p-4 ring-1 ring-ink/[0.04]"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">{t('calendar.title')}</h2>
        <div className="ml-auto flex gap-1" role="tablist">
          {(['month', 'year'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`h-7 rounded-md px-2.5 text-xs transition-colors ${
                view === id ? 'bg-ink/[0.08] font-medium text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {t(id === 'month' ? 'calendar.view.month' : 'calendar.view.year')}
            </button>
          ))}
        </div>
      </div>

      {view === 'month' ? (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-1">
            <button
              type="button"
              aria-label={t('calendar.prevMonth')}
              onClick={() => shiftMonth(-1)}
              className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-ink/5 hover:text-fg"
            >
              <ChevronLeft size={16} />
            </button>
            <p data-testid="calendar-month" className="min-w-32 text-center text-sm font-medium tabular-nums">
              {fmt.month.format(new Date(shown.year, shown.month, 1))}
            </p>
            <button
              type="button"
              aria-label={t('calendar.nextMonth')}
              onClick={() => shiftMonth(1)}
              className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-ink/5 hover:text-fg"
            >
              <ChevronRight size={16} />
            </button>
            {!isCurrentMonth && (
              <button
                type="button"
                onClick={() => {
                  setShown({ year: today.getFullYear(), month: today.getMonth() })
                  setSelected(todayKey)
                }}
                className="ml-1 h-7 rounded-md px-2 text-xs text-muted hover:bg-ink/5 hover:text-fg"
              >
                {t('calendar.today')}
              </button>
            )}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
            {weekdays.map((w, i) => (
              <div key={i} className="pb-1">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1" role="grid">
            {grid.map((day) => {
              const n = count(day.key)
              const m = missed.get(day.key)?.length ?? 0
              const future = day.key > todayKey
              const isToday = day.key === todayKey
              const isSelected = day.key === selected
              return (
                <button
                  key={day.key}
                  type="button"
                  role="gridcell"
                  data-testid="calendar-day"
                  data-day={day.key}
                  data-count={n}
                  data-missed={m}
                  aria-current={isToday ? 'date' : undefined}
                  aria-selected={isSelected}
                  aria-label={`${fmt.day.format(dateOf(day))}: ${t('calendar.count', { count: n })}${
                    m > 0 ? `, ${t('calendar.missed', { count: m })}` : ''
                  }`}
                  disabled={future}
                  onClick={() => setSelected(day.key)}
                  className={`relative flex h-11 flex-col items-center justify-center rounded-md text-xs tabular-nums transition-colors disabled:cursor-default ${
                    day.inMonth ? '' : 'opacity-35'
                  } ${future ? 'text-muted/60' : 'hover:ring-1 hover:ring-ink/20'} ${
                    isSelected ? 'ring-2 ring-fg/70' : isToday ? 'ring-2 ring-accent' : ''
                  } ${n > 0 ? LEVEL_CLASS[activityLevel(n)] : ''}`}
                >
                  <span className={isToday ? 'font-semibold' : ''}>{day.day}</span>
                  {n > 0 && <span className="text-[10px] leading-none font-medium">{n}</span>}
                  {m > 0 && (
                    <span
                      data-testid="missed-dot"
                      className="absolute bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-muted/70"
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <YearHeatmap
          today={today}
          weekStart={weekStart}
          count={count}
          selected={selected}
          onSelect={setSelected}
          formatDay={(d) => fmt.day.format(dateOf(d))}
          formatMonth={(d) => fmt.monthShort.format(dateOf(d))}
        />
      )}

      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted">
        {view === 'month' && (
          <span className="mr-auto inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-muted/70" />
            {t('calendar.missedLegend')}
          </span>
        )}
        <span>{t('calendar.less')}</span>
        {LEVEL_CLASS.map((c, i) => (
          <span key={i} className={`size-2.5 rounded-[3px] ${c}`} />
        ))}
        <span>{t('calendar.more')}</span>
      </div>

      <div data-testid="calendar-detail" className="mt-4 border-t border-ink/[0.06] pt-3">
        <p className="text-sm font-medium">
          {fmt.day.format(new Date(sy, sm - 1, sd))}
          <span className="ml-2 font-normal text-muted">{t('calendar.count', { count: selectedTasks.length })}</span>
          {selectedMissed.length > 0 && (
            <span className="ml-2 font-normal text-muted">
              {t('calendar.missed', { count: selectedMissed.length })}
            </span>
          )}
        </p>
        {selectedTasks.length === 0 && selectedMissed.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('calendar.dayEmpty')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {selectedTasks.map((event) => (
              <li key={event.id} data-testid="calendar-task" className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 text-xs whitespace-nowrap text-muted tabular-nums">
                  {fmt.time.format(new Date(event.completedAt))}
                </span>
                <span className="min-w-0 truncate" title={taskName(taskById.get(event.taskId), event.title)}>
                  {taskName(taskById.get(event.taskId), event.title)}
                </span>
              </li>
            ))}
            {selectedMissed.map((task) => (
              <li
                key={`missed-${task.id}`}
                data-testid="calendar-missed"
                className="flex items-center gap-3 text-sm text-muted"
              >
                <span className="w-16 shrink-0 text-xs whitespace-nowrap">{t('calendar.missedItem')}</span>
                <span className="min-w-0 truncate" title={taskName(task)}>
                  {taskName(task)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function YearHeatmap({
  today,
  weekStart,
  count,
  selected,
  onSelect,
  formatDay,
  formatMonth
}: {
  today: Date
  weekStart: WeekStart
  count: (key: string) => number
  selected: string
  onSelect: (key: string) => void
  formatDay: (day: CalendarDay) => string
  formatMonth: (day: CalendarDay) => string
}): React.JSX.Element {
  const t = useT()
  const todayKey = dayKey(today)
  const columns = useMemo(() => yearColumns(today, weekStart), [today, weekStart])
  const total = columns.flat().reduce((sum, d) => (d.key <= todayKey ? sum + count(d.key) : sum), 0)
  return (
    <div className="mt-3">
      <p className="mb-2 text-xs text-muted">{t('calendar.yearTotal', { count: total })}</p>
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1">
          <div className="flex gap-[2px] text-[10px] text-muted">
            {columns.map((col, i) => {
              // Label a column when a month starts inside it.
              const first = col.find((d) => d.day === 1)
              return (
                <span key={i} className="w-[9px] overflow-visible whitespace-nowrap">
                  {first && i < columns.length - 1 ? formatMonth(first) : ''}
                </span>
              )
            })}
          </div>
          <div className="flex gap-[2px]" data-testid="year-heatmap">
            {columns.map((col, i) => (
              <div key={i} className="flex flex-col gap-[2px]">
                {col.map((day) => {
                  const n = count(day.key)
                  const future = day.key > todayKey
                  return (
                    <button
                      key={day.key}
                      type="button"
                      data-testid="heatmap-day"
                      data-day={day.key}
                      data-count={n}
                      aria-label={`${formatDay(day)}: ${t('calendar.count', { count: n })}`}
                      title={`${formatDay(day)}: ${t('calendar.count', { count: n })}`}
                      disabled={future}
                      onClick={() => onSelect(day.key)}
                      className={`size-[9px] rounded-[2px] ${future ? 'opacity-0' : LEVEL_CLASS[activityLevel(n)]} ${
                        day.key === selected ? 'ring-1 ring-fg' : day.key === todayKey ? 'ring-1 ring-accent' : ''
                      }`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
