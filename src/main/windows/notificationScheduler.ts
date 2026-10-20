import type { AchievementPayload } from '../../shared/types'

/**
 * `preview`: a theme preview or the "Test achievement" button.
 * `achievement`: a real task completion.
 * `summary`: the one summary after a burst of quick completions (see `completionBurst.ts`).
 */
export type NotificationKind = 'preview' | 'achievement' | 'summary'

export interface NotificationRequest {
  kind: NotificationKind
  payload: AchievementPayload
}

/** What the scheduler drives. Kept free of Electron so the rules can be unit tested. */
export interface NotificationPresenter {
  /**
   * Shows the payload, replacing whatever is on screen (card, animation and sound start over).
   * Resolves once it is visible. Shows must reach the screen in the order they were asked for.
   *
   * An async step may finish late (the window's first load can take a while, e.g. on a busy Windows
   * PC); the presenter must check `stillWanted` after it and skip the payload when it is false.
   * A real notification stays wanted even when a newer one arrived in the meantime: they then show
   * one after another, each replacing the one before, so no completion is skipped. Only a superseded
   * preview, or an achievement withdrawn by undo before it showed, is no longer wanted.
   */
  show(payload: AchievementPayload, stillWanted: () => boolean): Promise<void>
  hide(): void
}

export interface SchedulerOptions {
  /** Time after `durationMs` for the renderer's exit animation before hiding. */
  exitAnimationMs: number
}

interface Active {
  request: NotificationRequest
  token: number
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * Decides which notification is on screen. The newest real event always wins; nothing real waits.
 *
 * - Achievement → anything: the new achievement replaces what is on screen at once (its animation,
 *   timer and sound are cancelled) and plays from the start. There is no queue: a quick series of
 *   completions shows each one the moment it happens, and the burst summary settles them afterwards.
 * - Summary → anything: replaces what is on screen at once, like an achievement.
 * - Preview → Preview: the new preview replaces the old one at once.
 * - Preview → Achievement/Summary: the preview interrupts nothing; it waits, and only the latest waiting
 *   preview plays once the real one has finished.
 *
 * Every shown notification gets a token. Timers and async callbacks carry the token and do nothing
 * once it is no longer current, so an old notification can never hide or end a newer one. A real
 * notification superseded while the window was still getting ready is still shown (in order, before
 * the newer one), but only the current one starts the timer.
 */
export class NotificationScheduler {
  private active: Active | null = null
  private waitingPreview: NotificationRequest | null = null
  private nextToken = 0
  /** Real notification ids already accepted (a completion's id): the same one is never shown twice. */
  private readonly seen = new Set<string>()
  /** Achievement ids withdrawn before they were shown. */
  private readonly cancelled = new Set<string>()

  constructor(
    private readonly presenter: NotificationPresenter,
    private readonly options: SchedulerOptions
  ) {}

  enqueue(request: NotificationRequest): void {
    if (request.kind !== 'preview') {
      const id = request.payload.id
      if (this.seen.has(id) || this.cancelled.has(id)) return
      this.seen.add(id)
      this.replaceActive(request)
      return
    }
    const active = this.active
    if (!active || active.request.kind === 'preview') this.replaceActive(request)
    else this.waitingPreview = request
  }

  /**
   * Withdraws an achievement whose completion was undone. One not shown yet never will be; one already
   * on screen is left to finish (pulling it away mid-animation would look broken), and the next
   * completion replaces it anyway. Returns true when the withdrawn achievement is the one on screen.
   */
  cancel(id: string): boolean {
    this.cancelled.add(id)
    return this.active?.request.payload.id === id
  }

  /**
   * Ends the notification `id` at once when it is the one on screen (its timer is cancelled and the
   * window hides), e.g. a habit card whose feedback was replaced by a newer, lighter one elsewhere.
   * A preview waiting behind it plays next. Anything else on screen is left alone. Returns whether it
   * was on screen.
   */
  dismiss(id: string): boolean {
    const active = this.active
    if (!active || active.request.payload.id !== id) return false
    this.finish(active.token)
    return true
  }

  /** For tests and diagnostics. */
  get snapshot(): { active: NotificationRequest | null; waitingPreview: NotificationRequest | null } {
    return { active: this.active?.request ?? null, waitingPreview: this.waitingPreview }
  }

  /** For tests and diagnostics. */
  get pendingCount(): number {
    return (this.waitingPreview ? 1 : 0) + (this.active ? 1 : 0)
  }

  destroy(): void {
    this.cancelActive()
    this.waitingPreview = null
  }

  private replaceActive(request: NotificationRequest): void {
    // No hide in between: the next show replaces the card, sound and animation in place.
    this.cancelActive()
    this.start(request)
  }

  private cancelActive(): void {
    if (this.active?.timer) clearTimeout(this.active.timer)
    this.active = null
  }

  private start(request: NotificationRequest): void {
    const token = ++this.nextToken
    const active: Active = { request, token, timer: null }
    this.active = active
    const isCurrent = (): boolean => this.active?.token === token
    const id = request.payload.id
    const stillWanted = request.kind === 'preview' ? isCurrent : (): boolean => !this.cancelled.has(id)

    this.presenter.show(request.payload, stillWanted).then(
      () => {
        if (!isCurrent()) return
        active.timer = setTimeout(
          () => this.finish(token),
          request.payload.style.durationMs + this.options.exitAnimationMs
        )
      },
      (error: unknown) => {
        console.error('[Notification] Failed to show achievement', error)
        this.finish(token)
      }
    )
  }

  private finish(token: number): void {
    if (this.active?.token !== token) return
    this.cancelActive()
    this.presenter.hide()
    const preview = this.waitingPreview
    this.waitingPreview = null
    if (preview) this.start(preview)
  }
}
