import {
  ArrowRight,
  Ban,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Clock,
  Crown,
  Hourglass,
  Link2,
  Play,
  Sparkles,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { PlanFocusPanel } from '../plans/PlanFocusPanel'
import { dayKey } from '../../../shared/dates'
import { taskDisplayName } from '../../../shared/planner/displayName'
import { planFocusSummary } from '../../../shared/planner/focus'
import { originForTask } from '../../../shared/focus/plan'
import { goalToday, planNextStep, type GoalToday, type NextStep } from '../../../shared/planner/nextStep'
import { evaluatePlan, intervalOverview, type GoalProgress, type NodeProgress, type PlanProgress } from '../../../shared/planner/progress'
import { PLAN_TARGET, type Plan, type PlanGoal } from '../../../shared/planner/types'
import { selectTodayTasks, type TodayItem } from '../../../shared/taskOrder'
import type { Task } from '../../../shared/types'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { EmptyState } from '../components/EmptyState'
import { MoreMenu } from '../components/Menu'
import { PageHeader } from '../components/PageHeader'
import { useNow } from '../hooks/useNow'
import { formatDateKey } from '../lib/recurrenceText'
import { formatInstant, formatWindow } from '../lib/windowText'
import { PlanBadge, RarityLabel } from '../plans/PlanBadge'
import { PlanWizard } from '../plans/PlanWizard'
import { SlotLegend, SlotSegments } from '../plans/SlotSegments'
import { useAppStore, useT } from '../store/appStore'

/** Every state is shown as an icon and its words, never by color alone. */
const STATUS: Record<GoalProgress['status'], { tone: string; icon: LucideIcon }> = {
  waiting: { tone: 'text-muted', icon: Hourglass },
  upcoming: { tone: 'text-muted', icon: Clock },
  active: { tone: 'text-accent', icon: CircleDot },
  achieved: { tone: 'text-emerald-500', icon: CircleCheck },
  blocked: { tone: 'text-warn', icon: Hourglass },
  failed: { tone: 'text-danger-fg', icon: CircleX },
  broken: { tone: 'text-danger-fg', icon: Ban }
}

function StatusLabel({ status, testId }: { status: GoalProgress['status']; testId?: string }): React.JSX.Element {
  const t = useT()
  const { tone, icon: Icon } = STATUS[status]
  return (
    <span data-testid={testId} className={`inline-flex shrink-0 items-center gap-1 text-xs ${tone}`}>
      <Icon size={13} aria-hidden="true" />
      {t(`plans.status.${status}`)}
    </span>
  )
}

/** The plan as a whole: achieved, can no longer be achieved, not started yet, or in progress. */
function planStatus(progress: PlanProgress): GoalProgress['status'] {
  if (progress.achieved) return 'achieved'
  if (progress.failed) return 'failed'
  if (progress.goals.every((g) => g.status === 'upcoming' || g.status === 'waiting')) return 'upcoming'
  return 'active'
}

function ProgressBar({ done, total, tone, thick = false }: { done: number; total: number; tone: string; thick?: boolean }): React.JSX.Element {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <div
      className={`${thick ? 'h-2' : 'h-1.5'} w-full overflow-hidden rounded-full bg-ink/[0.07]`}
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div className={`h-full rounded-full transition-[width] duration-300 ${tone}`} style={{ width: `${percent}%` }} />
    </div>
  )
}

/** For a timed goal: the slot open now (or that none is), when the next one starts, and how many were missed. */
function SlotSummary({ nodes, now }: { nodes: NodeProgress[]; now: number }): React.JSX.Element | null {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  const { current, next, missed, done, total } = intervalOverview(nodes)
  if (done === total) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums" data-testid="plan-slot-summary">
      <span data-testid="plan-current-slot" className={current ? 'text-accent' : 'text-muted'}>
        {current ? t('plans.slot.current', { n: current.index + 1, window: formatWindow(current.window, now, t, locale) }) : t('plans.slot.noneOpen')}
      </span>
      {next && (
        <span data-testid="plan-next-slot" className="text-muted">
          {t('plans.slot.next', { time: formatInstant(next.window.start, now, t, locale) })}
        </span>
      )}
      {missed > 0 && (
        <span data-testid="plan-missed-slots" className="text-danger-fg">
          {t('plans.slot.missed', { count: missed })}
        </span>
      )}
    </div>
  )
}

