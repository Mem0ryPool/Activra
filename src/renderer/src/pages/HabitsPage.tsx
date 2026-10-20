import { Archive, ArchiveRestore, Check, ChevronDown, Flame, Pause, Pencil, Play, Plus, Repeat, Trash2, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { dayKey } from '../../../shared/dates'
import { checkedDays, countedCheckinOn, habitStreak, isScheduled, type HabitStreak } from '../../../shared/habits/streak'
import type { Habit, HabitAction, HabitCheckin, HabitState } from '../../../shared/habits/types'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { weekdayName } from '../lib/recurrenceText'
import { EmptyState } from '../components/EmptyState'
import { MoreMenu, type MenuItem } from '../components/Menu'
import { PageHeader } from '../components/PageHeader'
import { HabitDialog, weekOrder } from '../habits/HabitDialog'
import { HabitHeatmap } from '../habits/HabitHeatmap'
import { useNow } from '../hooks/useNow'
import { useAppStore, useT } from '../store/appStore'

function StreakValue({ label, value, unit, testId }: { label: string; value: number; unit: 'day' | 'week'; testId: string }): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="text-sm font-medium tabular-nums" data-testid={testId} data-value={value}>
        {t(
          unit === 'day'
            ? value === 1 ? 'habits.unit.day' : 'habits.unit.days'
            : value === 1 ? 'habits.unit.week' : 'habits.unit.weeks',
          { count: value }
        )}
      </span>
    </div>
  )
}

