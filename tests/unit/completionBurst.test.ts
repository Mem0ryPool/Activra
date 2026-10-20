import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BURST_IDLE_MS, CompletionBurst, summaryText, type BurstEntry } from '../../src/main/completionBurst'
import { createTranslator } from '../../src/shared/i18n'

const entry = (n: number): BurstEntry => ({ eventId: `event-${n}`, name: `Task ${n}` })

function setup() {
  const settled: BurstEntry[][] = []
  const burst = new CompletionBurst((entries) => settled.push(entries))
  return { burst, settled }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('CompletionBurst', () => {
  it('uses a 2 second idle time by default', () => {
    expect(BURST_IDLE_MS).toBe(2000)
  })

  it('needs no summary for a single completion', () => {
    const { burst, settled } = setup()
    burst.add(entry(1))
    vi.advanceTimersByTime(BURST_IDLE_MS * 3)
    expect(settled).toEqual([])
    expect(burst.current).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  for (const count of [2, 5, 20]) {
    it(`settles ${count} quick completions with one summary, in completion order`, () => {
      const { burst, settled } = setup()
      const entries = Array.from({ length: count }, (_, i) => entry(i))
      for (const e of entries) {
        burst.add(e)
        // Each click comes well inside the idle time, so the round keeps going.
        vi.advanceTimersByTime(BURST_IDLE_MS - 1)
      }
      expect(settled).toEqual([])
      vi.advanceTimersByTime(1)
      expect(settled).toEqual([entries])
      vi.advanceTimersByTime(BURST_IDLE_MS * 5)
      expect(settled).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
    })
  }

  it('restarts the idle time on every new completion', () => {
    const { burst, settled } = setup()
    burst.add(entry(1))
    vi.advanceTimersByTime(1500)
    burst.add(entry(2))
    vi.advanceTimersByTime(1500)
    expect(settled).toEqual([])
    vi.advanceTimersByTime(500)
    expect(settled).toEqual([[entry(1), entry(2)]])
  })

  it('counts a repeated report of one completion once', () => {
    const { burst, settled } = setup()
    burst.add(entry(1))
    burst.add(entry(1))
    burst.add(entry(2))
    burst.add(entry(1))
    vi.advanceTimersByTime(BURST_IDLE_MS)
    expect(settled).toEqual([[entry(1), entry(2)]])
  })

  it('never counts a settled completion again in the next round', () => {
    const { burst, settled } = setup()
    burst.add(entry(1))
    burst.add(entry(2))
    vi.advanceTimersByTime(BURST_IDLE_MS)
    burst.add(entry(2))
    burst.add(entry(3))
    burst.add(entry(4))
    vi.advanceTimersByTime(BURST_IDLE_MS)
    expect(settled).toEqual([
      [entry(1), entry(2)],
      [entry(3), entry(4)]
    ])
  })

  it('starts a new round for a completion made while the summary is on screen, missing nothing', () => {
    const { burst, settled } = setup()
    for (const n of [1, 2, 3]) burst.add(entry(n))
    vi.advanceTimersByTime(BURST_IDLE_MS)
    // The summary for 1-3 is showing; two more completions interrupt it and form their own round.
    burst.add(entry(4))
    vi.advanceTimersByTime(300)
    burst.add(entry(5))
    vi.advanceTimersByTime(BURST_IDLE_MS)
    expect(settled).toEqual([
      [entry(1), entry(2), entry(3)],
      [entry(4), entry(5)]
    ])
    expect(settled.flat().map((e) => e.eventId)).toEqual(['event-1', 'event-2', 'event-3', 'event-4', 'event-5'])
  })

  it('leaves an undone completion out of the summary', () => {
    const { burst, settled } = setup()
    for (const n of [1, 2, 3]) burst.add(entry(n))
    burst.remove('event-2')
    vi.advanceTimersByTime(BURST_IDLE_MS)
    expect(settled).toEqual([[entry(1), entry(3)]])
  })

  it('gives no summary when undos leave a single completion', () => {
    const { burst, settled } = setup()
    burst.add(entry(1))
    burst.add(entry(2))
    burst.remove('event-1')
    vi.advanceTimersByTime(BURST_IDLE_MS)
    expect(settled).toEqual([])
  })

  it('ends the round quietly when every completion was undone', () => {
    const { burst, settled } = setup()
    burst.add(entry(1))
    burst.add(entry(2))
    burst.remove('event-1')
    burst.remove('event-2')
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(BURST_IDLE_MS)
    expect(settled).toEqual([])
  })

  it('does not extend the round on an undo (an undo is not a completion)', () => {
    const { burst, settled } = setup()
    for (const n of [1, 2, 3]) burst.add(entry(n))
    vi.advanceTimersByTime(1500)
    burst.remove('event-3')
    vi.advanceTimersByTime(500)
    expect(settled).toEqual([[entry(1), entry(2)]])
  })

  it('counts completing the same task again after an undo as a new completion', () => {
    const { burst, settled } = setup()
    burst.add(entry(1))
    burst.remove('event-1')
    // A new completion record gets a new id.
    burst.add({ eventId: 'event-1b', name: 'Task 1' })
    burst.add(entry(2))
    vi.advanceTimersByTime(BURST_IDLE_MS)
    expect(settled).toEqual([[{ eventId: 'event-1b', name: 'Task 1' }, entry(2)]])
  })

  it('ignores an undo of something outside the round', () => {
    const { burst, settled } = setup()
    burst.add(entry(1))
    burst.add(entry(2))
    burst.remove('event-old')
    vi.advanceTimersByTime(BURST_IDLE_MS)
    expect(settled).toEqual([[entry(1), entry(2)]])
  })

  it('drops the pending summary on quit and leaves no timer', () => {
    const { burst, settled } = setup()
    for (const n of [1, 2, 3]) burst.add(entry(n))
    burst.destroy()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(BURST_IDLE_MS * 2)
    expect(settled).toEqual([])
    expect(burst.current).toEqual([])
  })

  it('honours a custom idle time', () => {
    const settled: BurstEntry[][] = []
    const burst = new CompletionBurst((e) => settled.push(e), 500)
    burst.add(entry(1))
    burst.add(entry(2))
    vi.advanceTimersByTime(499)
    expect(settled).toEqual([])
    vi.advanceTimersByTime(1)
    expect(settled).toHaveLength(1)
  })
})

describe('summaryText', () => {
  const entries = (n: number) => Array.from({ length: n }, (_, i) => entry(i + 1))

  it('names every achievement for a short round', () => {
    expect(summaryText(entries(2), createTranslator('zh-CN'), '、')).toEqual({
      heading: '连续完成 2 项任务！',
      names: 'Task 1、Task 2'
    })
    expect(summaryText(entries(3), createTranslator('en'), ', ')).toEqual({
      heading: '3 tasks completed in a row!',
      names: 'Task 1, Task 2, Task 3'
    })
  })

  it('names the first three and counts the rest for a long round', () => {
    expect(summaryText(entries(5), createTranslator('zh-CN'), '、')).toEqual({
      heading: '连续完成 5 项任务！',
      names: 'Task 1、Task 2、Task 3，另有 2 项'
    })
    expect(summaryText(entries(20), createTranslator('en'), ', ')).toEqual({
      heading: '20 tasks completed in a row!',
      names: 'Task 1, Task 2, Task 3 and 17 more'
    })
  })
})