/** "Total 3/7 days" for a day goal, "In a row 2/5 days" for a streak, "3/6 times" for a weekly goal; the count keeps its own test id. */
function GoalCount({ goal, progress }: { goal: PlanGoal; progress: GoalProgress }): React.JSX.Element {
  const t = useT()
  const kind = goal.condition.kind
  const prefix = kind === 'count' || kind === 'weekly' ? t('plans.total') : kind === 'streak' ? t('plans.total.streak') : null
  const unit = kind === 'count' || kind === 'streak' ? t('plans.unit.days') : kind === 'weekly' ? t('plans.unit.times') : null
  return (
    <span className="shrink-0 text-xs text-muted tabular-nums">
      {prefix && <>{prefix} </>}
      <span data-testid="plan-goal-count">
        {progress.done}/{progress.target}
      </span>
      {unit && <> {unit}</>}
    </span>
  )
}

const TODAY: Record<NonNullable<GoalToday['today']>, { icon: LucideIcon; tone: string; key: 'plans.today.done' | 'plans.today.todo' | 'plans.today.off' }> = {
  done: { icon: Check, tone: 'text-emerald-500', key: 'plans.today.done' },
  todo: { icon: CircleDashed, tone: 'text-accent', key: 'plans.today.todo' },
  off: { icon: Clock, tone: 'text-muted', key: 'plans.today.off' }
}

function CompleteButton({ item, plans }: { item: TodayItem; plans: readonly Plan[] }): React.JSX.Element {
  const t = useT()
  const completeTask = useAppStore((s) => s.completeTask)
  const [busy, setBusy] = useState(false)
  const name = taskDisplayName(item.task, plans, t).full
  return (
    <Button
      variant="primary"
      className="h-8 px-3 text-xs"
      data-testid="plan-complete"
      aria-label={t('plans.complete.label', { title: name })}
      disabled={busy}
      onClick={() => {
        setBusy(true)
        // The same completion as the task list, widget and tray (record, achievement, undo toast).
        void completeTask(item.task.id, item.occurrence)
          .catch((error) => console.error('[Plans] Complete failed', error))
          .finally(() => setBusy(false))
      }}
    >
      <Check size={14} aria-hidden="true" />
      {t('plans.complete')}
    </Button>
  )
}

/** Starts the actionable plan task in the existing timer, or returns to its interrupted run. */
function FocusButton({ item, plans }: { item: TodayItem; plans: readonly Plan[] }): React.JSX.Element {
  const t = useT()
  const focus = useAppStore((s) => s.focus)
  const focusBusy = useAppStore((s) => s.focusBusy)
  const launchPlanFocus = useAppStore((s) => s.launchPlanFocus)
  const setPage = useAppStore((s) => s.setPage)
  const setFocusMode = useAppStore((s) => s.setFocusMode)
  const [busy, setBusy] = useState(false)
  const run = focus?.state.run ?? null
  const samePausedRun = !!run && run.taskId === item.task.id && run.resumedAt === null
  const name = taskDisplayName(item.task, plans, t).full
  const key = !run ? 'start' : samePausedRun ? 'resume' : 'open'

  const open = (): void => {
    if (busy || focusBusy) return
    setBusy(true)
    const origin = originForTask(plans, item.task.id)
    if (!origin) { setBusy(false); return }
    const change = !run || samePausedRun
      ? launchPlanFocus({ ...origin, taskId: item.task.id })
      : Promise.resolve()
    void change
      .then(() => {
        setPage('focus')
        setFocusMode(true)
      })
      .catch((error) => console.error('[Plans] Start focus failed', error))
      .finally(() => setBusy(false))
  }

  return (
    <Button
      className="h-8 px-3 text-xs"
      data-testid="plan-focus"
      aria-label={t(`plans.focus.${key}.label`, { title: name })}
      disabled={busy || focusBusy}
      onClick={open}
    >
      <Play size={14} aria-hidden="true" />
      {t(`plans.focus.${key}`)}
    </Button>
  )
}

function TaskActions({ item, plans }: { item: TodayItem; plans: readonly Plan[] }): React.JSX.Element {
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <FocusButton item={item} plans={plans} />
      <CompleteButton item={item} plans={plans} />
    </span>
  )
}

