import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationScheduler,
  type NotificationKind,
  type NotificationPresenter,
  type NotificationRequest
} from '../../src/main/windows/notificationScheduler'
import type { AchievementPayload } from '../../src/shared/types'

const DURATION = 1000
const EXIT = 400

let seq = 0
function request(kind: NotificationKind, themeId = 'classic'): NotificationRequest {
  seq += 1
  return {
    kind,
    payload: { id: `${kind}-${seq}`, heading: 'Unlocked', taskTitle: themeId, style: { themeId, durationMs: DURATION } } as unknown as AchievementPayload
  }
}

/**
 * Records what is on screen. `loadDelayMs` simulates the window's first page load: like the real
 * window, every show waits on the same load, so shows resume in the order they were asked for.
 */
function fakePresenter(loadDelayMs = 0) {
  const log: string[] = []
  let visible: string | null = null
  let load: Promise<unknown> | null = null
  const presenter: NotificationPresenter = {
    async show(payload, stillWanted) {
      if (loadDelayMs > 0) {
        load ??= new Promise((resolve) => setTimeout(resolve, loadDelayMs))
        await load
      }
      if (!stillWanted()) return
      visible = payload.id
      log.push(`show ${payload.id}`)
    },
    hide() {
      visible = null
      log.push('hide')
    }
  }
  return { presenter, log, visible: () => visible }
}

function setup(loadDelayMs = 0) {
  const fake = fakePresenter(loadDelayMs)
  const scheduler = new NotificationScheduler(fake.presenter, { exitAnimationMs: EXIT })
  return { ...fake, scheduler }
}

