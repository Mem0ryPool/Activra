import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LatestNotice } from '../../src/renderer/src/lib/latestNotice'

/** Phase 6.6.2: the window's light habit message, newest wins, with a controlled clock. */
const DURATION = 2000

function setup() {
  const screen: ({ text: string; id: number } | null)[] = []
  const notices = new LatestNotice<{ text: string }>((n) => screen.push(n), DURATION)
  const visible = (): string | null => notices.current?.text ?? null
  return { notices, screen, visible }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('latest habit message', () => {
  it('a second message replaces the first at once, and the first one\'s timer cannot close it', () => {
    const { notices, visible } = setup()
    notices.show({ text: 'A' })
    vi.advanceTimersByTime(1500)
    notices.show({ text: 'B' })
    expect(visible()).toBe('B')
    // When A's 2 s would have ended, B is still there…
    vi.advanceTimersByTime(600)
    expect(visible()).toBe('B')
    // …and B gets its own full time from when it appeared.
    vi.advanceTimersByTime(DURATION - 600 - 1)
    expect(visible()).toBe('B')
    vi.advanceTimersByTime(1)
    expect(visible()).toBeNull()
  })

  it('three quick messages end on the third, each with a new id', () => {
    const { notices, screen, visible } = setup()
    notices.show({ text: 'A' })
    notices.show({ text: 'B' })
    notices.show({ text: 'C' })
    expect(visible()).toBe('C')
    const ids = screen.filter((n) => n !== null).map((n) => n?.id)
    expect(new Set(ids).size).toBe(3)
    vi.advanceTimersByTime(DURATION)
    expect(visible()).toBeNull()
    // Only one timer was left running: nothing else happens later.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clear takes the message away and leaves no timer behind', () => {
    const { notices, visible } = setup()
    notices.show({ text: 'A' })
    notices.clear()
    expect(visible()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an answer that arrives after a newer one was shown is stale', () => {
    const { notices } = setup()
    const first = notices.begin()
    const second = notices.begin()
    notices.settle(second)
    expect(notices.isStale(first)).toBe(true)
    expect(notices.isStale(second)).toBe(false)
    // In order, nothing is stale.
    const third = notices.begin()
    notices.settle(third)
    const fourth = notices.begin()
    expect(notices.isStale(fourth)).toBe(false)
  })
})
