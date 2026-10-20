import { Trophy } from 'lucide-react'
import { useMemo } from 'react'
import { countedCompletions, sortCompletions } from '../../../shared/completions'
import { PLAN_TARGET, type AchievementSpec } from '../../../shared/planner/types'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useFormatDate } from '../hooks/useFormatDate'
import { useTaskName } from '../hooks/useTaskName'
import { PlanBadge, RarityLabel } from '../plans/PlanBadge'
import { useAppStore, useT } from '../store/appStore'

interface PlanAchievement {
  id: string
  spec: AchievementSpec
  planTitle: string
  unlockedAt: string
  master: boolean
}

export function AchievementsPage(): React.JSX.Element {
  const t = useT()
  const formatDate = useFormatDate()
  const completions = useAppStore((s) => s.completions)
  const plans = useAppStore((s) => s.plans)
  const tasks = useAppStore((s) => s.tasks)
  const taskName = useTaskName()
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  // One achievement per completion that counts. Undoing a completion withdraws exactly its achievement.
  const unlocked = useMemo(() => sortCompletions(countedCompletions(completions)), [completions])
  // Plan achievements that currently count (their unlock records are revoked when the rules stop holding).
  const planUnlocked = useMemo(() => {
    const list: PlanAchievement[] = []
    for (const plan of plans) {
      for (const unlock of plan.unlocks) {
        if (unlock.revokedAt !== null) continue
        const master = unlock.target === PLAN_TARGET
        const spec = master ? plan.master : plan.goals.find((g) => g.id === unlock.target)?.achievement
        if (spec) list.push({ id: unlock.id, spec, planTitle: plan.title, unlockedAt: unlock.unlockedAt, master })
      }
    }
    return list.sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt))
  }, [plans])
  const total = unlocked.length + planUnlocked.length

  const taskGrid = (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
      {unlocked.map((event) => (
        <div key={event.id} data-testid="achievement" className="flex items-center gap-3 rounded-[var(--radius-card)] bg-card p-3.5 ring-1 ring-ink/[0.04]">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-badge-from to-badge-to text-gold ring-1 ring-gold/25">
            <Trophy size={20} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={taskName(taskById.get(event.taskId), event.title)}>
              {taskName(taskById.get(event.taskId), event.title)}
            </p>
            <p className="truncate text-xs text-muted">{formatDate(event.completedAt)}</p>
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <>
      <PageHeader title={t('nav.achievements')} subtitle={t('achievements.subtitle', { count: total })} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {total === 0 ? (
          <EmptyState icon={Trophy} title={t('achievements.empty.title')} body={t('achievements.empty.body')} />
        ) : planUnlocked.length === 0 ? (
          taskGrid
        ) : (
          <div className="flex flex-col gap-6">
            <section>
              <h2 className="mb-3 text-sm font-medium text-muted">{t('achievements.plans')}</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                {planUnlocked.map((a) => (
                  <div
                    key={a.id}
                    data-testid="plan-achievement"
                    data-master={a.master}
                    className={`flex items-center gap-3 rounded-[var(--radius-card)] bg-card p-3.5 ring-1 ${a.master ? 'plan-master-row ring-gold/45' : 'ring-ink/[0.04]'}`}
                  >
                    <PlanBadge spec={a.spec} unlocked master={a.master} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`truncate text-sm font-medium ${a.master ? 'text-gold' : ''}`} title={a.spec.name}>
                          {a.spec.name}
                        </p>
                        <RarityLabel rarity={a.spec.rarity} />
                      </div>
                      <p className="truncate text-xs text-muted" title={a.planTitle}>
                        {a.planTitle} · {formatDate(a.unlockedAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            {unlocked.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-medium text-muted">{t('achievements.tasks')}</h2>
                {taskGrid}
              </section>
            )}
          </div>
        )}
      </div>
    </>
  )
}
