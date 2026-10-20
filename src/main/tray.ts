import { Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import trayIco from './assets/tray/tray.ico?asset'
import tray1x from './assets/tray/tray.png?asset'
import tray125 from './assets/tray/tray@1.25x.png?asset'
import tray15 from './assets/tray/tray@1.5x.png?asset'
import tray2x from './assets/tray/tray@2x.png?asset'
import tray3x from './assets/tray/tray@3x.png?asset'
import { clickMenuItem, type TrayMenuItem } from './trayMenu'

/** Turns a menu description into Electron's template (the tray and the widget's right-click menu). */
export function toTemplate(items: TrayMenuItem[]): MenuItemConstructorOptions[] {
  return items.map(({ id, label, type, checked, enabled, click, submenu }) => ({
    id,
    label,
    type,
    checked,
    enabled,
    click: click && (() => click()),
    submenu: submenu && toTemplate(submenu)
  }))
}

function loadIcon(): NativeImage {
  // Windows picks the right size from the .ico for the current DPI.
  if (process.platform === 'win32') return nativeImage.createFromPath(trayIco)
  const image = nativeImage.createEmpty()
  for (const [scaleFactor, file] of [
    [1, tray1x],
    [1.25, tray125],
    [1.5, tray15],
    [2, tray2x],
    [3, tray3x]
  ] as const) {
    image.addRepresentation({ scaleFactor, buffer: nativeImage.createFromPath(file).toPNG() })
  }
  return image
}

/**
 * The single tray icon. `create` is idempotent, so a repeated call (e.g. a
 * second bootstrap in development) never adds a second icon.
 */
export class TrayController {
  private tray: Tray | null = null
  private items: TrayMenuItem[] = []

  constructor(private readonly onClick: () => void) {}

  create(tooltip: string): void {
    if (this.tray && !this.tray.isDestroyed()) return
    const tray = new Tray(loadIcon())
    tray.setToolTip(tooltip)
    // Windows: left click opens the app, right click shows the menu set below. macOS: a click on the
    // menu bar icon opens the menu (its first entry opens the app); opening the window as well would
    // pull focus away from the menu.
    if (process.platform !== 'darwin') tray.on('click', () => this.onClick())
    this.tray = tray
  }

  setMenu(items: TrayMenuItem[]): void {
    this.items = items
    if (!this.tray || this.tray.isDestroyed()) return
    this.tray.setContextMenu(Menu.buildFromTemplate(toTemplate(items)))
  }

  /** Windows shows this as a notification from the tray icon. */
  showHint(title: string, content: string): boolean {
    if (!this.tray || this.tray.isDestroyed() || process.platform !== 'win32') return false
    this.tray.displayBalloon({ title, content, iconType: 'info' })
    return true
  }

  destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy()
    this.tray = null
  }

  /** For tests: clicks a menu entry (searched in submenus too), as the user would. Returns false if absent or disabled. */
  clickItem(id: string): boolean {
    return clickMenuItem(this.items, id)
  }

  /** For tests: behaves like a left click on the icon (Windows: opens the app). */
  click(): void {
    if (process.platform === 'darwin') this.onClick()
    else this.tray?.emit('click')
  }

  /** For tests and diagnostics. */
  get state(): { exists: boolean; items: TrayMenuItem[] } {
    return { exists: !!this.tray && !this.tray.isDestroyed(), items: this.items }
  }
}
