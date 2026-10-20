import { completionDay, countedCompletions } from './completions'
import { dayKey } from './dates'
import { overdueFrom } from './deadline'
import type { FocusSession } from './focus/types'
import type { Habit, HabitCheckin } from './habits/types'
import { isCountedCheckin } from './habits/streak'
import { PLAN_TARGET, type Plan } from './planner/types'
import { occursOn } from './recurrence'
import type { CompletionEvent, Task } from './types'

/**
 * Calendar & timeline (Phase 6.9). Read-only views over the stored records: what happened on a day
 * (completions, focus sessions, habit check-ins, plan achievements) and what is planned for it
 * (deadlines, repeating occurrences, timed plan steps). Nothing is stored or changed here; a missed
 * day is only shown, never completed.
 */

export interface TimelineInput {
  tasks: readonly Task[]
  completions: readonly CompletionEvent[]
  plans: readonly Plan[]
  habits: readonly Habit[]
  habitCheckins: readonly HabitCheckin[]
  focusSessions: readonly FocusSession[]
}

export type TimelineItem =
  | { kind: 'completion'; id: string; at: number; title: string; taskId: string }
  | { kind: 'focus'; id: string; at: number; end: number; title: string; focusedSec: number; outcome: FocusSession['outcome']; taskId: string | null }
  | { kind: 'checkin'; id: string; at: number; title: string; habitId: string }
  | { kind: 'achievement'; id: string; at: number; title: string; planTitle: string; master: boolean }
  /** A deadline on this day; `at` is null for "by the end of the day". */
  | { kind: 'deadline'; id: string; at: number | null; title: string; taskId: string; status: 'done' | 'overdue' | 'upcoming' }
  /** A repeating task's occurrence on this day (all-day). */
  | { kind: 'occurrence'; id: string; at: null; title: string; taskId: string; status: 'done' | 'missed' | 'today' | 'upcoming' }
  /** A timed plan step whose window starts on this day. */
  | { kind: 'window'; id: string; at: number; end: number; title: string; taskId: string; status: 'done' | 'missed' | 'open' | 'upcoming' }

function dayBounds(key: string): [number, number] {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()]
}

const within = (t: number, [from, to]: [number, number]): boolean => t >= from && t < to

/**
 * Everything on day `key`, in time order; all-day items (deadlines without a time, repeating
 * occurrences) come first. `title` is the stored title; pages show their own display name.
 */
export function dayTimeline(input: TimelineInput, key: string, now: number): TimelineItem[] {
  const bounds = dayBounds(key)
  const today = dayKey(new Date(now))
  const items: TimelineItem[] = []
  const counted = countedCompletions(input.completions)
  const taskTitle = (id: string, fallback: string): string => input.tasks.find((t) => t.id === id)?.title ?? fallback

  for (const e of counted) {
    if (completionDay(e) !== key) continue
    items.push({ kind: 'completion', id: e.id, at: Date.parse(e.completedAt), title: taskTitle(e.taskId, e.title), taskId: e.taskId })
  }
  for (const s of input.focusSessions) {
    const end = Date.parse(s.endedAt)
    if (!within(end, bounds)) continue
    items.push({ kind: 'focus', id: s.id, at: end - s.focusedSec * 1000, end, title: s.taskTitle, focusedSec: s.focusedSec, outcome: s.outcome, taskId: s.taskId })
  }
  for (const c of input.habitCheckins) {
    if (c.date !== key || !isCountedCheckin(c)) continue
    const habit = input.habits.find((h) => h.id === c.habitId)
    if (habit) items.push({ kind: 'checkin', id: c.id, at: Date.parse(c.checkedAt), title: habit.name, habitId: habit.id })
  }
  for (const plan of input.plans) {
    for (const u of plan.unlocks) {
      if (u.revokedAt !== null || !within(Date.parse(u.unlockedAt), bounds)) continue
      const master = u.target === PLAN_TARGET
      const name = master ? (plan.master?.name ?? plan.title) : plan.goals.find((g) => g.id === u.target)?.achievement.name
      if (name) items.push({ kind: 'achievement', id: u.id, at: Date.parse(u.unlockedAt), title: name, planTitle: plan.title, master })
    }
  }
  for (const task of input.tasks) {
    if (task.recurrence) {
      if (!occursOn(task, key)) continue
      const done = counted.some((e) => e.taskId === task.id && e.occurrence === key)
      const status = done ? 'done' : key < today ? 'missed' : key === today ? 'today' : 'upcoming'
      items.push({ kind: 'occurrence', id: `${task.id}@${key}`, at: null, title: task.title, taskId: task.id, status })
      if (task.due) {
        const from = overdueFrom(task, key)
        items.push({
          kind: 'deadline',
          id: `due-${task.id}@${key}`,
          at: task.due.time && from !== null ? from : null,
          title: task.title,
          taskId: task.id,
          status: done ? 'done' : from !== null && now >= from ? 'overdue' : 'upcoming'
        })
      }
      continue
    }
    if (task.due?.date === key) {
      const from = overdueFrom(task, null)
      items.push({
        kind: 'deadline',
        id: `due-${task.id}`,
        at: task.due.time && from !== null ? from : null,
        title: task.title,
        taskId: task.id,
        status: task.status === 'completed' ? 'done' : from !== null && now >= from ? 'overdue' : 'upcoming'
      })
    }
    if (task.window) {
      const start = Date.parse(task.window.start)
      const end = Date.parse(task.window.end)
      if (!within(start, bounds)) continue
      const status = task.status === 'completed' ? 'done' : now >= end ? 'missed' : now >= start ? 'open' : 'upcoming'
      items.push({ kind: 'window', id: `win-${task.id}`, at: start, end, title: task.title, taskId: task.id, status })
    }
  }
  return items.sort((a, b) => (a.at ?? -Infinity) - (b.at ?? -Infinity) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
}

export interface DayMarks {
  completed: number
  focusSec: number
  checkins: number
  /** Deadlines that day still to do (upcoming or overdue). */
  due: number
}

/** Per-day summary for a month grid: what happened, and open deadlines. Keys are local date keys. */
export function monthMarks(input: TimelineInput, keys: readonly string[]): Map<string, DayMarks> {
  const wanted = new Set(keys)
  const marks = new Map<string, DayMarks>()
  const get = (key: string): DayMarks => {
    let m = marks.get(key)
    if (!m) marks.set(key, (m = { completed: 0, focusSec: 0, checkins: 0, due: 0 }))
    return m
  }
  for (const e of countedCompletions(input.completions)) {
    const key = completionDay(e)
    if (wanted.has(key)) get(key).completed += 1
  }
  for (const s of input.focusSessions) {
    const key = dayKey(new Date(Date.parse(s.endedAt)))
    if (wanted.has(key)) get(key).focusSec += s.focusedSec
  }
  for (const c of input.habitCheckins) if (wanted.has(c.date) && isCountedCheckin(c)) get(c.date).checkins += 1
  for (const task of input.tasks) {
    if (task.recurrence || task.status === 'completed' || !task.due?.date || !wanted.has(task.due.date)) continue
    get(task.due.date).due += 1
  }
  return marks
}
