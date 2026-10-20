import { clockJumpCredit, type ClockSample } from '../../shared/focus/timer'
import type { FocusFinished } from '../../shared/focus/types'
import type { FocusStore } from './focusStore'

export interface FocusServiceOptions {
  store: FocusStore
  /** After every change of the timer (broadcast the snapshot). */
  onChanged: () => void
  /** A run's time was up and it was recorded (show the notification). */
  onFinished: (finished: FocusFinished) => void
  wallNow?: () => number
  /** A clock that the system time does not move (performance.now in the main process). */
  monoNow?: () => number
  tickMs?: number
}

/**
 * Drives the focus timer in the main process, so it keeps going while every window is closed or
 * hidden. Nothing here counts time: the store derives it from timestamps. The tick only notices
 * (a) that a run's time is up, recording it once, and (b) that the system time was changed, in which
 * case the running stretch is re-based so the change neither adds nor removes focus time.
 */
export class FocusService {
  private timer: ReturnType<typeof setInterval> | null = null
  private last: ClockSample | null = null
  private slept = false
  private stopped = false
  /** The tick being run; a tick asked for meanwhile waits for it instead of running twice. */
  private inFlight: Promise<void> | null = null
  private readonly wallNow: () => number
  private readonly monoNow: () => number

  constructor(private readonly options: FocusServiceOptions) {
    this.wallNow = options.wallNow ?? Date.now
    this.monoNow = options.monoNow ?? (() => performance.now())
  }

  /** Records a run that ran out while the app was closed, then follows the timer. */
  async start(): Promise<void> {
    await this.check()
    this.sync()
  }

  /** Call after every change made through IPC: starts or stops the tick as needed. */
  sync(): void {
    const running = this.options.store.running && !this.stopped
    if (running && !this.timer) {
      this.last = this.sample()
      this.timer = setInterval(() => void this.check(), this.options.tickMs ?? 500)
    } else if (!running && this.timer) {
      clearInterval(this.timer)
      this.timer = null
      this.last = null
    }
  }

  /** The PC is going to sleep: the monotonic clock is not trusted across it. */
  noteSuspend(): void {
    this.slept = true
  }

  /** Back from sleep (or the screen was unlocked): check at once instead of waiting for a tick. */
  noteResume(): Promise<void> {
    this.slept = true
    return this.check()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One tick; also run by tests. */
  check(): Promise<void> {
    this.inFlight ??= this.tick().finally(() => {
      this.inFlight = null
      this.sync()
    })
    return this.inFlight
  }

  private async tick(): Promise<void> {
    try {
      const store = this.options.store
      const next = this.sample()
      if (this.last && store.running) {
        const credit = clockJumpCredit(this.last, next, this.slept)
        if (credit !== null && (await store.reanchor(credit))) {
          console.info('[Focus] System time changed; running timer re-based')
          this.options.onChanged()
        }
      }
      this.last = next
      this.slept = false
      const finished = await store.finishDue()
      if (finished) {
        this.options.onChanged()
        this.options.onFinished(finished)
      }
    } catch (error) {
      console.error('[Focus] Tick failed', error)
    }
  }

  private sample(): ClockSample {
    return { wall: this.wallNow(), mono: this.monoNow() }
  }
}