function NextStepRow({
  step,
  plan,
  plans,
  now
}: {
  step: NextStep
  plan: Plan
  plans: readonly Plan[]
  now: number
}): React.JSX.Element {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  const goalTitle = (id: string): string => plan.goals.find((g) => g.id === id)?.title ?? ''
  let text: string
  let tone = 'bg-ink/[0.04] text-muted'
  let Icon: LucideIcon = ArrowRight
  switch (step.kind) {
    case 'achieved':
      text = t('plans.next.achieved')
      tone = 'bg-emerald-500/10 text-emerald-500'
      Icon = CircleCheck
      break
    case 'failed':
      text = t('plans.next.failed')
      tone = 'bg-danger/10 text-danger-fg'
      Icon = CircleX
      break
    case 'now': {
      const title = taskDisplayName(step.item.task, plans, t).full
      text = step.until ? t('plans.next.nowUntil', { title, time: formatInstant(step.until, now, t, locale) }) : t('plans.next.now', { title })
      tone = 'bg-accent/[0.08] text-fg'
      break
    }
    case 'slot':
      text = t('plans.slot.next', { time: formatInstant(step.start, now, t, locale) })
      Icon = Clock
      break
    case 'starts':
      text = t('plans.next.starts', { title: goalTitle(step.goalId), date: formatDateKey(step.date, locale) })
      Icon = Clock
      break
    case 'doneToday':
      text = t('plans.next.doneToday')
      Icon = Check
      break
    case 'after':
      text = t('plans.next.after', { title: goalTitle(step.goalId), previous: goalTitle(step.previousId) })
      Icon = Hourglass
      break
    default:
      text = t('plans.next.neutral')
  }
  return (
    <div data-testid="plan-next" data-kind={step.kind} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2.5 text-sm ${tone}`}>
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <Icon size={15} className="shrink-0" aria-hidden="true" />
        <span className="sr-only">{t('plans.next.label')}: </span>
        <span className="min-w-0" data-testid="plan-next-text">
          {text}
        </span>
      </span>
      {step.kind === 'now' && <TaskActions item={step.item} plans={plans} />}
    </div>
  )
}

/**
 * One goal at a glance: what to do, its achievement, today's state for a repeating goal, the total,
 * its state and, when it can be done now, a Complete button. An achieved goal folds to one line.
 */
function GoalRow({
  goal,
  progress,
  today,
  plans,
  showSlots,
  showComplete,
  now
}: {
  goal: PlanGoal
  progress: GoalProgress
  today: GoalToday
  plans: readonly Plan[]
  /** A timed goal in a plan of several goals shows its slots here (a one-goal plan shows them at the top). */
  showSlots: boolean
  /** False for the goal the next-step line already offers to complete. */
  showComplete: boolean
  now: number
}): React.JSX.Element {
  const t = useT()
  const achieved = progress.status === 'achieved'
  const [open, setOpen] = useState(false)
  const folded = achieved && !open
  const todayInfo = today.today ? TODAY[today.today] : null
  return (
    <li data-testid="plan-goal" data-status={progress.status} data-folded={folded || undefined} className="flex flex-col gap-2 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <PlanBadge spec={goal.achievement} unlocked={achieved} size="sm" />
        {/* Wants 12rem: when the row is narrower (small window, large UI scale) the count and state wrap below instead of squeezing the name. */}
        <div className="min-w-0 flex-1 basis-48">
          <p className={`truncate text-sm font-medium ${folded ? 'text-muted' : ''}`} title={goal.title} data-testid="plan-goal-title">
            {goal.title}
          </p>
          {!folded && (
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
              <span className="truncate" title={goal.achievement.name}>
                {t('plans.goal.achievement', { name: goal.achievement.name })}
              </span>
              {todayInfo && (
                <span data-testid="plan-goal-today" data-today={today.today} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap ${todayInfo.tone}`}>
                  <todayInfo.icon size={12} aria-hidden="true" />
                  {t(todayInfo.key)}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {showComplete && today.completable && <TaskActions item={today.completable} plans={plans} />}
          <GoalCount goal={goal} progress={progress} />
          <StatusLabel status={progress.status} testId="plan-goal-status" />
          {achieved && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={t(open ? 'plans.goal.collapse' : 'plans.goal.expand', { title: goal.title })}
              data-testid="plan-goal-expand"
              className="rounded-md p-1 text-muted hover:bg-ink/5 hover:text-fg"
            >
              <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {showSlots && !folded && progress.nodes.length > 0 && (
        <div className="pl-12">
          <SlotSegments nodes={progress.nodes} now={now} legend={false} />
        </div>
      )}
    </li>
  )
}

