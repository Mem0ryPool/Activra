import { IpcChannels } from '../../shared/ipc'
import type { FocusSnapshot } from '../../shared/focus/types'
import {
  validateFocusDurations,
  validateFocusPhase,
  validateFocusSelection,
  validateFocusTaskId,
  validatePlanFocus,
  validatePlanFocusStart
} from '../../shared/focus/validation'
import { validateId } from '../../shared/validation'
import type { Task, CompletionEvent } from '../../shared/types'
import type { Plan } from '../../shared/planner/types'
import { originForTask } from '../../shared/focus/plan'
import { savePlanFocus, startPlanFocus } from '../focus/planFocus'
import type { FocusService } from '../focus/focusService'
import type { FocusStore } from '../focus/focusStore'
import { TaskNotFoundError } from '../storage/dataStore'
import { broadcast, handle } from './registerHandlers'

export interface FocusHandlerDeps {
  plans: () => Plan[]
  tasks: () => Task[]
  completions: () => CompletionEvent[]
  focus: FocusStore
  service: FocusService
  /** The linked task, looked up when a focus starts; never changed by the timer. */
  findTask: (id: string) => Task | undefined
  /** The name the task is shown with everywhere ("喝水 · 第2/4次"). */
  taskName: (task: Task) => string
}

/**
 * The focus timer's IPC (Phase 6.7). It only ever reads tasks: a focus session never completes,
 * changes or counts a task. Every call answers with the new snapshot, which is also broadcast.
 */
export function registerFocusHandlers({ focus, service, findTask, taskName, plans, tasks, completions }: FocusHandlerDeps): {
  changed: () => void
} {
  const changed = (): void => {
    broadcast(IpcChannels.focusChanged, focus.snapshot())
  }
  const after = async (change: Promise<unknown>): Promise<FocusSnapshot> => {
    const result = await change
    if (result !== false) changed()
    service.sync()
    return focus.snapshot()
  }

  handle(IpcChannels.focusGet, () => focus.snapshot())

  handle(IpcChannels.focusStart, (_e, phaseArg: unknown, taskArg: unknown) => {
    const phase = validateFocusPhase(phaseArg)
    const taskId = phase === 'focus' ? validateFocusTaskId(taskArg) : null
    const task = taskId === null ? undefined : findTask(taskId)
    if (taskId !== null && !task) throw new TaskNotFoundError(`Task ${taskId} not found`)
    return after(focus.start(phase, task ? { id: task.id, title: taskName(task) } : null, task && phase === 'focus' ? originForTask(plans(), task.id) : undefined))
  })

  handle(IpcChannels.focusPause, (_e, runId: unknown) => after(focus.pause(validateId(runId))))
  handle(IpcChannels.focusSetPlan, (_e, input: unknown) => after(savePlanFocus(focus, validatePlanFocus(input), plans())))
  handle(IpcChannels.focusStartPlan, (_e, input: unknown) => after(startPlanFocus(focus, validatePlanFocusStart(input), plans(), tasks(), completions(), Date.now(), taskName)))
  handle(IpcChannels.focusResume, (_e, runId: unknown) => after(focus.resume(validateId(runId))))
  handle(IpcChannels.focusEnd, (_e, runId: unknown) => after(focus.end(validateId(runId))))
  handle(IpcChannels.focusReset, (_e, runId: unknown) => after(focus.reset(validateId(runId))))
  handle(IpcChannels.focusSelect, (_e, selection: unknown) => after(focus.select(validateFocusSelection(selection))))
  handle(IpcChannels.focusSetDurations, (_e, durations: unknown) =>
    after(focus.setDurations(validateFocusDurations(durations)))
  )

  return { changed }
}
