import { CheckCircle2, ListTodo, PanelTopOpen, Plus, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { countedCompletions, sortCompletions } from '../../../shared/completions'
import { sortActive } from '../../../shared/taskOrder'
import type { Task } from '../../../shared/types'
import { Button } from '../components/Button'
import { CompletionCard } from '../components/CompletionCard'
import { ConfirmDeleteDialog } from '../components/ConfirmDeleteDialog'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { TaskCard } from '../components/TaskCard'
import { TaskDialog } from '../components/TaskDialog'
import { useAppStore, useT } from '../store/appStore'

type Tab = 'active' | 'completed'
type DialogState = { kind: 'create' } | { kind: 'edit'; task: Task } | { kind: 'delete'; task: Task } | null

export function TasksPage(): React.JSX.Element {
  const t = useT()
  const tasks = useAppStore((s) => s.tasks)
  const completions = useAppStore((s) => s.completions)
  const widget = useAppStore((s) => s.settings.widget)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const newTaskRequested = useAppStore((s) => s.newTaskRequested)
  const setNewTaskRequested = useAppStore((s) => s.setNewTaskRequested)
  const setPage = useAppStore((s) => s.setPage)
  const setPlanWizardRequested = useAppStore((s) => s.setPlanWizardRequested)
  const [tab, setTab] = useState<Tab>('active')
  const [dialog, setDialog] = useState<DialogState>(null)
  const focusTaskId = useAppStore((s) => s.focusTaskId)
  const clearFocusTask = useAppStore((s) => s.clearFocusTask)

  // A clicked reminder: switch to In progress (adjusting state while rendering, as React recommends),
  // then scroll to the task and highlight it briefly.
  const [handledFocus, setHandledFocus] = useState<string | null>(null)
  if (focusTaskId && focusTaskId !== handledFocus) {
    setHandledFocus(focusTaskId)
    setTab('active')
  } else if (!focusTaskId && handledFocus) {
    // Forget the last one, so a later reminder for the same task switches tabs again.
    setHandledFocus(null)
  }
  useEffect(() => {
    if (!focusTaskId) return
    const frame = requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(
        `[data-testid=task-card][data-task="${CSS.escape(focusTaskId)}"]`
      )
      card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      card?.focus({ preventScroll: true })
    })
    const timer = window.setTimeout(clearFocusTask, 2500)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [focusTaskId, clearFocusTask])

  const active = useMemo(() => sortActive(tasks), [tasks])
  // The Completed list shows completions that count, newest first; an undone one drops out.
  const completed = useMemo(() => sortCompletions(countedCompletions(completions)), [completions])
  const tasksById = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks])
  const empty = tab === 'active' ? active.length === 0 : completed.length === 0
  const openCreate = (): void => setDialog({ kind: 'create' })

  return (
    <>
      <PageHeader
        title={t('nav.tasks')}
        actions={
          <>
            <Button
              variant="ghost"
              aria-pressed={widget.visible}
              aria-label={t(widget.visible ? 'tasks.widget.hide' : 'tasks.widget.show')}
              title={t(widget.visible ? 'tasks.widget.hide' : 'tasks.widget.show')}
              className={widget.visible ? 'bg-ink/[0.08] text-fg' : ''}
              onClick={() => void updateSettings({ widget: { ...widget, visible: !widget.visible } })}
            >
              <PanelTopOpen size={16} />
              {t('tasks.widget')}
            </Button>
            <Button
              data-testid="tasks-smart-plan"
              onClick={() => {
                setPlanWizardRequested(true)
                setPage('plans')
              }}
            >
              <Sparkles size={16} />
              {t('tasks.smartPlan')}
            </Button>
            <Button variant="primary" onClick={openCreate}>
              <Plus size={16} strokeWidth={2.5} />
              {t('tasks.new')}
            </Button>
          </>
        }
      />
      <div className="flex shrink-0 gap-1 px-8 pb-4" role="tablist">
        {(['active', 'completed'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex h-8 items-center gap-2 rounded-lg px-3 text-sm transition-colors ${
              tab === id ? 'bg-ink/[0.08] font-medium text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            {t(id === 'active' ? 'tasks.tab.active' : 'tasks.tab.completed')}
            <span className="rounded bg-ink/[0.06] px-1.5 text-xs tabular-nums text-muted">
              {id === 'active' ? active.length : completed.length}
            </span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {empty ? (
          tab === 'active' ? (
            <EmptyState
              icon={ListTodo}
              title={t('tasks.empty.active.title')}
              body={t('tasks.empty.active.body')}
              action={
                <Button variant="primary" onClick={openCreate}>
                  <Plus size={16} strokeWidth={2.5} />
                  {t('tasks.new')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title={t('tasks.empty.completed.title')}
              body={t('tasks.empty.completed.body')}
            />
          )
        ) : tab === 'active' ? (
          <div className="flex flex-col gap-2.5">
            {active.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                highlighted={task.id === focusTaskId}
                onEdit={(x) => setDialog({ kind: 'edit', task: x })}
                onDelete={(x) => setDialog({ kind: 'delete', task: x })}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {completed.map((event) => (
              <CompletionCard
                key={event.id}
                event={event}
                task={tasksById.get(event.taskId)}
                onDelete={(x) => setDialog({ kind: 'delete', task: x })}
              />
            ))}
          </div>
        )}
      </div>
      {(dialog?.kind === 'create' || (newTaskRequested && !dialog)) && (
        <TaskDialog
          onClose={() => {
            setDialog(null)
            setNewTaskRequested(false)
          }}
        />
      )}
      {dialog?.kind === 'edit' && <TaskDialog task={dialog.task} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && <ConfirmDeleteDialog task={dialog.task} onClose={() => setDialog(null)} />}
    </>
  )
}
