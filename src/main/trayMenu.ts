import type { Translate } from '../shared/i18n'
import type { Settings } from '../shared/types'

/** How many of today's tasks the "Quick complete task" submenu lists; the rest stay in the app. */
export const QUICK_COMPLETE_LIMIT = 12

/** One of today's tasks still to do (a one-off task, or today's occurrence of a repeating one). */
export interface QuickCompleteItem {
  taskId: string
  /** Today's date for a repeating task's occurrence; null for a one-off task. */
  occurrence: string | null
  title: string
}

/** What each tray menu entry does; wired to real actions in tray.ts. */
export interface TrayActions {
  openMain: () => void
  setWidgetVisible: (visible: boolean) => void
  setWidgetAlwaysOnTop: (onTop: boolean) => void
  quickAddTask: () => void
  /** Completes a task exactly as the main window or widget would (same record, achievement and undo). */
  completeTask: (taskId: string, occurrence: string | null) => void
  openSettings: () => void
  quit: () => void
}

export interface TrayMenuItem {
  id: string
  label?: string
  type?: 'normal' | 'checkbox' | 'separator' | 'submenu'
  checked?: boolean
  enabled?: boolean
  click?: () => void
  submenu?: TrayMenuItem[]
}

/** Windows menus read "&" as a keyboard shortcut marker; a task title must show it as typed. macOS shows "&" as is. */
export function escapeMenuLabel(label: string, platform: string = process.platform): string {
  return platform === 'darwin' ? label : label.replace(/&/g, '&&')
}

/** For tests: clicks a menu entry (searched in submenus too), as the user would. Returns false if absent or disabled. */
export function clickMenuItem(items: readonly TrayMenuItem[], id: string): boolean {
  const find = (list: readonly TrayMenuItem[]): TrayMenuItem | undefined => {
    for (const item of list) {
      if (item.id === id) return item
      const inner = item.submenu && find(item.submenu)
      if (inner) return inner
    }
    return undefined
  }
  const item = find(items)
  if (!item?.click || item.enabled === false) return false
  item.click()
  return true
}

/**
 * The "Quick complete task" submenu, shared by the tray and the widget's right-click menu: today's
 * tasks still to do (at most QUICK_COMPLETE_LIMIT), a disabled line when there are none.
 */
export function quickCompleteMenu(
  items: readonly QuickCompleteItem[],
  t: Translate,
  actions: Pick<TrayActions, 'completeTask' | 'openMain'>
): TrayMenuItem[] {
  if (items.length === 0) return [{ id: 'quick-complete-empty', label: t('tray.quickComplete.empty'), enabled: false }]
  const shown = items.slice(0, QUICK_COMPLETE_LIMIT)
  const menu: TrayMenuItem[] = shown.map((item) => ({
    id: `quick-complete:${item.taskId}${item.occurrence ? `@${item.occurrence}` : ''}`,
    label: escapeMenuLabel(item.title),
    click: () => actions.completeTask(item.taskId, item.occurrence)
  }))
  const rest = items.length - shown.length
  if (rest > 0) {
    menu.push(
      { id: 'quick-complete-separator', type: 'separator' },
      { id: 'quick-complete-more', label: t('tray.quickComplete.more', { count: rest }), click: actions.openMain }
    )
  }
  return menu
}

/**
 * The tray's right-click menu. Kept free of Electron so it can be unit-tested.
 * `today` is what is still to do today, in the order the Today list shows it.
 */
export function buildTrayMenu(
  settings: Settings,
  t: Translate,
  actions: TrayActions,
  today: readonly QuickCompleteItem[] = []
): TrayMenuItem[] {
  const { visible, alwaysOnTop } = settings.widget
  return [
    { id: 'open', label: t('tray.open'), click: actions.openMain },
    { id: 'separator-1', type: 'separator' },
    {
      id: 'widget',
      label: t('tray.widget'),
      type: 'checkbox',
      checked: visible,
      click: () => actions.setWidgetVisible(!visible)
    },
    {
      id: 'always-on-top',
      label: t('tray.alwaysOnTop'),
      type: 'checkbox',
      checked: alwaysOnTop,
      click: () => actions.setWidgetAlwaysOnTop(!alwaysOnTop)
    },
    { id: 'separator-2', type: 'separator' },
    { id: 'quick-add', label: t('tray.quickAdd'), click: actions.quickAddTask },
    {
      id: 'quick-complete',
      label: t('tray.quickComplete'),
      type: 'submenu',
      submenu: quickCompleteMenu(today, t, actions)
    },
    { id: 'settings', label: t('tray.settings'), click: actions.openSettings },
    { id: 'separator-3', type: 'separator' },
    { id: 'quit', label: t('tray.quit'), click: actions.quit }
  ]
}
