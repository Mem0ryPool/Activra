import {
  AlarmClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crown,
  Flame,
  Hourglass,
  Repeat,
  Timer,
  Trophy,
  type LucideIcon
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { dayKey, monthGrid, type WeekStart } from '../../../shared/calendar'
import { dayTimeline, monthMarks, type TimelineItem } from '../../../shared/timeline'
import type { TranslationKey } from '../../../shared/i18n'
import { Button } from '../components/Button'
import { PageHeader } from '../components/PageHeader'
import { useNow } from '../hooks/useNow'
import { useTaskName } from '../hooks/useTaskName'
import { useAppStore, useT } from '../store/appStore'

const KIND_ICON: Record<TimelineItem['kind'], LucideIcon> = {
  completion: CheckCircle2,
  focus: Timer,
  checkin: Flame,
  achievement: Trophy,
  deadline: AlarmClock,
  occurrence: Repeat,
  window: Hourglass
}

/** Status chips: icon-free words, color only as a second cue. */
const STATUS_CLASS: Record<string, string> = {
  done: 'text-accent',
  overdue: 'text-danger-fg',
  missed: 'text-muted line-through decoration-1',
  upcoming: 'text-muted',
  today: 'text-fg',
  open: 'text-gold'
}

function keyOf(year: number, month: number, day: number): string {
  return dayKey(new Date(year, month, day))
}

/**
 * Calendar & timeline (Phase 6.9): a month grid with what each day had (completions, focus, check-ins,
 * open deadlines) and, for the chosen day, everything on it in time order — done and planned. Read-
 * only; a task entry opens it on the Tasks page.
 */
export function CalendarPage(): React.JSX.Element {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  const tasks = useAppStore((s) => s.tasks)
  const completions = useAppStore((s) => s.completions)
  const plans = useAppStore((s) => s.plans)
  const habits = useAppStore((s) => s.habits)
  const habitCheckins = useAppStore((s) => s.habitCheckins)
  const focusSessions = useAppStore((s) => s.focus?.sessions)
  const openTask = useAppStore((s) => s.openTask)
  const taskName = useTaskName()
  // Once a minute: statuses (open, overdue) and "today" follow the clock.
  const now = useNow(true, 60_000)
  const today = new Date(now)
  const todayKey = dayKey(today)
  const weekStart: WeekStart = locale === 'zh-CN' ? 1 : 0
  const [shown, setShown] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }))
  const [selected, setSelected] = useState(todayKey)

  const input = useMemo(
    () => ({ tasks, completions, plans, habits, habitCheckins, focusSessions: focusSessions ?? [] }),
    [tasks, completions, plans, habits, habitCheckins, focusSessions]
  )
  const grid = useMemo(() => monthGrid(shown.year, shown.month, weekStart), [shown, weekStart])
  const marks = useMemo(() => monthMarks(input, grid.map((d) => keyOf(d.year, d.month, d.day))), [input, grid])
  const items = useMemo(() => dayTimeline(input, selected, now), [input, selected, now])

  const fmt = useMemo(
    () => ({
      month: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      day: new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
    }),
    [locale]
  )
  const weekdays = Array.from({ length: 7 }, (_, i) => fmt.weekday.format(new Date(2023, 0, 1 + ((i + weekStart) % 7))))
  const move = (delta: number): void =>
    setShown((s) => {
      const d = new Date(s.year, s.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  const goToday = (): void => {
    setShown({ year: today.getFullYear(), month: today.getMonth() })
    setSelected(todayKey)
  }
  const [sy, sm, sd] = selected.split('-').map(Number) as [number, number, number]

  const titleOf = (item: TimelineItem): string => {
    if ('taskId' in item && item.taskId) {
      const task = tasks.find((x) => x.id === item.taskId)
      if (task) return taskName(task)
    }
    if (item.kind === 'achievement' && item.master) return t('report.planDone', { name: item.title })
    return item.title || t('calendar.noTask')
  }
  const detailOf = (item: TimelineItem): string | null => {
    if (item.kind === 'focus') {
      return t('calendar.focusDetail', {
        minutes: Math.round(item.focusedSec / 60),
        outcome: t(item.outcome === 'completed' ? 'focus.record.completed' : 'focus.record.endedEarly')
      })
    }
    if (item.kind === 'achievement') return item.planTitle
    return null
  }
  const timeOf = (item: TimelineItem): string => {
    if (item.at === null) return t('calendar.allDay')
    const start = fmt.time.format(new Date(item.at))
    return 'end' in item ? `${start}–${fmt.time.format(new Date(item.end))}` : start
  }

  return (
    <>
      <PageHeader title={t('nav.calendar')} subtitle={t('calendar.subtitle')} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8" data-testid="calendar-page">
        <div className="flex flex-wrap items-start gap-3">
          <section className="w-full max-w-[380px] min-w-[300px] flex-1 rounded-[var(--radius-card)] bg-card p-4 ring-1 ring-ink/[0.04]">
            <div className="mb-3 flex items-center gap-1">
              <button
                type="button"
                aria-label={t('calendar.prevMonth')}
                data-testid="calendar-prev"
                onClick={() => move(-1)}
                className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-ink/5 hover:text-fg"
              >
                <ChevronLeft size={17} />
              </button>
              <h2 className="min-w-0 flex-1 text-center text-sm font-semibold" data-testid="calendar-month">
                {fmt.month.format(new Date(shown.year, shown.month, 1))}
              </h2>
              <button
                type="button"
                aria-label={t('calendar.nextMonth')}
                data-testid="calendar-next"
                onClick={() => move(1)}
                className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-ink/5 hover:text-fg"
              >
                <ChevronRight size={17} />
              </button>
              <Button variant="ghost" className="ml-1 h-8 px-2.5" data-testid="calendar-today" onClick={goToday}>
                {t('calendar.today')}
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={fmt.month.format(new Date(shown.year, shown.month, 1))}>
              {weekdays.map((w) => (
                <span key={w} className="pb-1 text-[11px] text-muted" role="columnheader">
                  {w}
                </span>
              ))}
              {grid.map((d) => {
                const key = keyOf(d.year, d.month, d.day)
                const m = marks.get(key)
                const isSelected = key === selected
                const isToday = key === todayKey
                return (
                  <button
                    key={key}
                    type="button"
                    role="gridcell"
                    aria-selected={isSelected}
                    aria-label={fmt.day.format(new Date(d.year, d.month, d.day))}
                    data-testid="calendar-day"
                    data-day={key}
                    data-completed={m?.completed ?? 0}
                    data-due={m?.due ?? 0}
                    onClick={() => setSelected(key)}
                    className={`flex h-12 flex-col items-center justify-center gap-1 rounded-lg text-sm transition-colors ${
                      isSelected ? 'bg-accent/15 ring-1 ring-accent/60' : 'hover:bg-ink/[0.05]'
                    } ${d.inMonth ? '' : 'opacity-40'}`}
                  >
                    <span className={`tabular-nums ${isToday ? 'font-semibold text-accent' : ''}`}>{d.day}</span>
                    <span className="flex h-1.5 items-center gap-0.5" aria-hidden="true">
                      {m && m.completed > 0 && <span className="size-1.5 rounded-full bg-accent" />}
                      {m && m.focusSec > 0 && <span className="size-1.5 rounded-full bg-gold" />}
                      {m && m.checkins > 0 && <span className="size-1.5 rounded-full bg-fg/45" />}
                      {m && m.due > 0 && <span className="size-1.5 rounded-full border border-warn" />}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-accent" />
                {t('calendar.legend.completed')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-gold" />
                {t('calendar.legend.focus')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-fg/45" />
                {t('calendar.legend.checkin')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full border border-warn" />
                {t('calendar.legend.due')}
              </span>
            </p>
          </section>

          <section
            className="min-w-[280px] flex-[2] rounded-[var(--radius-card)] bg-card px-5 py-4 ring-1 ring-ink/[0.04]"
            data-testid="calendar-timeline"
            data-day={selected}
          >
            <h2 className="mb-3 text-sm font-semibold" data-testid="calendar-day-title">
              {fmt.day.format(new Date(sy, sm - 1, sd))}
            </h2>
            {items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">{t('calendar.empty')}</p>
            ) : (
              <ol className="relative flex flex-col">
                {items.map((item) => {
                  const Icon = item.kind === 'achievement' && item.master ? Crown : KIND_ICON[item.kind]
                  const status = 'status' in item ? item.status : null
                  const taskId = 'taskId' in item ? item.taskId : null
                  const detail = detailOf(item)
                  return (
                    <li
                      key={`${item.kind}-${item.id}`}
                      className="flex items-start gap-3 border-b border-ink/[0.05] py-2.5 last:border-b-0"
                      data-testid="timeline-item"
                      data-kind={item.kind}
                      data-status={status ?? ''}
                    >
                      <span className="w-[86px] shrink-0 pt-0.5 text-xs text-muted tabular-nums">{timeOf(item)}</span>
                      <Icon size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-baseline gap-2 text-sm">
                          <span className="sr-only">{t(`calendar.kind.${item.kind}` as TranslationKey)}: </span>
                          {taskId && tasks.some((x) => x.id === taskId) ? (
                            <button
                              type="button"
                              title={t('calendar.openTask')}
                              onClick={() => openTask(taskId)}
                              className="min-w-0 truncate text-left hover:underline"
                            >
                              {titleOf(item)}
                            </button>
                          ) : (
                            <span className="min-w-0 truncate">{titleOf(item)}</span>
                          )}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {t(`calendar.kind.${item.kind}` as TranslationKey)}
                          {detail ? ` · ${detail}` : ''}
                        </p>
                      </div>
                      {status && (
                        <span className={`shrink-0 pt-0.5 text-xs ${STATUS_CLASS[status] ?? 'text-muted'}`}>
                          {t(`calendar.status.${status}` as TranslationKey)}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        </div>
        <p className="mt-3 px-1 text-xs text-muted">{t('calendar.help')}</p>
      </div>
    </>
  )
}
