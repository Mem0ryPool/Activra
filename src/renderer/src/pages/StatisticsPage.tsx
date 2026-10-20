import { CalendarDays, Flame, LayoutGrid, ListTodo, Sparkles, Trophy, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { computeStats } from '../../../shared/stats'
import { useNow } from '../hooks/useNow'
import { ActivityCalendar } from '../components/ActivityCalendar'
import { PageHeader } from '../components/PageHeader'
import { WeeklyReportView } from '../report/WeeklyReportView'
import { useAppStore, useT } from '../store/appStore'

function Tile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }): React.JSX.Element {
  return (
    <div className="rounded-[var(--radius-card)] bg-card p-4 ring-1 ring-ink/[0.04]">
      <div className="flex items-center gap-2 text-muted">
        <Icon size={16} />
        <span className="truncate text-sm">{label}</span>
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

export function StatisticsPage(): React.JSX.Element {
  const t = useT()
  const tasks = useAppStore((s) => s.tasks)
  const completions = useAppStore((s) => s.completions)
  // Once a minute is enough to roll "today" over at midnight.
  const now = useNow(true, 60_000)
  const stats = useMemo(() => computeStats(tasks, completions, now), [tasks, completions, now])
  const tab = useAppStore((s) => s.statsTab)
  const setTab = useAppStore((s) => s.setStatsTab)
  const TABS = [
    { id: 'overview', icon: LayoutGrid, label: t('stats.tab.overview'), hint: t('stats.tab.overviewHint') },
    { id: 'weekly', icon: Sparkles, label: t('stats.tab.weekly'), hint: t('stats.tab.weeklyHint') }
  ] as const
  // Tabs pattern: arrow keys move between the two tabs and select them.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const next = e.key === 'Home' ? 'overview' : e.key === 'End' ? 'weekly' : tab === 'overview' ? 'weekly' : 'overview'
    setTab(next)
    document.getElementById(`stats-tab-${next}`)?.focus()
  }
  return (
    <>
      <PageHeader title={t('nav.statistics')} />
      <div
        className="grid shrink-0 grid-cols-2 gap-3 px-8 pb-4 md:max-w-2xl"
        role="tablist"
        aria-label={t('nav.statistics')}
        onKeyDown={onKeyDown}
      >
        {TABS.map(({ id, icon: Icon, label, hint }) => {
          const selected = tab === id
          return (
            <button
              key={id}
              id={`stats-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="stats-panel"
              tabIndex={selected ? 0 : -1}
              data-testid={`stats-tab-${id}`}
              onClick={() => setTab(id)}
              className={`flex min-w-0 items-center gap-3 rounded-[var(--radius-card)] px-4 py-3 text-left ring-1 transition-[background-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                selected ? 'bg-accent/[0.09] ring-accent/55' : 'bg-card ring-ink/[0.06] hover:bg-card-hover hover:ring-ink/15'
              }`}
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                  selected ? 'bg-accent text-white' : 'bg-ink/[0.05] text-muted'
                }`}
                aria-hidden="true"
              >
                <Icon size={18} />
              </span>
              <span className="min-w-0">
                <span className={`block truncate text-sm ${selected ? 'font-semibold text-fg' : 'font-medium text-fg'}`}>{label}</span>
                <span className="block truncate text-xs text-muted" title={hint}>
                  {hint}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8" id="stats-panel" role="tabpanel" aria-labelledby={`stats-tab-${tab}`}>
        {tab === 'weekly' ? (
          <WeeklyReportView now={now} />
        ) : (
          <>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          <Tile icon={Trophy} label={t('stats.unlocked')} value={stats.unlocked} />
          <Tile icon={ListTodo} label={t('stats.active')} value={stats.active} />
          <Tile icon={CalendarDays} label={t('stats.last7')} value={stats.unlockedLast7Days} />
          <Tile icon={Flame} label={t('stats.streak')} value={stats.streakDays} />
        </div>
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer select-none hover:text-fg">{t('stats.howCounted')}</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            <li>{t('stats.help.unlocked')}</li>
            <li>{t('stats.help.active')}</li>
            <li>{t('stats.help.last7')}</li>
            <li>{t('stats.help.streak')}</li>
            <li>{t('stats.help.calendar')}</li>
            <li>{t('stats.help.repeat')}</li>
          </ul>
        </details>
        <ActivityCalendar tasks={tasks} completions={completions} now={now} />
          </>
        )}
      </div>
    </>
  )
}
