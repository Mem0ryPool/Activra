import { useCallback } from 'react'
import { taskDisplayName } from '../../../shared/planner/displayName'
import type { Task } from '../../../shared/types'
import { useAppStore, useT } from '../store/appStore'

/**
 * The display name of a task ("喝水 · 第2/4次" for a timed plan step), for places that only show text.
 * `title` is the title to use instead of the task's current one (a completion keeps the title it had).
 */
export function useTaskName(): (task: Task | undefined, title?: string) => string {
  const t = useT()
  const plans = useAppStore((s) => s.plans)
  return useCallback(
    (task, title) => {
      if (!task) return title ?? ''
      return taskDisplayName(title === undefined ? task : { ...task, title }, plans, t).full
    },
    [plans, t]
  )
}