function HabitCard({
  habit,
  checkins,
  today
}: {
  habit: Habit
  checkins: readonly HabitCheckin[]
  today: string
}): React.JSX.Element {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  const checkingIn = useAppStore((s) => !!s.checkingIn[habit.id])
  const checkInHabit = useAppStore((s) => s.checkInHabit)
  const undoHabitCheckin = useAppStore((s) => s.undoHabitCheckin)
  const setHabitState = useAppStore((s) => s.setHabitState)
  const [editing, setEditing] = useState(false)
  const [history, setHistory] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deleteHabit = useAppStore((s) => s.deleteHabit)
  const streak: HabitStreak = useMemo(() => habitStreak(habit, checkins, today), [habit, checkins, today])
  const days = useMemo(() => checkedDays(habit, checkins), [habit, checkins])
  const todayCheckin = countedCheckinOn(checkins, habit.id, today)
  const active = habit.state === 'active'
  const run = (action: HabitAction): void =>
    void setHabitState(habit.id, action).catch((error) => console.error('[Habits] State change failed', error))
  const menu: MenuItem[] = [{ label: t('habits.action.edit'), icon: Pencil, onSelect: () => setEditing(true) }]
  if (habit.state === 'active') menu.push({ label: t('habits.action.pause'), icon: Pause, onSelect: () => run('pause') })
  if (habit.state === 'paused') menu.push({ label: t('habits.action.resume'), icon: Play, onSelect: () => run('resume') })
  if (habit.state === 'archived') menu.push({ label: t('habits.action.unarchive'), icon: ArchiveRestore, onSelect: () => run('unarchive') })
  else menu.push({ label: t('habits.action.archive'), icon: Archive, onSelect: () => run('archive') })
  menu.push({ label: t('habits.action.delete'), icon: Trash2, danger: true, onSelect: () => setDeleting(true) })
  const started = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(
    new Date(`${habit.startDate}T00:00:00`)
  )

  return (
    <article
      data-testid="habit-card"
      data-habit={habit.id}
      data-state={habit.state}
      className="flex flex-col gap-4 rounded-[var(--radius-card)] bg-card p-5 ring-1 ring-ink/[0.04]"
    >
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="min-w-0 truncate text-base font-semibold" title={habit.name} data-testid="habit-title">
              {habit.name}
            </h2>
            {habit.state !== 'active' && (
              <span className="inline-flex items-center gap-1 rounded-md bg-ink/[0.06] px-1.5 py-0.5 text-[11px] text-muted" data-testid="habit-state">
                {habit.state === 'paused' ? <Pause size={11} aria-hidden="true" /> : <Archive size={11} aria-hidden="true" />}
                {t(habit.state === 'paused' ? 'habits.state.paused' : 'habits.state.archived')}
              </span>
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1" data-testid="habit-frequency">
              <Repeat size={12} aria-hidden="true" />
              {habit.frequency.kind === 'daily'
                ? t('habits.freq.daily')
                : habit.frequency.kind === 'weekly'
                  ? t('habits.freq.weekly', { count: habit.frequency.timesPerWeek })
                  : t('habits.freq.weekdays', {
                      days: weekOrder(locale)
                        .filter((day) => habit.frequency.kind === 'weekdays' && habit.frequency.weekdays.includes(day))
                        .map((day) => weekdayName(day, locale))
                        .join(locale === 'zh-CN' ? '、' : ', ')
                    })}
            </span>
            {habit.frequency.kind === 'weekly' && (
              <span data-testid="habit-week-progress">
                · {t('habits.week.progress', { count: streak.weekCount, target: habit.frequency.timesPerWeek })}
              </span>
            )}
          </p>
        </div>
        {active &&
          (todayCheckin ? (
            <div className="flex shrink-0 items-center gap-1">
              <span
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent/15 px-3 text-sm font-medium text-accent"
                data-testid="habit-checked"
              >
                <Check size={16} aria-hidden="true" />
                {t('habits.checkedIn')}
              </span>
              <Button
                variant="ghost"
                data-testid="habit-undo"
                onClick={() => void undoHabitCheckin(todayCheckin.id).catch((error) => console.error('[Habits] Undo failed', error))}
              >
                {t('habits.undo')}
              </Button>
            </div>
          ) : !isScheduled(habit, today) ? (
            <span className="inline-flex h-9 shrink-0 items-center px-2 text-sm text-muted" data-testid="habit-not-today">
              {t('habits.notToday')}
            </span>
          ) : (
            <Button
              variant="primary"
              data-testid="habit-check-in"
              disabled={checkingIn}
              onClick={() => void checkInHabit(habit.id, today).catch((error) => console.error('[Habits] Check-in failed', error))}
            >
              <Check size={16} aria-hidden="true" />
              {t('habits.checkIn')}
            </Button>
          ))}
        <MoreMenu items={menu} />
      </header>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <div className="flex items-center gap-2.5">
          <Flame size={18} className={streak.current > 0 ? 'text-accent' : 'text-muted'} aria-hidden="true" />
          <StreakValue label={t('habits.streak.current')} value={streak.current} unit={streak.unit} testId="habit-streak-current" />
        </div>
        <div className="flex items-center gap-2.5">
          <Trophy size={18} className="text-muted" aria-hidden="true" />
          <StreakValue label={t('habits.streak.longest')} value={streak.longest} unit={streak.unit} testId="habit-streak-longest" />
        </div>
      </div>

      {habit.state === 'paused' && <p className="text-xs text-muted">{t('habits.pausedHint')}</p>}

      <div>
        <button
          type="button"
          data-testid="habit-history-toggle"
          aria-expanded={history}
          onClick={() => setHistory((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
        >
          <ChevronDown size={14} className={`transition-transform ${history ? 'rotate-180' : ''}`} aria-hidden="true" />
          {t(history ? 'habits.history.hide' : 'habits.history.show')}
        </button>
        {history && (
          <div className="mt-3 flex flex-col gap-3">
            <HabitHeatmap habit={habit} days={days} today={today} />
            <p className="text-xs text-muted">{t('habits.history.startedOn', { date: started })}</p>
            {habit.note && <p className="text-sm break-words whitespace-pre-wrap text-muted">{habit.note}</p>}
          </div>
        )}
      </div>
      {editing && <HabitDialog habit={habit} onClose={() => setEditing(false)} />}
      {deleting && (
        <Dialog
          title={t('habits.delete.title')}
          onClose={() => setDeleting(false)}
          width="max-w-sm"
          footer={
            <>
              <Button onClick={() => setDeleting(false)}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                data-testid="confirm-delete-habit"
                onClick={() => {
                  setDeleting(false)
                  void deleteHabit(habit.id).catch((error) => console.error('[Habits] Delete failed', error))
                }}
              >
                {t('common.delete')}
              </Button>
            </>
          }
        >
          <p className="text-sm break-words text-muted">{t('habits.delete.body', { name: habit.name })}</p>
        </Dialog>
      )}
    </article>
  )
}

function Section({
  state,
  habits,
  checkins,
  today
}: {
  state: Exclude<HabitState, 'active'>
  habits: Habit[]
  checkins: readonly HabitCheckin[]
  today: string
}): React.JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(false)
  if (habits.length === 0) return null
  return (
    <section className="flex flex-col gap-3" data-testid={`habit-section-${state}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 self-start px-1 text-sm font-medium text-muted hover:text-fg"
      >
        <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        {t(state === 'paused' ? 'habits.section.paused' : 'habits.section.archived')} · {habits.length}
      </button>
      {open && habits.map((habit) => <HabitCard key={habit.id} habit={habit} checkins={checkins} today={today} />)}
    </section>
  )
}

export function HabitsPage(): React.JSX.Element {
  const t = useT()
  const habits = useAppStore((s) => s.habits)
  const checkins = useAppStore((s) => s.habitCheckins)
  const [creating, setCreating] = useState(false)
  // Re-check every 30 s, so the page moves to the new day after midnight without a change.
  const now = useNow(true, 30_000)
  const today = dayKey(new Date(now))
  const byState = (state: HabitState): Habit[] =>
    habits.filter((h) => h.state === state).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const active = byState('active')

  const newButton = (
    <Button variant="primary" onClick={() => setCreating(true)} data-testid="habit-new">
      <Plus size={16} />
      {t('habits.new')}
    </Button>
  )
  return (
    <>
      <PageHeader title={t('nav.habits')} subtitle={t('habits.subtitle')} actions={newButton} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {habits.length === 0 ? (
          <EmptyState icon={Flame} title={t('habits.empty.title')} body={t('habits.empty.body')} action={newButton} />
        ) : (
          <div className="flex flex-col gap-3">
            {active.length > 0 && (
              <section className="flex flex-col gap-3" data-testid="habit-section-active">
                {active.map((habit) => (
                  <HabitCard key={habit.id} habit={habit} checkins={checkins} today={today} />
                ))}
              </section>
            )}
            <Section state="paused" habits={byState('paused')} checkins={checkins} today={today} />
            <Section state="archived" habits={byState('archived')} checkins={checkins} today={today} />
            <p className="px-1 text-xs text-muted">{t('habits.help')}</p>
          </div>
        )}
      </div>
      {creating && <HabitDialog onClose={() => setCreating(false)} />}
    </>
  )
}
