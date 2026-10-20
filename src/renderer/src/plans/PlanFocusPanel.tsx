import { useState } from 'react'
import { Timer } from 'lucide-react'
import type { Plan } from '../../../shared/planner/types'
import type { GoalToday } from '../../../shared/planner/nextStep'
import { goalFocusProgress } from '../../../shared/focus/plan'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { Select } from '../components/Select'
import { useAppStore, useT } from '../store/appStore'

/** Focus execution is a separate budget, never an edit to the approved plan. */
export function PlanFocusPanel({ plan, today }: { plan: Plan; today: readonly GoalToday[] }): React.JSX.Element | null {
  const t = useT()
  const focus = useAppStore(s => s.focus)
  const busy = useAppStore(s => s.focusBusy)
  const save = useAppStore(s => s.savePlanFocus)
  const [draft, setDraft] = useState<Record<string, number> | null>(null)
  const [error, setError] = useState(false)
  if (!focus) return null
  const target = focus.planTargets?.find(p => p.planId === plan.id)
  const counts = draft ?? Object.fromEntries(plan.goals.map(g => [g.id, target?.goals.find(x => x.goalId === g.id)?.sessions ?? 1]))
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  const open = (): void => { setError(false); setDraft({ ...counts }) }
  const confirm = async (): Promise<void> => {
    setError(false)
    try {
      await save({ planId: plan.id, goals: plan.goals.map(g => ({ goalId: g.id, sessions: counts[g.id] ?? 1 })) })
      setDraft(null)
    } catch { setError(true) }
  }
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-app/60 p-3" data-testid="plan-focus-panel">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium"><Timer size={14} aria-hidden="true" />{t('planFocus.title')}</span>
        <Button variant="ghost" data-testid="plan-focus-configure" disabled={busy} onClick={open}>{t(target ? 'planFocus.adjust' : 'planFocus.prepare')}</Button>
      </header>
      {!target && <p className="text-xs text-muted">{t('planFocus.empty')}</p>}
      {target && <ul className="divide-y divide-line/60">
        {plan.goals.map((goal, index) => {
          const budget = target.goals.find(g => g.goalId === goal.id)?.sessions ?? 1
          const progress = goalFocusProgress(plan.id, goal, focus.sessions, budget)
          const run = focus.state.run
          const linked = run?.origin ? run.origin.planId === plan.id && run.origin.goalId === goal.id : run?.phase === 'focus' && !!run.taskId && (run.taskId === goal.taskId || goal.nodeTaskIds.includes(run.taskId))
          const state = linked ? (run?.resumedAt === null ? 'paused' : 'running') : progress.remaining === 0 ? 'done' : !today[index]?.completable ? 'unavailable' : progress.lastOutcome === 'ended-early' ? 'interrupted' : 'ready'
          return <li key={goal.id} data-focus-goal={goal.id} data-focus-state={state} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
            <div className="min-w-0 flex-1 basis-44">
              <p className="truncate text-xs font-medium" title={goal.title}>{goal.title}</p>
              <p className="mt-1 text-[11px] text-muted" data-testid="plan-focus-progress" data-completed={progress.completed} data-remaining={progress.remaining} data-seconds={progress.focusedSec}>{t('planFocus.progress', { done: progress.completed, remaining: progress.remaining, minutes: Math.floor(progress.focusedSec / 60) })}</p>
              <span className="text-[11px] text-muted">{t(`planFocus.state.${state}`)}</span>
            </div>
          </li>
        })}
      </ul>}
      {target && <p className="text-[11px] text-muted">{t('planFocus.separate')}</p>}
      {error && <p role="alert" className="text-xs text-danger-fg">{t('planFocus.error')}</p>}
      {draft && <Dialog title={t('planFocus.review')} onClose={() => { if (!busy) setDraft(null) }} footer={<><Button disabled={busy} onClick={() => setDraft(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={busy} data-testid="plan-focus-confirm" onClick={() => void confirm()}>{t('planFocus.confirm')}</Button></>}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{t('planFocus.explain')}</p>
          {plan.goals.map(goal => <div key={goal.id} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 flex-1 text-sm">{goal.title}</span><Select value={String(counts[goal.id] ?? 1)} options={Array.from({ length: 24 }, (_, i) => ({ value: String(i + 1), label: t('planFocus.sessions', { count: i + 1 }) }))} label={t('planFocus.sessionsFor', { title: goal.title })} testId={`plan-focus-budget-${goal.id}`} onChange={value => setDraft(current => ({ ...current, [goal.id]: Number(value) }))} /></div>)}
          <p className="text-sm font-medium" data-testid="plan-focus-estimate">{t('planFocus.estimate', { count: total, minutes: total * focus.durations.focusMin, duration: focus.durations.focusMin })}</p>
          <p className="text-xs text-muted">{t('planFocus.breaks', { short: focus.durations.shortBreakMin, long: focus.durations.longBreakMin })}</p>
          {error && <p role="alert" className="text-xs text-danger-fg">{t('planFocus.error')}</p>}
        </div>
      </Dialog>}
    </section>
  )
}
