import { BrowserWindow, screen } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type { AchievementPayload } from '../../shared/types'
import { loadRendererPage, preloadPath } from '../paths'
import { NotificationScheduler, type NotificationRequest } from './notificationScheduler'
import { cornerIn } from './windowBounds'

// The window is larger than the visible card: the transparent border leaves room
// for glow and particles. It ignores the mouse, so the extra area never blocks clicks.
const WIDTH = 460
const HEIGHT = 180
const MARGIN = 0
/** Time the renderer needs to play its exit animation before the window hides. */
const EXIT_ANIMATION_MS = 400
/** How many shown notifications the diagnostics log keeps. */
const HISTORY_LIMIT = 200
/** If the page never says it is listening (it crashed), show anyway after this long instead of never. */
const READY_FALLBACK_MS = 5000

export interface NotificationManagerOptions {
  /** Tests only: extra time before the window counts as ready, to simulate a slow first load. */
  readyDelayMs?: number
}

/** One notification that reached the screen (for tests and diagnostics). */
export interface ShownNotification {
  id: string
  kind: NotificationRequest['kind']
  heading: string
  taskTitle: string
  variant: AchievementPayload['variant'] | null
}

/**
 * Shows achievement toasts in their own always-on-top window. Which toast is on
 * screen is decided by `NotificationScheduler`; this class only drives the window.
 * The window never takes focus and ignores the mouse, so it cannot steal
 * keyboard input or block clicks, and it never touches the main window.
 */
export class NotificationManager {
  private window: BrowserWindow | null = null
  private ready: Promise<void> | null = null
  private readonly shown: ShownNotification[] = []
  private readonly scheduler = new NotificationScheduler(
    {
      show: (payload, stillWanted) => this.show(payload, stillWanted),
      hide: () => {
        if (!this.window || this.window.isDestroyed()) return
        // The page drops its card and stops its sound too, so a card ended early never sounds on hidden.
        this.window.webContents.send(IpcChannels.notificationClear)
        this.window.hide()
      }
    },
    { exitAnimationMs: EXIT_ANIMATION_MS }
  )
  /** Kind of each payload id, so the log can say what was shown. */
  private readonly kinds = new Map<string, NotificationRequest['kind']>()

  constructor(private readonly options: NotificationManagerOptions = {}) {}

  enqueue(request: NotificationRequest): void {
    this.kinds.set(request.payload.id, request.kind)
    // Superseded before they showed: forget the oldest so the map stays small.
    if (this.kinds.size > HISTORY_LIMIT) this.kinds.delete(this.kinds.keys().next().value as string)
    this.scheduler.enqueue(request)
  }

  cancel(id: string): boolean {
    return this.scheduler.cancel(id)
  }

  /** Ends notification `id` at once if it is on screen (see `NotificationScheduler.dismiss`). */
  dismiss(id: string): boolean {
    return this.scheduler.dismiss(id)
  }

  /**
   * For tests and diagnostics: the notification on screen, a theme preview waiting for it to finish,
   * and every notification that reached the screen, oldest first.
   */
  get state(): { active: string | null; waitingPreview: string | null; shown: ShownNotification[] } {
    const { active, waitingPreview } = this.scheduler.snapshot
    return {
      active: active?.payload.id ?? null,
      waitingPreview: waitingPreview?.payload.id ?? null,
      shown: [...this.shown]
    }
  }

  /** For tests and diagnostics. */
  get pendingCount(): number {
    return this.scheduler.pendingCount
  }

  /**
   * Loads the (hidden) window ahead of the first achievement, so the first completion shows at once
   * instead of after a page load, during which a second quick completion would already replace it.
   */
  prepare(): void {
    this.ensureWindow().catch((error: unknown) => console.warn('[Notification] Could not prepare window', error))
  }

  destroy(): void {
    this.scheduler.destroy()
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  private async show(payload: AchievementPayload, stillWanted: () => boolean): Promise<void> {
    // Every show waits on the same readiness promise, so they resume in the order they were asked for:
    // completions made while the window was loading each still reach the screen, ending on the newest.
    const window = await this.ensureWindow()
    if (!stillWanted() || window.isDestroyed()) return
    this.position(window, payload)
    window.webContents.send(IpcChannels.notificationShow, payload)
    this.shown.push({
      id: payload.id,
      kind: this.kinds.get(payload.id) ?? 'preview',
      heading: payload.heading,
      taskTitle: payload.taskTitle,
      variant: payload.variant ?? null
    })
    this.kinds.delete(payload.id)
    if (this.shown.length > HISTORY_LIMIT) this.shown.shift()
    window.showInactive()
    window.setAlwaysOnTop(true, 'screen-saver')
  }

  private position(window: BrowserWindow, payload: AchievementPayload): void {
    // Show on the display the user is working on (where the cursor is).
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    window.setBounds(cornerIn(display.workArea, WIDTH, HEIGHT, MARGIN, payload.style.position))
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed() && this.ready) {
      await this.ready
      return this.window
    }
    const window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      title: 'Achievement Unlocked',
      webPreferences: {
        preload: preloadPath('notification'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    window.setIgnoreMouseEvents(true)
    if (process.platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.on('closed', () => {
      if (this.window === window) {
        this.window = null
        this.ready = null
      }
    })
    this.window = window
    this.ready = this.load(window)
    await this.ready
    return window
  }

  /** Resolves once the page is loaded and listening, so the first payload sent is not lost. */
  private async load(window: BrowserWindow): Promise<void> {
    let fallback: ReturnType<typeof setTimeout> | null = null
    const listening = new Promise<void>((resolve) => {
      window.webContents.ipc.once(IpcChannels.notificationReady, () => resolve())
      fallback = setTimeout(() => {
        console.warn('[Notification] Window did not report ready; showing anyway')
        resolve()
      }, READY_FALLBACK_MS)
    })
    try {
      await Promise.all([loadRendererPage(window, 'notification'), listening])
    } finally {
      if (fallback) clearTimeout(fallback)
    }
    const delay = this.options.readyDelayMs ?? 0
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
  }
}