/** Everything secondary, on request: achievement texts and rarity, dates, chains, weeks, slot rules. */
function GoalDetails({ plan, goal, progress, now }: { plan: Plan; goal: PlanGoal; progress: GoalProgress; now: number }): React.JSX.Element {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  const previous = goal.after ? plan.goals.find((g) => g.id === goal.after) : undefined
  const window =
    goal.condition.kind === 'interval'
      ? null
      : progress.windowStart && progress.windowEnd && goal.condition.kind !== 'once'
        ? t('plans.goal.window', { start: formatDateKey(progress.windowStart, locale), end: formatDateKey(progress.windowEnd, locale) })
        : goal.condition.kind === 'once' && goal.condition.due
          ? t('plans.goal.due', { date: formatDateKey(goal.condition.due, locale) })
          : null
  const week = progress.periods.length > 1 ? progress.periods.find((p) => p.start <= dayKey(new Date(now)) && dayKey(new Date(now)) <= p.end) : undefined
  return (
    <li className="flex flex-col gap-1" data-testid="plan-goal-details">
      <div className="flex items-center gap-2">
        <span className="truncate text-xs font-medium">{goal.title}</span>
        <span className="text-xs text-muted">· {goal.achievement.name}</span>
        <RarityLabel rarity={goal.achievement.rarity} />
      </div>
      <p className="text-xs text-muted">{goal.achievement.description}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        {window && <span>{window}</span>}
        {previous && (
          <span className="inline-flex items-center gap-1">
            <Link2 size={11} aria-hidden="true" />
            {t('plans.goal.chainAfter', { title: previous.title })}
          </span>
        )}
        {week && <span data-testid="plan-this-week">{t('plans.thisWeek', { done: week.done, target: week.target })}</span>}
        {progress.periods.length > 1 &&
          progress.periods.map((p, i) => (
            <span key={p.start} data-testid="plan-week" className={p.done >= p.target ? 'text-emerald-500' : ''}>
              {t('plans.goal.week', { n: i + 1 })} {p.done}/{p.target}
            </span>
          ))}
      </div>
      {progress.nodes.length > 0 && (
        <>
          <SlotSummary nodes={progress.nodes} now={now} />
          <SlotLegend />
          <p className="text-[11px] text-muted">{t('plans.goal.slotsHint')}</p>
        </>
      )}
    </li>
  )
}

