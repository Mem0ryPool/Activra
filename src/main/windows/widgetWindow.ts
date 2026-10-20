import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, Menu, screen } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type { WidgetSettings } from '../../shared/types'
import { WIDGET_ANIMATION_MS } from '../../shared/widget'
import { readJson, writeJsonAtomic } from '../storage/jsonFile'
import { loadRendererPage, preloadPath } from '../paths'
import { toTemplate } from '../tray'
import { clickMenuItem, type TrayMenuItem } from '../trayMenu'
import { parseSavedRect, resolveWidgetBounds, type Rect } from './windowBounds'

export const WIDGET_SIZE = { width: 320, height: 420 }
const STATE_FILE = 'widget-state.json'

export interface WidgetManagerDeps {
  userDataDir: string
  /** Called when the user closes the widget window itself (its close button or Alt+F4), not on app quit. */
  onClosedByUser: () => void
  /** The right-click menu, built at the moment it opens (see widgetMenu.ts). */
  contextMenu: () => TrayMenuItem[]
}

/**
 * Owns the desktop task widget window. Whether it is shown, pinned on top and how
 * opaque it is live in Settings; `apply` makes the window match them. Its position
 * is saved in its own file, like the main window's.
 */
export class WidgetManager {
  private window: BrowserWindow | null = null
  private opening: Promise<void> | null = null
  private quitting = false
  /** Windows being closed because the setting was turned off, as opposed to by the user. */
  private readonly closedBySettings = new WeakSet<BrowserWindow>()
  private saveTimer: NodeJS.Timeout | undefined
  private readonly stateFile: string
  /** The right-click menu last opened, and how many times one opened (for tests and diagnostics). */
  private menu: { items: TrayMenuItem[]; native: Menu } | null = null
  private menusShown = 0

  constructor(private readonly deps: WidgetManagerDeps) {
    this.stateFile = path.join(deps.userDataDir, STATE_FILE)
  }

  /** For tests and diagnostics. */
  get isOpen(): boolean {
    return !!this.window && !this.window.isDestroyed()
  }

  async apply(settings: WidgetSettings): Promise<void> {
    if (this.quitting) return
    if (!settings.visible) {
      await this.opening
      this.closeWindow(WIDGET_ANIMATION_MS[settings.animation])
      return
    }
    if (!this.isOpen) {
      this.opening ??= this.open(settings).finally(() => {
        this.opening = null
      })
      await this.opening
    }
    const window = this.window
    if (!window || window.isDestroyed()) return
    // 'floating' keeps it above normal windows but below the achievement toast ('screen-saver').
    window.setAlwaysOnTop(settings.alwaysOnTop, 'floating')
    window.setOpacity(settings.opacity / 100)
  }

  /** For tests and diagnostics: where the widget is, or null when it is closed. */
  get bounds(): Rect | null {
    return this.window && !this.window.isDestroyed() ? this.window.getBounds() : null
  }

  /** After a display change: keeps the widget fully on a connected display, as when it opens. */
  keepOnScreen(): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    const current = window.getBounds()
    const next = resolveWidgetBounds(
      current,
      screen.getAllDisplays().map((d) => d.workArea),
      screen.getPrimaryDisplay().workArea,
      WIDGET_SIZE
    )
    if (next.x !== current.x || next.y !== current.y || next.width !== current.width || next.height !== current.height) {
      window.setBounds(next)
      void this.saveState(window)
    }
  }

  /** Live slider preview; the saved value is applied again by `apply` once the slider is released. */
  previewOpacity(opacity: number): void {
    if (this.window && !this.window.isDestroyed()) this.window.setOpacity(opacity / 100)
  }

  /** For tests and diagnostics: the entries of the right-click menu last opened. */
  get menuState(): { shown: number; items: TrayMenuItem[] } {
    return { shown: this.menusShown, items: this.menu?.items ?? [] }
  }

  /** For tests: clicks an entry of the open right-click menu, as the user would, and closes the menu. */
  clickMenuItem(id: string): boolean {
    const menu = this.menu
    if (!menu) return false
    if (this.window && !this.window.isDestroyed()) menu.native.closePopup(this.window)
    return clickMenuItem(menu.items, id)
  }

  /** Stops the quit sequence from being mistaken for the user closing the widget. */
  prepareQuit(): void {
    this.quitting = true
  }

  private closeWindow(exitMs: number): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    // Forget it right away, so turning the widget back on at once opens a fresh window.
    this.window = null
    this.closedBySettings.add(window)
    if (exitMs <= 0 || !window.isVisible()) {
      window.close()
      return
    }
    // Let the page play its hide transition, then close. The window ignores clicks meanwhile.
    window.setIgnoreMouseEvents(true)
    window.webContents.send(IpcChannels.widgetExit)
    setTimeout(() => {
      if (!window.isDestroyed()) window.close()
    }, exitMs + 40)
  }

  private async open(settings: WidgetSettings): Promise<void> {
    const saved = await readJson(this.stateFile).then((r) => (r.kind === 'ok' ? parseSavedRect(r.value) : null))
    const bounds = resolveWidgetBounds(
      saved,
      screen.getAllDisplays().map((d) => d.workArea),
      screen.getPrimaryDisplay().workArea,
      WIDGET_SIZE
    )
    const window = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      // The page paints its own rounded, semi-transparent dark panel.
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      // Transparent frameless windows cannot be resized reliably on Windows, so the size is fixed.
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: settings.alwaysOnTop,
      opacity: settings.opacity / 100,
      autoHideMenuBar: true,
      title: 'Activra Widget',
      webPreferences: {
        preload: preloadPath('widget'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    })
    window.removeMenu()
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('context-menu', () => this.showContextMenu(window))
    // Right-clicking the drag handle would open Windows' own Move/Close menu; show the same menu there.
    window.on('system-context-menu', (event) => {
      event.preventDefault()
      this.showContextMenu(window)
    })

    window.on('move', () => {
      clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => void this.saveState(window), 500)
    })
    window.on('close', () => {
      clearTimeout(this.saveTimer)
      // Synchronous so the position is on disk even if the app quits right after.
      try {
        writeFileSync(this.stateFile, JSON.stringify(window.getBounds()), 'utf8')
      } catch (error) {
        console.error('[Widget] Save state failed', error)
      }
      if (this.quitting || this.closedBySettings.has(window)) return
      // Saving visible: false comes back through apply(); the window is already on its way out.
      if (this.window === window) this.window = null
      this.deps.onClosedByUser()
    })
    window.on('closed', () => {
      if (this.window === window) this.window = null
    })

    this.window = window
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.showInactive()
    })
    window.on('show', () => window.webContents.send(IpcChannels.widgetEnter))
    await loadRendererPage(window, 'widget')
  }

  private showContextMenu(window: BrowserWindow): void {
    if (window.isDestroyed()) return
    const items = this.deps.contextMenu()
    const native = Menu.buildFromTemplate(toTemplate(items))
    this.menu = { items, native }
    this.menusShown += 1
    native.popup({ window })
  }

  private saveState(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed()) return Promise.resolve()
    const bounds: Rect = window.getBounds()
    return writeJsonAtomic(this.stateFile, bounds).catch((error) => console.error('[Widget] Save state failed', error))
  }
}
