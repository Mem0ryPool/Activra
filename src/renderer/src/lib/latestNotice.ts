/**
 * One short message at a time, newest wins (Phase 6.6.2). Showing a message replaces the one on
 * screen at once and starts its own full time; the old message's timer is cancelled, and a timer that
 * still fires checks that its message is the current one, so it can never close a newer message.
 * `clear` takes the message away early (e.g. when a card replaced it).
 *
 * Requests are numbered when they start (`begin`), so an answer that arrives after the answer to a
 * newer request does not take the screen back (`isStale`).
 */
export class LatestNotice<T> {
  private seq = 0
  private requests = 0
  private shownRequest = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  current: (T & { id: number }) | null = null

  constructor(
    private readonly onChange: (notice: (T & { id: number }) | null) => void,
    private readonly durationMs: number
  ) {}

  /** Numbers a request whose answer may show a message. */
  begin(): number {
    return ++this.requests
  }

  /** Whether an answer to a newer request already decided what is shown. */
  isStale(request: number): boolean {
    return request < this.shownRequest
  }

  /** Marks that the answer to `request` decided what is shown (a message, a card or nothing). */
  settle(request: number): void {
    this.shownRequest = Math.max(this.shownRequest, request)
  }

  show(value: T): void {
    clearTimeout(this.timer)
    const notice = { ...value, id: ++this.seq }
    this.current = notice
    this.onChange(notice)
    this.timer = setTimeout(() => {
      if (this.current?.id !== notice.id) return
      this.current = null
      this.onChange(null)
    }, this.durationMs)
  }

  clear(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.current === null) return
    this.current = null
    this.onChange(null)
  }
}
