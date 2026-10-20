import type { MenuItemConstructorOptions } from 'electron'
import type { Translate } from '../shared/i18n'

export interface AppMenuActions {
  openSettings: () => void
}

/**
 * The macOS application menu (the menu bar at the top of the screen while Activra is in front).
 * Kept free of Electron's runtime so it can be unit-tested. Windows keeps Electron's default menu,
 * which its hidden title bar never shows.
 *
 * macOS needs it for more than looks: the Edit roles are what make ⌘C / ⌘V / ⌘A / ⌘Z work in text
 * fields, ⌘W closes the window (hides it to the menu bar, per Settings), ⌘M minimizes and ⌘Q quits
 * through the normal quit path (data flushed first). Reload and developer tools exist only in
 * development, so ⌘R can never reload the installed app.
 */
export function buildMacAppMenu(t: Translate, actions: AppMenuActions, development: boolean): MenuItemConstructorOptions[] {
  return [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { id: 'settings', label: t('menu.settings'), accelerator: 'Command+,', click: () => actions.openSettings() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      role: 'viewMenu',
      submenu: [
        ...(development
          ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[])
          : []),
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
}
