import { describe, expect, it, vi } from 'vitest'
import {
  QUICK_COMPLETE_LIMIT,
  buildTrayMenu,
  escapeMenuLabel,
  type QuickCompleteItem,
  type TrayActions
} from '../../src/main/trayMenu'
import { DEFAULT_SETTINGS } from '../../src/shared/constants'
import { createTranslator } from '../../src/shared/i18n'
import { validateSettingsPatch, ValidationError } from '../../src/shared/validation'
import { withPlatform } from './platform'

function actions(): TrayActions {
  return {
    openMain: vi.fn(),
    setWidgetVisible: vi.fn(),
    setWidgetAlwaysOnTop: vi.fn(),
    quickAddTask: vi.fn(),
    completeTask: vi.fn(),
    openSettings: vi.fn(),
    quit: vi.fn()
  }
}

describe('tray menu', () => {
  it('lists the seven actions in order, in Chinese', () => {
    const menu = buildTrayMenu(DEFAULT_SETTINGS, createTranslator('zh-CN'), actions())
    expect(menu.filter((i) => i.type !== 'separator').map((i) => i.label)).toEqual([
      '打开 Activra',
      '显示桌面小组件',
      '小组件始终置顶',
      '快速添加任务',
      '快速完成任务',
      '设置',
      '退出 Activra'
    ])
  })

  it('reflects and toggles the widget settings', () => {
    const a = actions()
    const settings = { ...DEFAULT_SETTINGS, widget: { ...DEFAULT_SETTINGS.widget, visible: true, alwaysOnTop: false } }
    const menu = buildTrayMenu(settings, createTranslator('en'), a)
    const widget = menu.find((i) => i.id === 'widget')!
    const onTop = menu.find((i) => i.id === 'always-on-top')!
    expect(widget).toMatchObject({ type: 'checkbox', checked: true, label: 'Show desktop widget' })
    expect(onTop).toMatchObject({ type: 'checkbox', checked: false })
    widget.click!()
    onTop.click!()
    expect(a.setWidgetVisible).toHaveBeenCalledWith(false)
    expect(a.setWidgetAlwaysOnTop).toHaveBeenCalledWith(true)
  })

  it('wires the other entries to their actions', () => {
    const a = actions()
    const menu = buildTrayMenu(DEFAULT_SETTINGS, createTranslator('en'), a)
    for (const id of ['open', 'quick-add', 'settings', 'quit']) menu.find((i) => i.id === id)!.click!()
    expect(a.openMain).toHaveBeenCalledOnce()
    expect(a.quickAddTask).toHaveBeenCalledOnce()
    expect(a.openSettings).toHaveBeenCalledOnce()
    expect(a.quit).toHaveBeenCalledOnce()
  })
})

function todo(count: number): QuickCompleteItem[] {
  return Array.from({ length: count }, (_, i) => ({
    taskId: `task-${i}`,
    occurrence: i % 2 ? '2026-10-16' : null,
    title: `Task ${i}`
  }))
}

describe('tray quick complete', () => {
  const submenu = (items: QuickCompleteItem[], a = actions(), locale: 'en' | 'zh-CN' = 'en') =>
    buildTrayMenu(DEFAULT_SETTINGS, createTranslator(locale), a, items).find((i) => i.id === 'quick-complete')!

  it('lists today\'s tasks still to do and completes the one clicked, occurrence included', () => {
    const a = actions()
    const menu = submenu(todo(3), a)
    expect(menu).toMatchObject({ type: 'submenu', label: 'Quick complete task' })
    expect(menu.submenu!.map((i) => i.label)).toEqual(['Task 0', 'Task 1', 'Task 2'])
    menu.submenu![1]!.click!()
    expect(a.completeTask).toHaveBeenCalledExactlyOnceWith('task-1', '2026-10-16')
    menu.submenu![0]!.click!()
    expect(a.completeTask).toHaveBeenLastCalledWith('task-0', null)
  })

  it('shows a disabled line when nothing is left to do today', () => {
    const menu = submenu([], actions(), 'zh-CN')
    expect(menu.label).toBe('快速完成任务')
    expect(menu.submenu).toEqual([{ id: 'quick-complete-empty', label: '今天没有待完成的任务', enabled: false }])
  })

  it('caps the list and points to the app for the rest', () => {
    const a = actions()
    const menu = submenu(todo(QUICK_COMPLETE_LIMIT + 5), a)
    const entries = menu.submenu!.filter((i) => i.id.startsWith('quick-complete:'))
    expect(entries).toHaveLength(QUICK_COMPLETE_LIMIT)
    const more = menu.submenu!.at(-1)!
    expect(more.label).toBe('5 more in the app…')
    more.click!()
    expect(a.openMain).toHaveBeenCalledOnce()
  })

  it('shows "&" in a task title as typed instead of as a Windows shortcut marker', () => {
    expect(escapeMenuLabel('Tom & Jerry && co', 'win32')).toBe('Tom && Jerry &&&& co')
    const menu = withPlatform('win32', () => submenu([{ taskId: 't', occurrence: null, title: 'R&D' }]))
    expect(menu.submenu![0]!.label).toBe('R&&D')
  })

  it('keeps "&" in a task title unchanged on macOS', () => {
    const menu = withPlatform('darwin', () => submenu([{ taskId: 't', occurrence: null, title: 'R&D' }]))
    expect(menu.submenu![0]!.label).toBe('R&D')
  })

  it('gives every entry a distinct id, even for two occurrences of one task title', () => {
    const items = [
      { taskId: 'a', occurrence: null, title: 'Same' },
      { taskId: 'b', occurrence: '2026-10-16', title: 'Same' }
    ]
    const ids = submenu(items).submenu!.map((i) => i.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('close action setting', () => {
  it('defaults to minimizing to the tray and validates its values', () => {
    expect(DEFAULT_SETTINGS.closeAction).toBe('tray')
    expect(validateSettingsPatch({ closeAction: 'quit' })).toEqual({ closeAction: 'quit' })
    expect(() => validateSettingsPatch({ closeAction: 'minimize' })).toThrow(ValidationError)
  })
})
