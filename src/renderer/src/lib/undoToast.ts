import type { Translate } from '../../../shared/i18n'
import { taskDisplayName } from '../../../shared/planner/displayName'
import type { Plan } from '../../../shared/planner/types'
import type { Task } from '../../../shared/types'

/** "已完成 · 撤销" for a completion, named like the task's card (main window and widget alike). */
export function undoToastFor(
  eventId: string,
  task: Pick<Task, 'id' | 'title' | 'description' | 'window'>,
  plans: readonly Plan[],
  t: Translate
): { eventId: string; title: string; suffix: string; shownAt: number } {
  const display = taskDisplayName(task, plans, t)
  return { eventId, title: display.full, suffix: display.suffix, shownAt: Date.now() }
}
