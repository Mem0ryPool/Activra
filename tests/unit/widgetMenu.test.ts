import { describe, expect, it, vi } from 'vitest'
import { QUICK_COMPLETE_LIMIT, buildTrayMenu, clickMenuItem, type QuickCompleteItem } from '../../src/main/trayMenu'
import { buildWidgetMenu, type WidgetMenuActions } from '../../src/main/widgetMenu'
import { DEFAULT_SETTINGS } from '../../src/shared/constants'
import { createTranslator } from '../../src/shared/i18n'
import { withPlatform } from './platform'

const en = createTranslator('en')
const zh = createTranslator('zh-CN')

function actions(): WidgetMenuActions {
  return { openMain: vi.fn(), completeTask: vi.fn() }
}

const today: QuickCompleteItem[] = [
  { taskId: 'water', occurrence: null, title: 'Drink water · 2/4' },
  { taskId: 'words', occurrence: '2026-10-16', title: 'Learn 20 words' }
]

describe('widget right-click menu', () => {
  it('offers "Quick complete task" and "Open Activra", with the tray\'s labels', () => {
    const menu = buildWidgetMenu(en, actions(), today)
    expect(menu.map((i) => i.type === 'separator' ? '-' : i.label)).toEqual(['Quick complete task', '-', 'Open Activra'])
    expect(buildWidgetMenu(zh, actions(), today).map((i) => i.label)).toEqual([
      zh('tray.quickComplete'),
      undefined,
      zh('tray.open')
    ])
  })

  it('lists today\'s tasks exactly as the tray does', () => {
    const a = actions()
    const widgetSubmenu = buildWidgetMenu(en, a, today)[0]!.submenu!
    const traySubmenu = buildTrayMenu(DEFAULT_SETTINGS, en, { ...a, setWidgetVisible: vi.fn(), setWidgetAlwaysOnTop: vi.fn(), quickAddTask: vi.fn(), openSettings: vi.fn(), quit: vi.fn() }, today)
      .find((i) => i.id === 'quick-complete')!.submenu!
    const shape = (items: typeof widgetSubmenu): unknown[] => items.map(({ id, label, enabled, type }) => ({ id, label, enabled, type }))
    expect(shape(widgetSubmenu)).toEqual(shape(traySubmenu))
    expect(widgetSubmenu.map((i) => i.id)).toEqual(['quick-complete:water', 'quick-complete:words@2026-10-16'])
  })

  it('completes the clicked task through the shared action, with its occurrence', () => {
    const a = actions()
    const menu = buildWidgetMenu(en, a, today)
    expect(clickMenuItem(menu, 'quick-complete:words@2026-10-16')).toBe(true)
    expect(a.completeTask).toHaveBeenCalledExactlyOnceWith('words', '2026-10-16')
    expect(clickMenuItem(menu, 'quick-complete:water')).toBe(true)
    expect(a.completeTask).toHaveBeenLastCalledWith('water', null)
    expect(clickMenuItem(menu, 'open')).toBe(true)
    expect(a.openMain).toHaveBeenCalledOnce()
  })

  it('shows a disabled line when nothing is left to do', () => {
    const a = actions()
    const submenu = buildWidgetMenu(en, a, [])[0]!.submenu!
    expect(submenu).toEqual([{ id: 'quick-complete-empty', label: 'Nothing left to do today', enabled: false }])
    expect(clickMenuItem(submenu, 'quick-complete-empty')).toBe(false)
    expect(a.completeTask).not.toHaveBeenCalled()
  })

  it('keeps long lists short and points to the app for the rest', () => {
    const a = actions()
    const many = Array.from({ length: QUICK_COMPLETE_LIMIT + 3 }, (_, i) => ({ taskId: `t${i}`, occurrence: null, title: `Task ${i}` }))
    const submenu = buildWidgetMenu(en, a, many)[0]!.submenu!
    expect(submenu.filter((i) => i.id.startsWith('quick-complete:'))).toHaveLength(QUICK_COMPLETE_LIMIT)
    expect(submenu.at(-1)).toMatchObject({ id: 'quick-complete-more', label: '3 more in the app…' })
    expect(clickMenuItem(submenu, 'quick-complete-more')).toBe(true)
    expect(a.openMain).toHaveBeenCalledOnce()
  })

  it('shows "&" in a task name as typed (escaped on Windows, unchanged on macOS)', () => {
    const today = [{ taskId: 'a', occurrence: null, title: 'Salt & pepper' }]
    const win = withPlatform('win32', () => buildWidgetMenu(en, actions(), today))[0]!.submenu!
    expect(win[0]!.label).toBe('Salt && pepper')
    const mac = withPlatform('darwin', () => buildWidgetMenu(en, actions(), today))[0]!.submenu!
    expect(mac[0]!.label).toBe('Salt & pepper')
  })
})
