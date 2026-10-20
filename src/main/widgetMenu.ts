import type { Translate } from '../shared/i18n'
import { quickCompleteMenu, type QuickCompleteItem, type TrayActions, type TrayMenuItem } from './trayMenu'

/** What the widget's right-click menu can do; wired in index.ts to the same actions as the tray. */
export type WidgetMenuActions = Pick<TrayActions, 'completeTask' | 'openMain'>

/**
 * The desktop widget's right-click menu. Kept free of Electron so it can be unit-tested.
 * Built again on every right click, so `today` is always the current list.
 */
export function buildWidgetMenu(
  t: Translate,
  actions: WidgetMenuActions,
  today: readonly QuickCompleteItem[]
): TrayMenuItem[] {
  return [
    {
      id: 'quick-complete',
      label: t('tray.quickComplete'),
      type: 'submenu',
      submenu: quickCompleteMenu(today, t, actions)
    },
    { id: 'separator-1', type: 'separator' },
    { id: 'open', label: t('tray.open'), click: actions.openMain }
  ]
}
