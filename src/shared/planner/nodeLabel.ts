import type { Task } from '../types'
import { goalTaskDescription } from './sync'
import type { Plan } from './types'

/**
 * How a timed plan node is shown in task lists (Phase 6.2): "喝水 · 第2/4次" instead of the stored
 * title "喝水 (2/4)" plus the whole plan description on every card. Display only: the stored task,
 * its title and its completion records are unchanged (notifications and the tray keep the stored title).
 */
export interface NodeLabel {
  /** The task part of the title, without the stored "(2/4)". */
  name: string
  /** 1-based position of this node in its goal. */
  index: number
  count: number
  /** The description is the one the plan generated (not typed by the user), so cards may leave it out. */
  generatedDescription: boolean
}

const SUFFIX = /\s*\((\d+)\/(\d+)\)\s*$/

function stripSuffix(title: string): string {
  return title.replace(SUFFIX, '').trim()
}

export function planNodeLabel(task: Pick<Task, 'id' | 'title' | 'description' | 'window'>, plans: readonly Plan[]): NodeLabel | null {
  if (!task.window) return null
  for (const plan of plans) {
    for (const goal of plan.goals) {
      const index = goal.nodeTaskIds.indexOf(task.id)
      if (index < 0) continue
      return {
        name: stripSuffix(task.title) || goal.title,
        index: index + 1,
        count: goal.nodeTaskIds.length,
        generatedDescription: task.description === goalTaskDescription(plan, goal)
      }
    }
  }
  // A node whose plan was deleted still carries its number in the stored title.
  const m = SUFFIX.exec(task.title)
  if (!m) return null
  const index = Number(m[1])
  const count = Number(m[2])
  if (!(index >= 1 && index <= count)) return null
  return { name: stripSuffix(task.title), index, count, generatedDescription: false }
}
