import { Check, ChevronLeft, ChevronRight, Copy, Lightbulb, Timer, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { dayKey } from '../../../shared/dates'
import { weekStartOf } from '../../../shared/habits/streak'
import { addDays } from '../../../shared/recurrence'
import { insightText, weekRange, weekdayShort, weeklyReportText } from '../../../shared/report/text'
import { buildWeeklyReport } from '../../../shared/report/weekly'
import { Button } from '../components/Button'
import { useAppStore, useT } from '../store/appStore'

const minutes = (sec: number): number => Math.round(sec / 60)

function Tile({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-[var(--radius-card)] bg-card p-4 ring-1 ring-ink/[0.04]" data-testid={testId}>
      <p className="truncate text-sm text-muted">{label}</p>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums" data-testid={`${testId}-value`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
    </div>
  )
}

function Card({ title, icon: Icon, children, testId }: { title: string; icon?: typeof Trophy; children: React.ReactNode; testId?: string }): React.JSX.Element {
  return (
    <section className="rounded-[var(--radius-card)] bg-card px-5 py-4 ring-1 ring-ink/[0.04]" data-testid={testId}>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {Icon && <Icon size={15} className="text-muted" aria-hidden="true" />}
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * The weekly report on the Statistics page (Phase 6.8): one Monday–Sunday week at a time, from the
 * stored records only. Earlier weeks can be browsed; future weeks cannot. "Copy report" puts a plain-
 * text version on the clipboard.
 */
export function WeeklyReportView({ now }: { now: number }): React.JSX.Element {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  const tasks = useAppStore((s) => s.tasks)
  const completions = useAppStore((s) => s.completions)
  const plans = useAppStore((s) => s.plans)
  const habits = useAppStore((s) => s.habits)
  const habitCheckins = useAppStore((s) => s.habitCheckins)
  const focusSessions = useAppStore((s) => s.focus?.sessions)
  const thisWeek = weekStartOf(dayKey(new Date(now)))
  const [week, setWeek] = useState(thisWeek)
  const [copied, setCopied] = useState(false)
  const shown = week > thisWeek ? thisWeek : week
  const report = useMemo(
    () => buildWeeklyReport({ tasks, completions, plans, habits, habitCheckins, focusSessions: focusSessions ?? [] }, shown, now),
    [tasks, completions, plans, habits, habitCheckins, focusSessions, shown, now]
  )
  const label = shown === thisWeek ? t('report.thisWeek') : shown === addDays(thisWeek, -7) ? t('report.lastWeek') : null
  const habitDue = report.habits.reduce((s, h) => s + h.due, 0)
  const habitDone = report.habits.reduce((s, h) => s + h.done, 0)
  const maxTasks = Math.max(1, ...report.tasks.perDay)
  const maxFocus = Math.max(1, ...report.focus.perDay)

  const copy = (): void => {
    void navigator.clipboard
      .writeText(weeklyReportText(report, t, locale))
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch((error) => console.error('[Report] Copy failed', error))
  }

  return (
    <div className="flex flex-col gap-3" data-testid="weekly-report" data-week={report.start}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('report.prev')}
            data-testid="report-prev"
            onClick={() => setWeek(addDays(shown, -7))}
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-ink/5 hover:text-fg"
          >
            <ChevronLeft size={17} />
          </button>
          <span className="min-w-36 text-center text-sm font-medium tabular-nums" data-testid="report-range">
            {weekRange(report, t, locale)}
          </span>
          <button
            type="button"
            aria-label={t('report.next')}
            data-testid="report-next"
            disabled={shown >= thisWeek}
            onClick={() => setWeek(addDays(shown, 7))}
            className="flex size-8 items-center justify-center rounded-lg text-muted enabled:hover:bg-ink/5 enabled:hover:text-fg disabled:opacity-30"
          >
            <ChevronRight size={17} />
          </button>
        </div>
        {label && <span className="rounded-md bg-ink/[0.06] px-1.5 py-0.5 text-[11px] text-muted">{label}</span>}
        <Button variant="ghost" className="ml-auto" data-testid="report-copy" onClick={copy}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied ? t('report.copied') : t('report.copy')}
        </Button>
      </div>
      {report.current && <p className="-mt-1 px-1 text-xs text-muted">{t('report.inProgress')}</p>}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        <Tile
          testId="report-tasks"
          label={t('report.tasks')}
          value={String(report.tasks.completed)}
          sub={t('report.vsLast', { count: report.tasks.previous })}
        />
        <Tile testId="report-active-days" label={t('report.activeDays')} value={t('report.activeDaysValue', { count: report.tasks.activeDays })} />
        <Tile
          testId="report-focus"
          label={t('report.focus')}
          value={t('report.focusValue', { minutes: minutes(report.focus.focusedSec) })}
          sub={t('report.focusSessions', { completed: report.focus.completed, early: report.focus.endedEarly })}
        />
        <Tile
          testId="report-habits"
          label={t('report.habits')}
          value={habitDue > 0 ? `${Math.round((habitDone / habitDue) * 100)}%` : '—'}
          sub={habitDue > 0 ? t('report.habitsValue', { done: habitDone, due: habitDue }) : t('report.noHabits')}
        />
      </div>

      <Card title={t('report.insights')} icon={Lightbulb} testId="report-insights">
        <ul className="flex flex-col gap-1.5">
          {report.insights.map((insight, i) => (
            <li key={i} className="text-sm leading-relaxed" data-testid="report-insight" data-kind={insight.kind}>
              {insightText(insight, t, locale)}
            </li>
          ))}
          {report.insights.length === 0 && <li className="text-sm text-muted">—</li>}
        </ul>
      </Card>

      <Card title={t('report.days')} testId="report-days">
        <div className="grid grid-cols-7 gap-2" role="table" aria-label={t('report.days')}>
          {report.tasks.perDay.map((count, i) => {
            const focusMin = minutes(report.focus.perDay[i] ?? 0)
            const day = addDays(report.start, i)
            const future = day > dayKey(new Date(now))
            return (
              <div key={i} className={`flex min-w-0 flex-col items-center gap-1 ${future ? 'opacity-40' : ''}`} role="row" data-testid="report-day" data-tasks={count} data-focus={focusMin}>
                <div className="flex h-20 w-full items-end justify-center gap-1" aria-hidden="true">
                  <div className="w-2.5 rounded-t bg-accent" style={{ height: `${(count / maxTasks) * 100}%`, minHeight: count ? 3 : 0 }} />
                  <div className="w-2.5 rounded-t bg-gold/80" style={{ height: `${((report.focus.perDay[i] ?? 0) / maxFocus) * 100}%`, minHeight: focusMin ? 3 : 0 }} />
                </div>
                <span className="text-[11px] text-muted" role="cell">
                  {weekdayShort(i, locale)}
                </span>
                <span className="text-[11px] tabular-nums" role="cell">
                  {count} · {focusMin}
                </span>
              </div>
            )
          })}
        </div>
        <p className="mt-2 flex gap-4 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-accent" /> {t('report.daysTasks')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-gold/80" /> {t('report.daysFocus')}
          </span>
        </p>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card title={t('report.habits')} testId="report-habit-list">
          {report.habits.filter((h) => h.due > 0 || h.done > 0).length === 0 ? (
            <p className="text-sm text-muted">{t('report.noHabits')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {report.habits
                .filter((h) => h.due > 0 || h.done > 0)
                .map((h) => (
                  <li key={h.habitId} className="flex items-center gap-3 text-sm" data-testid="report-habit" data-done={h.done} data-due={h.due}>
                    <span className="min-w-0 flex-1 truncate" title={h.name}>
                      {h.name}
                    </span>
                    <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-ink/[0.07]">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${(h.rate ?? 0) * 100}%` }} />
                    </span>
                    <span className="w-12 shrink-0 text-right text-xs text-muted tabular-nums">
                      {h.done}/{h.due}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
        <Card title={t('report.plans')} icon={Trophy} testId="report-plans">
          {report.plans.goals.length + report.plans.plansCompleted.length === 0 ? (
            <p className="text-sm text-muted">{t('report.noPlans')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {report.plans.plansCompleted.map((p, i) => (
                <li key={`p${i}`} className="truncate font-medium text-gold" title={p.planTitle}>
                  {t('report.planDone', { name: p.name })}
                </li>
              ))}
              {report.plans.goals.map((g, i) => (
                <li key={`g${i}`} className="truncate" title={g.planTitle} data-testid="report-plan-goal">
                  {g.name}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('report.topTasks')}>
          {report.tasks.top.length === 0 ? (
            <p className="text-sm text-muted">—</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {report.tasks.top.map((x) => (
                <li key={x.title} className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate" title={x.title}>
                    {x.title}
                  </span>
                  <span className="text-xs text-muted tabular-nums">{t('report.timesValue', { count: x.count })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('report.topFocus')} icon={Timer}>
          {report.focus.top.length === 0 ? (
            <p className="text-sm text-muted">—</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {report.focus.top.map((x) => (
                <li key={x.title} className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate" title={x.title}>
                    {x.title}
                  </span>
                  <span className="text-xs text-muted tabular-nums">{t('report.focusValue', { minutes: minutes(x.focusedSec) })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="px-1 text-xs text-muted">{t('report.help')}</p>
    </div>
  )
}
