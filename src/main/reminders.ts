import path from 'node:path'
import { Notification, powerMonitor } from 'electron'
import { createTranslator, type Translate } from '../shared/i18n'
import { dayKey } from '../shared/dates'
import { splitOverdue } from '../shared/deadline'
import { addDays } from '../shared/recurrence'
import type { CompletionEvent, Locale, Settings, Task } from '../shared/types'
import { decideReminders, remindersDue, staleShown, type DueReminder } from './reminderPlanner'
import { readJson, writeJsonAtomic } from './storage/jsonFile'

const STATE_FILE = 'reminder-state.json'
/** Short and repeated, instead of one long timer that sleep or a clock change would throw off. */
const TICK_MS = 20_000
/** Handled reminders are remembered this long, then forgotten (their deadlines are long past). */
const KEEP_MS = 30 * 24 * 3600 * 1000
/**
 * Shown notifications stay referenced (so a click from the Windows notification center still
 * reaches us, and they can be withdrawn) up to this many; the oldest is let go first.
 */
const MAX_LIVE = 20

type Outcome = 'sent' | 'summary' | 'skipped'

interface Handled {
  at: string
  outcome: Outcome
}

export interface ShownReminder {
  keys: string[]
  title: string
  body: string
  silent: boolean
  taskId: string | null
}

export interface ReminderServiceDeps {
  userDataDir: string
  getTasks: () => { tasks: Task[]; completions: CompletionEvent[] }
  getSettings: () => Settings
  getLocale: () => Locale
  /** Clicking a reminder: open the main window on that task (null for a summary). */
  onClick: (taskId: string | null) => void
  /** Test hook: every notification the service decided to show. */
  onShown?: (reminder: ShownReminder) => void
  /** Test hook: a shown notification was withdrawn because its task no longer needs it. */
  onWithdrawn?: (keys: string[]) => void
  now?: () => number
}

/**
 * Deadline reminders as native notifications (Windows toasts), separate from the achievement
 * toast. What is due is decided by `reminderPlanner.ts`; this class runs it, remembers what was
 * sent in `reminder-state.json` (so nothing is sent twice, also across restarts) and shows it.
 */
export class ReminderService {
  private handled = new Map<string, Handled>()
  private timer: NodeJS.Timeout | null = null
  private pending: NodeJS.Timeout | null = null
  private running: Promise<void> = Promise.resolve()
  /** Kept referenced, or Windows drops the click handler once the object is collected. Oldest first. */
  private readonly live = new Map<Notification, string[]>()
  private readonly stateFile: string
  private readonly now: () => number

  constructor(private readonly deps: ReminderServiceDeps) {
    this.stateFile = path.join(deps.userDataDir, STATE_FILE)
    this.now = deps.now ?? Date.now
  }

  async start(): Promise<void> {
    const saved = await readJson(this.stateFile).catch(() => ({ kind: 'missing' as const }))
    if (saved.kind === 'ok' && typeof saved.value === 'object' && saved.value !== null) {
      const entries = (saved.value as { handled?: Record<string, Handled> }).handled ?? {}
      for (const [key, value] of Object.entries(entries)) {
        if (value && typeof value.at === 'string') this.handled.set(key, { at: value.at, outcome: value.outcome })
      }
    }
    this.prune()
    this.timer = setInterval(() => this.check(), TICK_MS)
    // After sleep or a locked screen, look again right away instead of waiting for the next tick.
    powerMonitor.on('resume', () => this.check())
    powerMonitor.on('unlock-screen', () => this.check())
    this.check()
  }

  /** Re-evaluate soon (after tasks or settings changed). Calls close together run once. */
  schedule(): void {
    if (this.pending) return
    this.pending = setTimeout(() => {
      this.pending = null
      this.check()
    }, 300)
  }

