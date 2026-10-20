/**
 * Completion burst session: the round of completions made in quick succession. Every completion
 * (main window, widget or tray) adds to it and restarts the idle timer; once nothing new has been
 * completed for `idleMs`, the round ends. A round of two or more completions is settled with one
 * summary; a single completion needs none (its own notification said it all).
 *
 * The session only decides what to announce. Completion records live in the data file and are never
 * touched here, so quitting mid-round (or a crash) loses nothing but the summary.
 */

export const BURST_IDLE_MS = 2000

export interface BurstEntry {
  /** The completion record's id: a completion counts once, and an undo removes exactly it. */
  eventId: string
  /** The achievement's name (the task title at the time). */
  name: string
}

export interface BurstTimers {
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const realTimers: BurstTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export class CompletionBurst {
  private entries: BurstEntry[] = []
  /** Every id ever added, so a repeated report of one completion is never counted twice. */
  private readonly known = new Set<string>()
  private timer: unknown = null

  constructor(
    /** Called once per finished round of at least two completions, in completion order. */
    private readonly onSettle: (entries: BurstEntry[]) => void,
    private readonly idleMs = BURST_IDLE_MS,
    private readonly timers: BurstTimers = realTimers
  ) {}

  /** A new completion: joins the round and restarts the idle timer. */
  add(entry: BurstEntry): void {
    if (this.known.has(entry.eventId)) return
    this.known.add(entry.eventId)
    this.entries.push(entry)
    this.restartTimer()
  }

  /**
   * An undone completion leaves the round (it is not counted in the summary). An undo is not a new
   * completion, so the idle timer keeps running; a round left with no completions simply ends.
   */
  remove(eventId: string): void {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.eventId !== eventId)
    if (before !== this.entries.length && this.entries.length === 0) this.stopTimer()
  }

  /** Completions in the current round (for tests and diagnostics). */
  get current(): BurstEntry[] {
    return [...this.entries]
  }

  /** Ends the session without a summary (app quitting). */
  destroy(): void {
    this.stopTimer()
    this.entries = []
  }

  private restartTimer(): void {
    this.stopTimer()
    this.timer = this.timers.setTimeout(() => this.settle(), this.idleMs)
  }

  private stopTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
  }

  private settle(): void {
    this.timer = null
    const round = this.entries
    // A completion after this point starts a new round: nothing is counted twice or left out.
    this.entries = []
    if (round.length >= 2) this.onSettle(round)
  }
}

/** The summary's text: how many, and the names of the achievements unlocked (first few, then "and N more"). */
export function summaryText(
  entries: readonly BurstEntry[],
  t: (key: 'achievement.summary.heading' | 'achievement.summary.more', params: Record<string, string | number>) => string,
  separator: string,
  shown = 3
): { heading: string; names: string } {
  const names = entries.slice(0, shown).map((e) => e.name)
  const rest = entries.length - names.length
  const list = names.join(separator)
  return {
    heading: t('achievement.summary.heading', { count: entries.length }),
    names: rest > 0 ? t('achievement.summary.more', { names: list, count: rest }) : list
  }
}
