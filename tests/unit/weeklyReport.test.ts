import { describe, expect, it } from 'vitest'
import { createTranslator } from '../../src/shared/i18n'
import type { FocusSession } from '../../src/shared/focus/types'
import type { Habit, HabitCheckin } from '../../src/shared/habits/types'
import type { Plan } from '../../src/shared/planner/types'
import { insightText, weeklyReportText } from '../../src/shared/report/text'
import { buildWeeklyReport, type WeeklyInput } from '../../src/shared/report/weekly'
import type { CompletionEvent } from '../../src/shared/types'

// Week of Monday 2026-10-12 … Sunday 2026-10-18; "now" is after it unless said otherwise.
const at = (day: string, hour = 12): string => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).toISOString()
const AFTER = new Date('2026-10-21T12:00:00').getTime()

let n = 0
const done = (day: string, taskId = 't1', title = 'Read', undone = false, occurrence: string | null = null): CompletionEvent => ({
  id: `c${++n}`,
  taskId,
  occurrence,
  completedAt: at(day),
  undoneAt: undone ? at(day, 13) : null,
  title
})
const focus = (day: string, focusedSec: number, outcome: FocusSession['outcome'] = 'completed', taskTitle = 'Read'): FocusSession => ({
  id: `f${++n}`,
  taskId: null,
  taskTitle,
  plannedSec: 1500,
  focusedSec,
  startedAt: at(day, 9),
  endedAt: at(day, 10),
  outcome
})
const habit = (partial: Partial<Habit>): Habit => ({
  id: 'h1',
  name: 'Water',
  note: '',
  frequency: { kind: 'daily' },
  startDate: '2026-10-01',
  state: 'active',
  pauses: [],
  createdAt: at('2026-10-01'),
  updatedAt: at('2026-10-01'),
  archivedAt: null,
  ...partial
})
const checkin = (day: string, habitId = 'h1', undone = false): HabitCheckin => ({
  id: `k${++n}`,
  habitId,
  date: day,
  checkedAt: at(day),
  undoneAt: undone ? at(day, 13) : null
})
const input = (partial: Partial<WeeklyInput>): WeeklyInput => ({
  tasks: [],
  completions: [],
  plans: [],
  habits: [],
  habitCheckins: [],
  focusSessions: [],
  ...partial
})