  /** Runs one evaluation now; resolves when it is done. Evaluations never overlap. */
  check(): Promise<void> {
    this.running = this.running
      .then(() => this.evaluate())
      .catch((error) => console.error('[Reminders] Check failed', error))
    return this.running
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.pending) clearTimeout(this.pending)
    this.timer = null
    this.pending = null
  }

  private async evaluate(): Promise<void> {
    const settings = this.deps.getSettings()
    const now = this.now()
    const { tasks, completions } = this.deps.getTasks()
    const due = remindersDue(tasks, completions, settings.reminders, now)
    this.withdrawStale(new Set(due.map((r) => r.key)))
    if (!settings.reminders.enabled) return
    const decision = decideReminders(due, (key) => this.handled.has(key), now)
    const all = [...decision.send, ...decision.summary, ...decision.skip]
    if (all.length === 0) return

    // Recorded and saved before anything is shown: a reminder is sent at most once.
    const at = new Date(now).toISOString()
    for (const r of decision.send) this.handled.set(r.key, { at, outcome: 'sent' })
    for (const r of decision.summary) this.handled.set(r.key, { at, outcome: 'summary' })
    for (const r of decision.skip) this.handled.set(r.key, { at, outcome: 'skipped' })
    await this.save()

    const t = createTranslator(this.deps.getLocale())
    const silent = !settings.reminders.sound
    for (const r of decision.send) {
      this.show({ keys: [r.key], title: r.title, body: this.describe(r, t, now), silent, taskId: r.taskId })
    }
    if (decision.summary.length > 0) {
      const titles = decision.summary.map((r) => r.title)
      this.show({
        keys: decision.summary.map((r) => r.key),
        title: t('reminder.summary.title', { count: titles.length }),
        body: titles.slice(0, 4).join(' · ') + (titles.length > 4 ? ' …' : ''),
        silent,
        taskId: null
      })
    }
  }

  /** "Due today at 18:00", "Due tomorrow", "Overdue by 20 min (was due 18:00)". */
  private describe(r: DueReminder, t: Translate, now: number): string {
    const locale = this.deps.getLocale()
    const today = dayKey(new Date(now))
    const [y, m, d] = r.date.split('-').map(Number) as [number, number, number]
    const day =
      r.date === today
        ? t('due.today')
        : r.date === addDays(today, 1)
          ? t('due.tomorrow')
          : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short' }).format(
              new Date(y, m - 1, d)
            )
    const when = r.time ? `${day} ${r.time}` : day
    if (now >= r.overdueAt) {
      const { days, hours, minutes } = splitOverdue(now - r.overdueAt)
      const span =
        days > 0
          ? t('due.span.days', { n: days })
          : hours > 0
            ? t('due.span.hours', { n: hours })
            : t('due.span.minutes', { n: minutes })
      return t('reminder.body.overdue', { span, when })
    }
    return t('reminder.body.due', { when })
  }

  /**
   * Takes back notifications that no longer apply: the task was completed, deleted, or its deadline
   * or reminder changed (which gives the reminder a new key). A summary goes once none of its tasks
   * still needs it.
   */
  private withdrawStale(dueKeys: ReadonlySet<string>): void {
    for (const notification of staleShown(this.live, dueKeys)) {
      const keys = this.live.get(notification) ?? []
      this.live.delete(notification)
      this.deps.onWithdrawn?.(keys)
      try {
        notification.close()
      } catch (error) {
        console.error('[Reminders] Could not withdraw notification', error)
      }
    }
  }

  private show(reminder: ShownReminder): void {
    this.deps.onShown?.(reminder)
    if (!Notification.isSupported()) return
    try {
      const notification = new Notification({ title: reminder.title, body: reminder.body, silent: reminder.silent })
      this.live.set(notification, reminder.keys)
      while (this.live.size > MAX_LIVE) this.live.delete(this.live.keys().next().value as Notification)
      const release = (): void => void this.live.delete(notification)
      notification.on('click', () => {
        release()
        this.deps.onClick(reminder.taskId)
      })
      // 'close' also fires when Windows moves the toast into the notification center, where it can
      // still be clicked, so the object stays referenced until clicked, withdrawn or pushed out.
      notification.on('failed', (_e, error) => {
        release()
        console.error('[Reminders] Notification failed', error)
      })
      notification.show()
    } catch (error) {
      console.error('[Reminders] Could not show notification', error)
    }
  }

  private prune(): void {
    const cutoff = this.now() - KEEP_MS
    for (const [key, value] of this.handled) if (Date.parse(value.at) < cutoff) this.handled.delete(key)
  }

  private async save(): Promise<void> {
    this.prune()
    try {
      await writeJsonAtomic(this.stateFile, { version: 1, handled: Object.fromEntries(this.handled) })
    } catch (error) {
      // Still remembered in memory for this run, so nothing repeats before a restart.
      console.error('[Reminders] Could not save reminder state', error)
    }
  }
}