/** Lets the presenter's promise settle without moving the clock. */
const flush = () => vi.advanceTimersByTimeAsync(0)
const full = DURATION + EXIT

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('NotificationScheduler previews', () => {
  it('replaces a playing preview with a different theme at once', async () => {
    const { scheduler, log, visible } = setup()
    const classic = request('preview', 'classic')
    const legendary = request('preview', 'legendary')
    scheduler.enqueue(classic)
    await flush()
    await vi.advanceTimersByTimeAsync(300)
    scheduler.enqueue(legendary)
    await flush()
    expect(visible()).toBe(legendary.payload.id)
    expect(log).toEqual([`show ${classic.payload.id}`, `show ${legendary.payload.id}`])
    expect(scheduler.pendingCount).toBe(1)
  })

  it('restarts the same theme from the beginning on a repeated preview', async () => {
    const { scheduler, log, visible } = setup()
    const first = request('preview', 'enhanced')
    const again = request('preview', 'enhanced')
    scheduler.enqueue(first)
    await flush()
    await vi.advanceTimersByTimeAsync(full - 100)
    scheduler.enqueue(again)
    await flush()
    expect(visible()).toBe(again.payload.id)
    // The old timer would have fired here; the restarted preview gets its full time.
    await vi.advanceTimersByTimeAsync(full - 1)
    expect(visible()).toBe(again.payload.id)
    await vi.advanceTimersByTimeAsync(1)
    expect(visible()).toBeNull()
    expect(log).toEqual([`show ${first.payload.id}`, `show ${again.payload.id}`, 'hide'])
  })

  it("never lets a cancelled preview's timer hide the newer one", async () => {
    const { scheduler, log } = setup()
    const ids: string[] = []
    for (const theme of ['classic', 'enhanced', 'legendary', 'custom', 'classic']) {
      const r = request('preview', theme)
      ids.push(r.payload.id)
      scheduler.enqueue(r)
      await flush()
      await vi.advanceTimersByTimeAsync(200)
    }
    // Long past when the first previews would have ended: only the last one's timer counts.
    await vi.advanceTimersByTimeAsync(full - 201)
    expect(log.filter((l) => l === 'hide')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(log).toEqual([...ids.map((id) => `show ${id}`), 'hide'])
    expect(scheduler.pendingCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a stale preview that finishes loading after a newer one', async () => {
    const { scheduler, log, visible } = setup(500)
    const slow = request('preview', 'classic')
    const latest = request('preview', 'legendary')
    scheduler.enqueue(slow)
    await vi.advanceTimersByTimeAsync(100)
    scheduler.enqueue(latest)
    await vi.advanceTimersByTimeAsync(500)
    expect(visible()).toBe(latest.payload.id)
    expect(log).toEqual([`show ${latest.payload.id}`])
  })

  it('leaves no timers behind after rapid clicking', async () => {
    const { scheduler, log } = setup()
    for (let i = 0; i < 30; i++) {
      scheduler.enqueue(request('preview', i % 2 ? 'legendary' : 'classic'))
      await flush()
    }
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(full)
    expect(vi.getTimerCount()).toBe(0)
    expect(log.filter((l) => l === 'hide')).toHaveLength(1)
    expect(scheduler.pendingCount).toBe(0)
  })
})

describe('NotificationScheduler previews and real achievements', () => {
  it('lets a real achievement replace a preview at once', async () => {
    const { scheduler, visible, log } = setup()
    const preview = request('preview')
    const real = request('achievement')
    scheduler.enqueue(preview)
    await flush()
    scheduler.enqueue(real)
    await flush()
    expect(visible()).toBe(real.payload.id)
    await vi.advanceTimersByTimeAsync(full)
    // The replaced preview does not come back.
    expect(log).toEqual([`show ${preview.payload.id}`, `show ${real.payload.id}`, 'hide'])
  })

  it('does not interrupt a real achievement; only the latest waiting preview plays after it', async () => {
    const { scheduler, visible, log } = setup()
    const real = request('achievement')
    const p1 = request('preview', 'classic')
    const p2 = request('preview', 'enhanced')
    const p3 = request('preview', 'legendary')
    scheduler.enqueue(real)
    await flush()
    for (const p of [p1, p2, p3]) {
      scheduler.enqueue(p)
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(visible()).toBe(real.payload.id)
    expect(scheduler.snapshot.waitingPreview).toBe(p3)
    await vi.advanceTimersByTimeAsync(full - 300)
    expect(visible()).toBe(p3.payload.id)
    await vi.advanceTimersByTimeAsync(full)
    expect(log).toEqual([`show ${real.payload.id}`, 'hide', `show ${p3.payload.id}`, 'hide'])
  })

  it('lets a new achievement replace the one on screen at once; the waiting preview plays after the last', async () => {
    const { scheduler, log, visible } = setup()
    const a = request('achievement')
    const b = request('achievement')
    const c = request('achievement')
    const preview = request('preview')
    scheduler.enqueue(a)
    await flush()
    expect(visible()).toBe(a.payload.id)
    scheduler.enqueue(preview)
    await vi.advanceTimersByTimeAsync(200)
    scheduler.enqueue(b)
    await flush()
    // No waiting: b is on screen the moment it arrives.
    expect(visible()).toBe(b.payload.id)
    await vi.advanceTimersByTimeAsync(200)
    scheduler.enqueue(c)
    await flush()
    expect(visible()).toBe(c.payload.id)
    expect(scheduler.pendingCount).toBe(2)
    // c gets its full time from the moment it replaced b; old timers never end it early.
    await vi.advanceTimersByTimeAsync(full - 1)
    expect(visible()).toBe(c.payload.id)
    await vi.advanceTimersByTimeAsync(1)
    expect(visible()).toBe(preview.payload.id)
    await vi.advanceTimersByTimeAsync(full)
    expect(log).toEqual([
      `show ${a.payload.id}`,
      `show ${b.payload.id}`,
      `show ${c.payload.id}`,
      'hide',
      `show ${preview.payload.id}`,
      'hide'
    ])
  })

  it('keeps no queue: 20 quick completions show each one at once and leave one timer', async () => {
    const { scheduler, log, visible } = setup()
    const reqs = Array.from({ length: 20 }, () => request('achievement'))
    for (const r of reqs) {
      scheduler.enqueue(r)
      await flush()
      expect(visible()).toBe(r.payload.id)
      await vi.advanceTimersByTimeAsync(50)
    }
    expect(scheduler.pendingCount).toBe(1)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(full)
    // Every completion was shown exactly once, in order, and nothing replays afterwards.
    expect(log).toEqual([...reqs.map((r) => `show ${r.payload.id}`), 'hide'])
    expect(scheduler.pendingCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows achievements that arrive in the same tick one after another, ending on the latest', async () => {
    const { scheduler, log, visible } = setup()
    const a = request('achievement')
    const b = request('achievement')
    scheduler.enqueue(a)
    scheduler.enqueue(b)
    await flush()
    expect(visible()).toBe(b.payload.id)
    // a was replaced, not queued: it never resurfaces after b.
    await vi.advanceTimersByTimeAsync(full * 3)
    expect(log).toEqual([`show ${a.payload.id}`, `show ${b.payload.id}`, 'hide'])
  })

  it('still shows completions made while the window was loading, in order, ending on the newest', async () => {
    const { scheduler, log, visible } = setup(500)
    const slow = request('achievement')
    const middle = request('achievement')
    const latest = request('achievement')
    scheduler.enqueue(slow)
    await vi.advanceTimersByTimeAsync(100)
    scheduler.enqueue(middle)
    scheduler.enqueue(latest)
    expect(log).toEqual([])
    await vi.advanceTimersByTimeAsync(400)
    expect(log).toEqual([`show ${slow.payload.id}`, `show ${middle.payload.id}`, `show ${latest.payload.id}`])
    expect(visible()).toBe(latest.payload.id)
    expect(scheduler.snapshot.active).toBe(latest)
    // Only the newest one owns the timer: the earlier ones cannot hide it early.
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(full - 1)
    expect(visible()).toBe(latest.payload.id)
    await vi.advanceTimersByTimeAsync(1)
    expect(log.at(-1)).toBe('hide')
    expect(scheduler.pendingCount).toBe(0)
  })

  it('does not show a completion undone while the window was still loading', async () => {
    const { scheduler, log } = setup(500)
    const undone = request('achievement')
    const kept = request('achievement')
    scheduler.enqueue(undone)
    scheduler.enqueue(kept)
    scheduler.cancel(undone.payload.id)
    await vi.advanceTimersByTimeAsync(500)
    expect(log).toEqual([`show ${kept.payload.id}`])
  })

  it('a completion during a slow summary show still interrupts it and stays on screen', async () => {
    const { scheduler, log, visible } = setup(500)
    const summary = request('summary')
    const next = request('achievement')
    scheduler.enqueue(summary)
    await vi.advanceTimersByTimeAsync(100)
    scheduler.enqueue(next)
    await vi.advanceTimersByTimeAsync(400)
    expect(log).toEqual([`show ${summary.payload.id}`, `show ${next.payload.id}`])
    expect(visible()).toBe(next.payload.id)
    await vi.advanceTimersByTimeAsync(full)
    expect(log.at(-1)).toBe('hide')
    expect(log.filter((l) => l === 'hide')).toHaveLength(1)
  })

  it('moves on when showing fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const shown: string[] = []
    const scheduler = new NotificationScheduler(
      {
        show: async (payload) => {
          if (shown.length === 0) {
            shown.push('failed')
            throw new Error('window gone')
          }
          shown.push(payload.id)
        },
        hide: () => undefined
      },
      { exitAnimationMs: EXIT }
    )
    const a = request('achievement')
    const b = request('achievement')
    scheduler.enqueue(a)
    scheduler.enqueue(b)
    await flush()
    expect(shown).toEqual(['failed', b.payload.id])
    error.mockRestore()
  })

  it('destroy cancels everything', async () => {
    const { scheduler, log } = setup()
    scheduler.enqueue(request('achievement'))
    scheduler.enqueue(request('achievement'))
    scheduler.enqueue(request('preview'))
    await flush()
    scheduler.destroy()
    expect(scheduler.pendingCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(full * 5)
    // Both achievements were shown as they arrived; nothing (not even the preview) plays after destroy.
    expect(log).toHaveLength(2)
  })
})

describe('Undo and duplicates', () => {
  it('shows the same completion only once', async () => {
    const { scheduler, log } = setup()
    const a = request('achievement')
    scheduler.enqueue(a)
    scheduler.enqueue(a)
    await flush()
    await vi.advanceTimersByTimeAsync(full)
    await vi.advanceTimersByTimeAsync(full)
    expect(log.filter((x) => x.startsWith('show'))).toEqual([`show ${a.payload.id}`])
  })

  it('lets an undone achievement on screen finish, and the next completion still replaces it', async () => {
    const { scheduler, log, visible } = setup()
    const a = request('achievement')
    const b = request('achievement')
    scheduler.enqueue(a)
    await flush()
    expect(scheduler.cancel(a.payload.id)).toBe(true)
    expect(visible()).toBe(a.payload.id)
    scheduler.enqueue(b)
    await flush()
    expect(visible()).toBe(b.payload.id)
    // Cancelling something that is not on screen reports false and changes nothing.
    expect(scheduler.cancel('nothing')).toBe(false)
    await vi.advanceTimersByTimeAsync(full)
    expect(log).toEqual([`show ${a.payload.id}`, `show ${b.payload.id}`, 'hide'])
    // The undone completion never comes back, even if it is reported again.
    scheduler.enqueue(a)
    await flush()
    expect(log).toHaveLength(3)
  })

  it('never shows a completion that was withdrawn before it arrived', async () => {
    const { scheduler, log } = setup()
    const a = request('achievement')
    scheduler.cancel(a.payload.id)
    scheduler.enqueue(a)
    await flush()
    expect(log).toEqual([])
  })
})


describe('Burst summary', () => {
  it('lets a summary replace the achievement on screen at once', async () => {
    const { scheduler, visible, log } = setup()
    const a = request('achievement')
    const summary = request('summary')
    scheduler.enqueue(a)
    await vi.advanceTimersByTimeAsync(300)
    scheduler.enqueue(summary)
    await flush()
    expect(visible()).toBe(summary.payload.id)
    await vi.advanceTimersByTimeAsync(full)
    expect(log).toEqual([`show ${a.payload.id}`, `show ${summary.payload.id}`, 'hide'])
  })

  it('lets a new completion interrupt the summary at once; the summary does not come back', async () => {
    const { scheduler, visible, log } = setup()
    const summary = request('summary')
    const next = request('achievement')
    scheduler.enqueue(summary)
    await vi.advanceTimersByTimeAsync(200)
    scheduler.enqueue(next)
    await flush()
    expect(visible()).toBe(next.payload.id)
    await vi.advanceTimersByTimeAsync(full * 3)
    expect(log).toEqual([`show ${summary.payload.id}`, `show ${next.payload.id}`, 'hide'])
  })

  it('does not let a preview interrupt a summary', async () => {
    const { scheduler, visible } = setup()
    const summary = request('summary')
    const preview = request('preview')
    scheduler.enqueue(summary)
    await flush()
    scheduler.enqueue(preview)
    await flush()
    expect(visible()).toBe(summary.payload.id)
    await vi.advanceTimersByTimeAsync(full)
    expect(visible()).toBe(preview.payload.id)
  })

  it('shows the same summary only once', async () => {
    const { scheduler, log } = setup()
    const summary = request('summary')
    scheduler.enqueue(summary)
    scheduler.enqueue(summary)
    await flush()
    await vi.advanceTimersByTimeAsync(full * 2)
    expect(log).toEqual([`show ${summary.payload.id}`, 'hide'])
  })
})

describe('Habit cards replaced elsewhere (Phase 6.6.2)', () => {
  it('dismiss ends the card on screen at once; its old timer never hides the next card', async () => {
    const { scheduler, log, visible } = setup()
    const record = request('achievement')
    scheduler.enqueue(record)
    await flush()
    await vi.advanceTimersByTimeAsync(300)
    // A plain check-in replaced the record card with the window's light message.
    expect(scheduler.dismiss(record.payload.id)).toBe(true)
    expect(visible()).toBeNull()
    expect(log.at(-1)).toBe('hide')
    const goal = request('achievement')
    scheduler.enqueue(goal)
    await flush()
    // When the record card's time would have ended, the goal card is still there, with its full time.
    await vi.advanceTimersByTimeAsync(full - 300)
    expect(visible()).toBe(goal.payload.id)
    await vi.advanceTimersByTimeAsync(300 - 1)
    expect(visible()).toBe(goal.payload.id)
    await vi.advanceTimersByTimeAsync(1)
    expect(visible()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('dismiss leaves any other notification alone', async () => {
    const { scheduler, visible } = setup()
    const habitCard = request('achievement')
    const task = request('achievement')
    scheduler.enqueue(habitCard)
    scheduler.enqueue(task)
    await flush()
    // The habit card was already replaced by a task's achievement: dismissing it changes nothing.
    expect(scheduler.dismiss(habitCard.payload.id)).toBe(false)
    expect(visible()).toBe(task.payload.id)
    await vi.advanceTimersByTimeAsync(full)
    expect(visible()).toBeNull()
  })

  it('a preview waiting behind a dismissed card plays next', async () => {
    const { scheduler, visible } = setup()
    const card = request('achievement')
    scheduler.enqueue(card)
    await flush()
    const preview = request('preview')
    scheduler.enqueue(preview)
    scheduler.dismiss(card.payload.id)
    await flush()
    expect(visible()).toBe(preview.payload.id)
  })

  it('cards replace each other at once, each from the start (plain → record → goal kept as before)', async () => {
    const { scheduler, log, visible } = setup()
    const record = request('achievement')
    const goal = request('achievement')
    scheduler.enqueue(record)
    await flush()
    scheduler.enqueue(goal)
    await flush()
    expect(visible()).toBe(goal.payload.id)
    expect(log).toEqual([`show ${record.payload.id}`, `show ${goal.payload.id}`])
    await vi.advanceTimersByTimeAsync(full)
    expect(visible()).toBeNull()
  })
})