describe('weekly report', () => {
  it('counts completions per Monday-based day, leaves undone ones out, compares with last week', () => {
    const r = buildWeeklyReport(
      input({
        completions: [
          done('2026-10-12'),
          done('2026-10-14'),
          done('2026-10-14', 't2', 'Run'),
          done('2026-10-18'),
          done('2026-10-15', 't1', 'Read', true),
          done('2026-10-08'),
          // A repeating occurrence counts on its own day, even if clicked just after midnight.
          { ...done('2026-10-19', 't3', 'Stretch', false, '2026-10-18'), completedAt: new Date('2026-10-19T00:05:00').toISOString() }
        ]
      }),
      '2026-10-15',
      AFTER
    )
    expect(r.start).toBe('2026-10-12')
    expect(r.end).toBe('2026-10-18')
    expect(r.current).toBe(false)
    expect(r.tasks.completed).toBe(5)
    expect(r.tasks.previous).toBe(1)
    expect(r.tasks.perDay).toEqual([1, 0, 2, 0, 0, 0, 2])
    expect(r.tasks.activeDays).toBe(3)
    expect(r.tasks.top[0]).toEqual({ title: 'Read', count: 3 })
  })

  it('sums focus time and separates completed from ended-early sessions', () => {
    const r = buildWeeklyReport(
      input({ focusSessions: [focus('2026-10-13', 1500), focus('2026-10-13', 600, 'ended-early', 'Write'), focus('2026-10-06', 1500)] }),
      '2026-10-12',
      AFTER
    )
    expect(r.focus).toMatchObject({ focusedSec: 2100, previousSec: 1500, completed: 1, endedEarly: 1 })
    expect(r.focus.perDay[1]).toBe(2100)
    expect(r.focus.top.map((x) => x.title)).toEqual(['Read', 'Write'])
  })

  it('habit rates: only due days count (paused, other weekdays, before start, future days excluded)', () => {
    const daily = habit({ pauses: [{ from: '2026-10-17', until: '2026-10-18' }] })
    const weekdays = habit({ id: 'h2', name: 'Gym', frequency: { kind: 'weekdays', weekdays: [1, 3, 5] } })
    const weekly = habit({ id: 'h3', name: 'Call mom', frequency: { kind: 'weekly', timesPerWeek: 2 } })
    const late = habit({ id: 'h4', name: 'New', startDate: '2026-10-16' })
    const checkins = [
      ...['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map((d) => checkin(d)),
      checkin('2026-10-12', 'h2'),
      checkin('2026-10-13', 'h3'),
      checkin('2026-10-16', 'h4', true)
    ]
    const r = buildWeeklyReport(input({ habits: [daily, weekdays, weekly, late], habitCheckins: checkins }), '2026-10-12', AFTER)
    const by = Object.fromEntries(r.habits.map((h) => [h.name, h]))
    expect(by['Water']).toMatchObject({ done: 5, due: 5, rate: 1 })
    expect(by['Gym']).toMatchObject({ done: 1, due: 3 })
    expect(by['Call mom']).toMatchObject({ done: 1, due: 2, rate: 0.5 })
    expect(by['New']).toMatchObject({ done: 0, due: 3 })

    // During the week, days after today are not due yet.
    const midweek = buildWeeklyReport(input({ habits: [daily], habitCheckins: checkins }), '2026-10-12', new Date('2026-10-14T20:00:00').getTime())
    expect(midweek.current).toBe(true)
    expect(midweek.habits[0]).toMatchObject({ done: 3, due: 3 })
  })

  it('lists plan achievements unlocked this week, never withdrawn ones', () => {
    const plan = {
      id: 'p1',
      title: '7天健身挑战',
      goals: [{ id: 'g1', achievement: { name: '坚持一周' } }],
      master: { name: '全成就！' },
      unlocks: [
        { id: 'u1', target: 'g1', unlockedAt: at('2026-10-14'), revokedAt: null },
        { id: 'u2', target: 'plan', unlockedAt: at('2026-10-15'), revokedAt: null },
        { id: 'u3', target: 'g1', unlockedAt: at('2026-10-13'), revokedAt: at('2026-10-13', 14) }
      ]
    } as unknown as Plan
    const r = buildWeeklyReport(input({ plans: [plan] }), '2026-10-12', AFTER)
    expect(r.plans.goals).toEqual([{ planTitle: '7天健身挑战', name: '坚持一周' }])
    expect(r.plans.plansCompleted).toEqual([{ planTitle: '7天健身挑战', name: '全成就！' }])
  })

  it('insights come only from the numbers, in a fixed order, at most four', () => {
    const r = buildWeeklyReport(
      input({
        completions: [done('2026-10-14'), done('2026-10-14'), done('2026-10-14'), done('2026-10-12'), done('2026-10-06'), done('2026-10-07')],
        focusSessions: [focus('2026-10-13', 300, 'ended-early'), focus('2026-10-14', 400, 'ended-early'), focus('2026-10-07', 1500)],
        habits: [habit({}), habit({ id: 'h2', name: 'Gym' })],
        habitCheckins: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map((d) => checkin(d)).concat(checkin('2026-10-12', 'h2'))
      }),
      '2026-10-12',
      AFTER
    )
    expect(r.insights.map((i) => i.kind)).toEqual(['best-day', 'tasks-up', 'focus-down', 'habit-perfect'])
    expect(r.insights[0]).toMatchObject({ weekday: 2, count: 3 })
    expect(r.insights[1]).toMatchObject({ percent: 100, previous: 2, current: 4 })
    const t = createTranslator('zh-CN')
    expect(insightText(r.insights[0]!, t, 'zh-CN')).toBe('星期三最高效，完成了 3 个任务。')
    expect(insightText(r.insights[3]!, t, 'zh-CN')).toBe('「Water」本周每次都按时打卡。')
  })

  it('a quiet week says so and nothing else; a tie has no best day', () => {
    expect(buildWeeklyReport(input({}), '2026-10-12', AFTER).insights).toEqual([{ kind: 'quiet-week' }])
    const tie = buildWeeklyReport(input({ completions: [done('2026-10-12'), done('2026-10-12'), done('2026-10-13'), done('2026-10-13')] }), '2026-10-12', AFTER)
    expect(tie.insights.some((i) => i.kind === 'best-day')).toBe(false)
  })

  it('copies as plain Chinese text', () => {
    const r = buildWeeklyReport(input({ completions: [done('2026-10-12')], focusSessions: [focus('2026-10-12', 1500)] }), '2026-10-12', AFTER)
    const text = weeklyReportText(r, createTranslator('zh-CN'), 'zh-CN')
    expect(text.split('\n')[0]).toBe('Activra 周报 · 10月12日 – 10月18日')
    expect(text).toContain('完成任务: 1（上周 0）'.replace('（', ' (').replace('）', ')'))
    expect(text).toContain('专注: 25 分钟 · 完成 1 次 · 提前结束 0 次')
  })
})
