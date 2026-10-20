import type { Translate } from '../i18n'
import type { Task } from '../types'
import { planNodeLabel } from './nodeLabel'
import type { Plan } from './types'

/**
 * One name for a task on every surface (Phase 6.3): the task lists, the Plans page, the desktop
 * widget, the tray's quick complete menu, the achievement notification and the undo toast. A timed
 * plan node reads "喝水 · 第2/4次" / "Drink water · 2 of 4"; every other task keeps its own title.
 * Display only: the stored title ("喝水 (2/4)"), the task id and the completion records never change.
 */
export interface TaskDisplayName {
  /** The whole name, e.g. for a tooltip or a screen reader. */
  full: string
  /** The part that may be shortened: the node's task name, or the plain task title. */
  name: string
  /** What follows the name and must stay readable (" · 第2/4次"); empty for a plain task. */
  suffix: string
}

type NamedTask = Pick<Task, 'id' | 'title' | 'description' | 'window'>

export function taskDisplayName(task: NamedTask, plans: readonly Plan[], t: Translate): TaskDisplayName {
  const node = planNodeLabel(task, plans)
  if (!node) return { full: task.title, name: task.title, suffix: '' }
  if (node.count <= 1) return { full: node.name, name: node.name, suffix: '' }
  const full = t('tasks.node.title', { name: node.name, n: node.index, total: node.count })
  // The translation puts the name first ("{name} · 第{n}/{total}次"), so what follows it is the suffix.
  const suffix = full.startsWith(node.name) ? full.slice(node.name.length) : ''
  return { full, name: suffix ? node.name : full, suffix }
}

/** Shortens text to at most `max` characters (whole code points, so no broken emoji), ending in "…". */
export function truncateText(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`
}

/**
 * The name for places that cannot show a tooltip or wrap (tray menu, notification card): the name part
 * is shortened, the node position (" · 第2/4次") is always kept. The full name stays in the main window.
 */
export function shortDisplayName(display: TaskDisplayName, max: number): string {
  if (!display.suffix) return truncateText(display.full, max)
  const room = Math.max(8, max - Array.from(display.suffix).length)
  return truncateText(display.name, room) + display.suffix
}

/** Longest name the tray's quick complete menu and the achievement card show before shortening. */
export const COMPACT_NAME_MAX = 40
