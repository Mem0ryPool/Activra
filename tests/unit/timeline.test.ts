import { describe, expect, it } from 'vitest'
import type { FocusSession } from '../../src/shared/focus/types'
import type { Habit, HabitCheckin } from '../../src/shared/habits/types'
import type { Plan } from '../../src/shared/planner/types'
import { dayTimeline, monthMarks, type TimelineInput } from '../../src/shared/timeline'
import type { CompletionEvent, Task } from '../../src/shared/types'

const at = (day: string, hm = '12:00'): string => new Date(`${day}T${hm}:00`).toISOString()
const NOW = new Date('2026-10-17T15:00:00').getTime()

const task = (partial: Partial<Task>): Task => ({
  id: 't1',
  title: 'Report',
  description: '',
  createdAt: at('2026-10-01'),
  updatedAt: at('2026-10-01'),
  completedAt: null,
  status: 'active',
  timerConfig: null,
  themeOverride: null,
  recurrence: null,
  recurrenceHistory: [],
  skippedOccurrences: [],
  due: null,
  reminderMinutes: null,
  window: null,
  ...partial
})
const daily = (id: string, title: string): Task =>
  task({ id, title, recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: '2026-10-01', endDate: null } })
const completion = (id: string, taskId: string, day: string, hm: string, occurrence: string | null = null, undone = false): CompletionEvent => ({
  id,
  taskId,
  occurrence,
  completedAt: at(day, hm),
  undoneAt: undone ? at(day, '23:00') : null,
  title: 'stored'
})
const input = (partial: Partial<TimelineInput>): TimelineInput => ({
  tasks: [],
  completions: [],
  plans: [],
  habits: [],
  habitCheckins: [],
  focusSessions: [],
  ...partial
})

describe('day timeline', () => {
  it('orders a day: all-day items first, then by time; undone completions are left out', () => {
    const habit = { id: 'h1', name: 'Water' } as Habit
    const checkin: HabitCheckin = { id: 'k1', habitId: 'h1', date: '2026-10-16', checkedAt: at('2026-10-16', '08:00'), undoneAt: null }
    const session: FocusSession = {
      id: 'f1',
      taskId: 't1',
      taskTitle: 'Report',
      plannedSec: 1500,
      focusedSec: 1500,
      startedAt: at('2026-10-16', '09:00'),
      endedAt: at('2026-10-16', '09:25'),
      outcome: 'completed'
    }
    const plan = {
      id: 'p1',
      title: 'Plan',
      goals: [{ id: 'g1', achievement: { name: 'Week one' } }],
      master: null,
      unlocks: [
        { id: 'u1', target: 'g1', unlockedAt: at('2026-10-16', '18:00'), revokedAt: null },
        { id: 'u2', target: 'g1', unlockedAt: at('2026-10-16', '19:00'), revokedAt: at('2026-10-16', '19:05') }
      ]
    } as unknown as Plan
    const items = dayTimeline(
      input({
        tasks: [task({ status: 'completed', completedAt: at('2026-10-16', '10:00') }), daily('d1', 'Stretch')],
        completions: [completion('c1', 't1', '2026-10-16', '10:00'), completion('c2', 'd1', '2026-10-16', '07:00', '2026-10-16', true)],
        habits: [habit],
        habitCheckins: [checkin],
        focusSessions: [session],
        plans: [plan]
      }),
      '2026-10-16',
      NOW
    )
    expect(items.map((i) => i.kind)).toEqual(['occurrence', 'checkin', 'focus', 'completion', 'achievement'])
    expect(items[0]).toMatchObject({ kind: 'occurrence', title: 'Stretch', status: 'missed' })
    expect(items[2]).toMatchObject({ at: Date.parse(at('2026-10-16', '09:00')), end: Date.parse(at('2026-10-16', '09:25')) })
  })

  it('a repeating occurrence clicked after midnight stays on its own day', () => {
    const items = dayTimeline(
      input({ tasks: [daily('d1', 'Stretch')], completions: [completion('c1', 'd1', '2026-10-17', '00:05', '2026-10-16')] }),
      '2026-10-16',
      NOW
    )
    expect(items.find((i) => i.kind === 'occurrence')).toMatchObject({ status: 'done' })
    expect(items.some((i) => i.kind === 'completion')).toBe(true)
    expect(dayTimeline(input({ tasks: [daily('d1', 'Stretch')], completions: [completion('c1', 'd1', '2026-10-17', '00:05', '2026-10-16')] }), '2026-10-17', NOW).filter((i) => i.kind === 'completion')).toEqual([])
  })

  it('deadlines and timed steps: done, overdue, open, upcoming, missed', () => {
    const tasks = [
      task({ id: 'a', title: 'Overdue', due: { date: '2026-10-17', time: '09:00' } }),
      task({ id: 'b', title: 'Tonight', due: { date: '2026-10-17', time: '20:00' } }),
      task({ id: 'c', title: 'All day', due: { date: '2026-10-17', time: null } }),
      task({ id: 'd', title: 'Done', due: { date: '2026-10-17', time: '08:00' }, status: 'completed', completedAt: at('2026-10-17', '07:00') }),
      task({ id: 'w1', title: 'Water (1/2)', window: { start: at('2026-10-17', '14:00'), end: at('2026-10-17', '16:00') } }),
      task({ id: 'w2', title: 'Water (2/2)', window: { start: at('2026-10-17', '10:00'), end: at('2026-10-17', '11:00') } })
    ]
    const items = dayTimeline(input({ tasks }), '2026-10-17', NOW)
    const status = Object.fromEntries(items.map((i) => [i.title, 'status' in i ? i.status : null]))
    expect(status).toMatchObject({ Overdue: 'overdue', Tonight: 'upcoming', 'All day': 'upcoming', Done: 'done', 'Water (1/2)': 'open', 'Water (2/2)': 'missed' })
    expect(items[0]).toMatchObject({ title: 'All day', at: null })
    // Tomorrow's repeating occurrence is upcoming; nothing is recorded for it.
    expect(dayTimeline(input({ tasks: [daily('d1', 'Stretch')] }), '2026-10-18', NOW)).toEqual([
      { kind: 'occurrence', id: 'd1@2026-10-18', at: null, title: 'Stretch', taskId: 'd1', status: 'upcoming' }
    ])
  })

  it('month marks count what happened and open deadlines per day', () => {
    const marks = monthMarks(
      input({
        tasks: [task({ id: 'a', due: { date: '2026-10-20', time: null } }), task({ id: 'b', due: { date: '2026-10-20', time: null }, status: 'completed', completedAt: at('2026-10-19') })],
        completions: [completion('c1', 'b', '2026-10-19', '10:00'), completion('c2', 'b', '2026-10-19', '11:00', null, true)],
        habitCheckins: [{ id: 'k', habitId: 'h', date: '2026-10-19', checkedAt: at('2026-10-19'), undoneAt: null }]
      }),
      ['2026-10-19', '2026-10-20', '2026-10-21']
    )
    expect(marks.get('2026-10-19')).toEqual({ completed: 1, focusSec: 0, checkins: 1, due: 0 })
    expect(marks.get('2026-10-20')).toEqual({ completed: 0, focusSec: 0, checkins: 0, due: 1 })
    expect(marks.has('2026-10-21')).toBe(false)
  })
})
