import { describe, expect, it } from 'vitest'
import { planFocusSummary } from '../../src/shared/planner/focus'
import type { FocusSession } from '../../src/shared/focus/types'
import type { Plan } from '../../src/shared/planner/types'

const plan: Plan = {
  id: 'plan-1',
  title: 'Study plan',
  sourceText: '',
  createdAt: '2026-10-17T08:00:00.000Z',
  updatedAt: '2026-10-17T08:00:00.000Z',
  goals: [
    {
      id: 'goal-1',
      title: 'Read',
      category: 'reading',
      quantity: null,
      condition: { kind: 'once', due: null, onTime: false },
      after: null,
      taskId: 'task-read',
      nodeTaskIds: [],
      startedOn: '2026-10-17',
      achievement: { name: 'Reader', description: 'Read', icon: 'book-open', rarity: 'common' }
    },
    {
      id: 'goal-2',
      title: 'Review',
      category: 'study',
      quantity: null,
      condition: { kind: 'interval', start: '2026-10-17T09:00:00.000Z', minutes: 30, count: 2 },
      after: null,
      taskId: 'task-slot-1',
      nodeTaskIds: ['task-slot-1', 'task-slot-2'],
      startedOn: '2026-10-17',
      achievement: { name: 'Reviewer', description: 'Review', icon: 'target', rarity: 'rare' }
    }
  ],
  master: null,
  unlocks: []
}

function session(id: string, taskId: string | null, focusedSec: number): FocusSession {
  return {
    id,
    taskId,
    taskTitle: taskId ?? '',
    plannedSec: 1500,
    focusedSec,
    startedAt: '2026-10-17T09:00:00.000Z',
    endedAt: '2026-10-17T09:25:00.000Z',
    outcome: 'completed'
  }
}

describe('plan focus summary', () => {
  it('deduplicates persisted ids and respects explicit origins after a linked task disappears', () => {
    const record = { ...session('origin-record', 'deleted-task', 90), origin: { planId: plan.id, goalId: plan.goals[0]!.id } }
    const other = { ...session('wrong-plan', 'task-read', 600), origin: { planId: 'other-plan', goalId: 'other-goal' } }
    expect(planFocusSummary(plan, [record, record, other])).toEqual({ focusedSec: 90, sessions: 1 })
  })
  it('adds sessions for every task created by the plan and ignores everything else', () => {
    expect(
      planFocusSummary(plan, [
        session('read', 'task-read', 60),
        session('slot-1', 'task-slot-1', 90),
        session('slot-2', 'task-slot-2', 120),
        session('other-plan', 'task-other', 600),
        session('unlinked', null, 600)
      ])
    ).toEqual({ focusedSec: 270, sessions: 3 })
  })
})