function PlanCard({
  plan,
  plans,
  progress,
  items,
  tasks,
  now,
  highlighted,
  onDelete
}: {
  plan: Plan
  plans: readonly Plan[]
  progress: PlanProgress
  /** "Today" as the task list, widget and tray see it. */
  items: readonly TodayItem[]
  tasks: readonly Task[]
  now: number
  /** Opened from the wizard's "View existing plan": scrolled to and outlined for a moment. */
  highlighted: boolean
  onDelete: () => void
}): React.JSX.Element {
  const t = useT()
  const focusSessions = useAppStore((s) => s.focus?.sessions)
  const masterUnlocked = plan.unlocks.some((u) => u.target === PLAN_TARGET && u.revokedAt === null)
  const [details, setDetails] = useState(false)
  const today = dayKey(new Date(now))
  const step = planNextStep(plan, progress, items, tasks, now, today)
  const goalsToday = plan.goals.map((goal, i) => goalToday(goal, progress.goals[i] as GoalProgress, items, tasks))
  const single = plan.goals.length === 1
  // A plan of one timed goal counts its slots ("1/4 个时段已完成"); any other plan counts goals.
  const slots = single && progress.goals[0]?.nodes.length ? progress.goals[0] : null
  // A plan of one day, streak or weekly goal shows that goal's total ("3/7 累计完成天数"), not "0/1 goals".
  const kind = single ? plan.goals[0]?.condition.kind : undefined
  const counted = kind === 'count' || kind === 'streak' || kind === 'weekly' ? progress.goals[0] : null
  const shown = slots ?? counted
  const done = shown ? shown.done : progress.achievedCount
  const total = shown ? shown.target : plan.goals.length
  const unit = slots
    ? t('plans.unit.slots')
    : kind === 'count' && counted
      ? t('plans.unit.totalDays')
      : kind === 'streak' && counted
        ? t('plans.unit.streakDays')
        : kind === 'weekly' && counted
          ? t('plans.unit.totalTimes')
          : t('plans.unit.goals')
  const tone = progress.achieved ? 'bg-emerald-500' : progress.failed ? 'bg-danger/60' : 'bg-accent'
  const status = planStatus(progress)
  const focusSummary = planFocusSummary(plan, focusSessions ?? [])
  return (
    <article
      data-testid="plan-card"
      data-plan={plan.id}
      data-highlighted={highlighted || undefined}
      tabIndex={-1}
      className={`flex flex-col gap-4 rounded-[var(--radius-card)] bg-card p-5 outline-none transition-shadow ${highlighted ? 'ring-2 ring-accent' : 'ring-1 ring-ink/[0.04]'}`}
    >
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="min-w-0 truncate text-base font-semibold" title={plan.title} data-testid="plan-title">
              {plan.title}
            </h2>
            <span className="sr-only">{t('plans.state.label')}:</span>
            <StatusLabel status={status} testId="plan-status" />
          </div>
          <p className="mt-1.5 flex items-baseline gap-1.5 tabular-nums" data-testid="plan-progress">
            <span className="text-2xl leading-none font-semibold">
              {done}
              <span className="text-base font-normal text-muted">/{total}</span>
            </span>{' '}
            <span className="text-xs text-muted">{unit}</span>
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted tabular-nums" data-testid="plan-focus-summary">
            <Clock size={12} aria-hidden="true" />
            {t('plans.focus.summary', { count: Math.round(focusSummary.focusedSec / 60), sessions: focusSummary.sessions })}
          </p>
        </div>
        <MoreMenu items={[{ label: t('plans.delete'), icon: Trash2, danger: true, onSelect: onDelete }]} />
      </header>

      {slots ? (
        <SlotSegments nodes={slots.nodes} now={now} legend={false} />
      ) : (
        <div data-testid="plan-progress-bar">
          <ProgressBar done={done} total={total} tone={tone} thick />
        </div>
      )}

      <NextStepRow step={step} plan={plan} plans={plans} now={now} />
      <PlanFocusPanel plan={plan} today={goalsToday} />

      <ul className="-my-1 divide-y divide-line/60">
        {plan.goals.map((goal, i) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            progress={progress.goals[i] as GoalProgress}
            today={goalsToday[i] as GoalToday}
            plans={plans}
            showSlots={!single}
            showComplete={!(step.kind === 'now' && step.goalId === goal.id)}
            now={now}
          />
        ))}
      </ul>

      {plan.master && (
        <div
          data-testid="plan-master"
          data-unlocked={masterUnlocked}
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 ring-1 ${masterUnlocked ? 'plan-master-row ring-gold/50' : 'ring-line'}`}
        >
          <Crown size={16} className={masterUnlocked ? 'shrink-0 text-gold' : 'shrink-0 text-muted'} aria-hidden="true" />
          <span className={`min-w-0 flex-1 truncate text-sm font-medium ${masterUnlocked ? 'text-gold' : ''}`}>{plan.master.name}</span>
          <span className={`inline-flex shrink-0 items-center gap-1 text-xs ${masterUnlocked ? 'text-gold' : 'text-muted'}`}>
            {masterUnlocked ? <CircleCheck size={13} aria-hidden="true" /> : <Clock size={13} aria-hidden="true" />}
            {masterUnlocked ? t('plans.master.unlocked') : t('plans.master.short')}
          </span>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setDetails((v) => !v)}
          aria-expanded={details}
          data-testid="plan-details-toggle"
          className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ChevronDown size={14} className={`transition-transform ${details ? 'rotate-180' : ''}`} aria-hidden="true" />
          {details ? t('plans.details.hide') : t('plans.details.show')}
        </button>
        {details && (
          <div data-testid="plan-details" className="mt-3 flex flex-col gap-3 rounded-lg bg-app/60 px-3 py-3">
            {plan.sourceText && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">{t('plans.source')}</span>
                <p className="text-xs whitespace-pre-wrap text-muted" data-testid="plan-source">
                  {plan.sourceText}
                </p>
              </div>
            )}
            <ul className="flex flex-col gap-3">
              {plan.goals.map((goal, i) => (
                <GoalDetails key={goal.id} plan={plan} goal={goal} progress={progress.goals[i] as GoalProgress} now={now} />
              ))}
            </ul>
            {plan.master && (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{plan.master.name}</span>
                  <RarityLabel rarity={plan.master.rarity} />
                </div>
                <p className="text-xs text-muted">{plan.master.description}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

export function PlansPage(): React.JSX.Element {
  const t = useT()
  const plans = useAppStore((s) => s.plans)
  const tasks = useAppStore((s) => s.tasks)
  const completions = useAppStore((s) => s.completions)
  const wizardRequested = useAppStore((s) => s.planWizardRequested)
  const setWizardRequested = useAppStore((s) => s.setPlanWizardRequested)
  const deletePlan = useAppStore((s) => s.deletePlan)
  const [wizard, setWizard] = useState(false)
  const [deleting, setDeleting] = useState<Plan | null>(null)
  const [highlightedPlan, setHighlightedPlan] = useState<string | null>(null)
  // "View existing plan" in the wizard: bring that plan into view and outline it briefly.
  useEffect(() => {
    if (!highlightedPlan) return
    const card = document.querySelector<HTMLElement>(`[data-testid=plan-card][data-plan="${CSS.escape(highlightedPlan)}"]`)
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    card?.focus({ preventScroll: true })
    const id = window.setTimeout(() => setHighlightedPlan(null), 2500)
    return () => window.clearTimeout(id)
  }, [highlightedPlan])
  // Re-check regularly, so "failed", a new week after midnight, or a time slot opening or closing
  // shows without a change. Timed slots need a finer step than days.
  const timed = plans.some((p) => p.goals.some((g) => g.condition.kind === 'interval'))
  const now = useNow(true, timed ? 5_000 : 60_000)
  const today = dayKey(new Date(now))
  const progress = useMemo(
    () => new Map(plans.map((p) => [p.id, evaluatePlan(p, tasks, completions, today, now)])),
    [plans, tasks, completions, today, now]
  )
  // "Today" exactly as the task list, widget and tray see it: what the Complete buttons may offer.
  const items = useMemo(() => selectTodayTasks(tasks, completions, now).items, [tasks, completions, now])
  const sorted = useMemo(() => [...plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [plans])
  const open = (): void => setWizard(true)
  const close = (): void => {
    setWizard(false)
    setWizardRequested(false)
  }

  return (
    <>
      <PageHeader
        title={t('nav.plans')}
        subtitle={t('plans.subtitle', { count: plans.length })}
        actions={
          <Button variant="primary" onClick={open} data-testid="open-plan-wizard">
            <Sparkles size={16} />
            {t('plans.smart')}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {plans.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={t('plans.empty.title')}
            body={t('plans.empty.body')}
            action={
              <Button variant="primary" onClick={open}>
                <Sparkles size={16} />
                {t('plans.smart')}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                plans={plans}
                progress={progress.get(plan.id) as PlanProgress}
                items={items}
                tasks={tasks}
                now={now}
                highlighted={highlightedPlan === plan.id}
                onDelete={() => setDeleting(plan)}
              />
            ))}
            <p className="px-1 text-xs text-muted">{t('plans.howCounted')}</p>
          </div>
        )}
      </div>
      {(wizard || wizardRequested) && (
        <PlanWizard
          onClose={close}
          onViewPlan={(planId) => {
            close()
            setHighlightedPlan(planId)
          }}
        />
      )}
      {deleting && (
        <Dialog
          title={t('plans.delete.title')}
          onClose={() => setDeleting(null)}
          width="max-w-sm"
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                data-testid="confirm-delete-plan"
                onClick={() => {
                  const id = deleting.id
                  setDeleting(null)
                  void deletePlan(id).catch((error) => console.error('[Plans] Delete failed', error))
                }}
              >
                {t('common.delete')}
              </Button>
            </>
          }
        >
          <p className="text-sm break-words text-muted">{t('plans.delete.body', { title: deleting.title })}</p>
        </Dialog>
      )}
    </>
  )
}
