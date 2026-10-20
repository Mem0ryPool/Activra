import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DATA_FILE_NAME, DataStore } from '../../src/main/storage/dataStore'
import { WidgetShortcut, type ShortcutRegistrar } from '../../src/main/widgetShortcut'
import { DEFAULT_SETTINGS } from '../../src/shared/constants'
import {
  acceleratorFromKey,
  DEFAULT_WIDGET_SHORTCUT,
  formatAccelerator,
  isValidAccelerator,
  migrateWidgetShortcut
} from '../../src/shared/shortcut'
import { validateSettingsPatch } from '../../src/shared/validation'

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('widget shortcut text', () => {
  it('accepts modifiers plus one key, and refuses keys without Ctrl/Alt/Win', () => {
    expect(DEFAULT_WIDGET_SHORTCUT).toBe('CommandOrControl+Alt+D')
    expect(isValidAccelerator(DEFAULT_WIDGET_SHORTCUT)).toBe(true)
    expect(isValidAccelerator('CommandOrControl+Shift+F12')).toBe(true)
    // At most 3 keys, modifiers included.
    expect(isValidAccelerator('CommandOrControl+Alt+Shift+F12')).toBe(false)
    expect(isValidAccelerator('W')).toBe(false)
    expect(isValidAccelerator('Shift+W')).toBe(false)
    expect(isValidAccelerator('Alt+Alt+W')).toBe(false)
    expect(isValidAccelerator('Ctrl+W')).toBe(false)
    expect(isValidAccelerator(42)).toBe(false)
  })

  it('records physical keys, portable Ctrl/Cmd, and waits while only modifiers are held', () => {
    expect(acceleratorFromKey(key('KeyW', { ctrlKey: true, altKey: true }), 'win32')).toEqual({ kind: 'ok', accelerator: 'CommandOrControl+Alt+W' })
    expect(acceleratorFromKey(key('KeyW', { metaKey: true, altKey: true }), 'darwin')).toEqual({ kind: 'ok', accelerator: 'CommandOrControl+Alt+W' })
    expect(acceleratorFromKey(key('Digit3', { metaKey: true }), 'win32')).toEqual({ kind: 'ok', accelerator: 'Super+3' })
    expect(acceleratorFromKey(key('ControlLeft', { ctrlKey: true }), 'win32')).toEqual({ kind: 'pending' })
    expect(acceleratorFromKey(key('KeyW', { shiftKey: true }), 'win32')).toEqual({ kind: 'needs-modifier' })
    expect(acceleratorFromKey(key('KeyD', { ctrlKey: true, altKey: true, shiftKey: true }), 'win32')).toEqual({ kind: 'too-many' })
  })

  it('writes the keys the way each system does', () => {
    expect(formatAccelerator(DEFAULT_WIDGET_SHORTCUT, 'win32')).toBe('Ctrl+Alt+D')
    expect(formatAccelerator(DEFAULT_WIDGET_SHORTCUT, 'darwin')).toBe('⌘⌥D')
    expect(formatAccelerator('Super+Shift+Up', 'win32')).toBe('Win+Shift+↑')
  })

  it('settings accept a valid shortcut or null, nothing else', () => {
    expect(validateSettingsPatch({ widgetShortcut: 'Alt+F5' })).toEqual({ widgetShortcut: 'Alt+F5' })
    expect(validateSettingsPatch({ widgetShortcut: null })).toEqual({ widgetShortcut: null })
    expect(() => validateSettingsPatch({ widgetShortcut: 'W' })).toThrow()
    expect(() => validateSettingsPatch({ widgetShortcut: 'CommandOrControl+Alt+Shift+D' })).toThrow()
  })

  it('moves only the earlier default (Ctrl+Alt+W) to the new one', () => {
    expect(migrateWidgetShortcut('CommandOrControl+Alt+W')).toBe(DEFAULT_WIDGET_SHORTCUT)
    expect(migrateWidgetShortcut('Alt+Shift+Q')).toBe('Alt+Shift+Q')
    expect(migrateWidgetShortcut(null)).toBeNull()
  })
})

function fakeRegistrar(taken: string[] = []): ShortcutRegistrar & { held: Map<string, () => void>; calls: string[] } {
  const held = new Map<string, () => void>()
  const calls: string[] = []
  return {
    held,
    calls,
    register(accelerator, callback) {
      calls.push(`+${accelerator}`)
      if (taken.includes(accelerator)) return false
      if (accelerator === 'Alt+F1') throw new Error('bad accelerator')
      held.set(accelerator, callback)
      return true
    },
    unregister(accelerator) {
      calls.push(`-${accelerator}`)
      held.delete(accelerator)
    }
  }
}

describe('WidgetShortcut', () => {
  it('holds one accelerator, swaps cleanly, and toggles on press', () => {
    const reg = fakeRegistrar()
    let presses = 0
    const statuses: string[] = []
    const shortcut = new WidgetShortcut(reg, () => presses++, (s) => statuses.push(s.state))
    shortcut.apply(DEFAULT_WIDGET_SHORTCUT)
    shortcut.apply(DEFAULT_WIDGET_SHORTCUT)
    expect(reg.calls).toEqual([`+${DEFAULT_WIDGET_SHORTCUT}`])
    reg.held.get(DEFAULT_WIDGET_SHORTCUT)?.()
    expect(presses).toBe(1)
    shortcut.apply('Alt+Shift+Q')
    expect([...reg.held.keys()]).toEqual(['Alt+Shift+Q'])
    expect(shortcut.status).toEqual({ accelerator: 'Alt+Shift+Q', state: 'registered' })
    shortcut.apply(null)
    expect(reg.held.size).toBe(0)
    expect(shortcut.status.state).toBe('off')
    expect(statuses).toEqual(['registered', 'registered', 'off'])
  })

  it('reports a conflict (or a refused accelerator) without throwing', () => {
    const reg = fakeRegistrar([DEFAULT_WIDGET_SHORTCUT])
    const shortcut = new WidgetShortcut(reg, () => {})
    expect(() => shortcut.apply(DEFAULT_WIDGET_SHORTCUT)).not.toThrow()
    expect(shortcut.status).toEqual({ accelerator: DEFAULT_WIDGET_SHORTCUT, state: 'conflict' })
    expect(() => shortcut.apply('Alt+F1')).not.toThrow()
    expect(shortcut.status.state).toBe('conflict')
    shortcut.apply('Alt+F2')
    expect(shortcut.status.state).toBe('registered')
  })

  it('a change to a taken shortcut keeps the working one, also after a recording pause', () => {
    const reg = fakeRegistrar(['Alt+Shift+T'])
    const shortcut = new WidgetShortcut(reg, () => {})
    shortcut.apply(DEFAULT_WIDGET_SHORTCUT)
    expect(shortcut.tryChange('Alt+Shift+T')).toBe('conflict')
    expect(shortcut.status).toEqual({ accelerator: DEFAULT_WIDGET_SHORTCUT, state: 'registered' })
    expect([...reg.held.keys()]).toEqual([DEFAULT_WIDGET_SHORTCUT])
    shortcut.suspend(true)
    expect(shortcut.tryChange('Alt+Shift+T')).toBe('conflict')
    expect(shortcut.status).toEqual({ accelerator: DEFAULT_WIDGET_SHORTCUT, state: 'registered' })
    expect([...reg.held.keys()]).toEqual([DEFAULT_WIDGET_SHORTCUT])
    // A free one: registered first, then the old one is let go.
    reg.calls.length = 0
    expect(shortcut.tryChange('Alt+Shift+Y')).toBe('ok')
    expect(reg.calls).toEqual(['+Alt+Shift+Y', `-${DEFAULT_WIDGET_SHORTCUT}`])
    expect(shortcut.status).toEqual({ accelerator: 'Alt+Shift+Y', state: 'registered' })
    expect(shortcut.tryChange('W')).toBe('invalid')
  })

  it('releases the shortcut while recording and takes it back; dispose releases everything', () => {
    const reg = fakeRegistrar()
    const shortcut = new WidgetShortcut(reg, () => {})
    shortcut.apply(DEFAULT_WIDGET_SHORTCUT)
    shortcut.suspend(true)
    expect(reg.held.size).toBe(0)
    expect(shortcut.status.state).toBe('suspended')
    shortcut.suspend(false)
    expect(reg.held.has(DEFAULT_WIDGET_SHORTCUT)).toBe(true)
    shortcut.dispose()
    expect(reg.held.size).toBe(0)
  })
})

describe('defaults', () => {
  it('new users get 5 s notifications and Ctrl+Alt+D; a saved duration or shortcut choice is kept', async () => {
    expect(DEFAULT_SETTINGS.notificationDurationSec).toBe(5)
    expect(DEFAULT_SETTINGS.widgetShortcut).toBe(DEFAULT_WIDGET_SHORTCUT)
    // Appearance follows the system by default; the widget's own appearance is independent.
    expect(DEFAULT_SETTINGS.appearance).toBe('system')
    expect(DEFAULT_SETTINGS.widget.appearance).toBe('dark')

    const fresh = new DataStore({ directory: await mkdtemp(path.join(tmpdir(), 'lu-defaults-')), platform: 'win32' })
    await fresh.load()
    expect(fresh.getSettings()).toMatchObject({ notificationDurationSec: 5, widgetShortcut: DEFAULT_WIDGET_SHORTCUT })

    const dir = await mkdtemp(path.join(tmpdir(), 'lu-defaults-'))
    await writeFile(
      path.join(dir, DATA_FILE_NAME),
      JSON.stringify({ schemaVersion: 5, tasks: [], completions: [], settings: { notificationDurationSec: 6, widgetShortcut: null } }),
      'utf8'
    )
    const existing = new DataStore({ directory: dir, platform: 'win32' })
    await existing.load()
    expect(existing.getSettings()).toMatchObject({ notificationDurationSec: 6, widgetShortcut: null })

    // A file from before the shortcut existed, or with a broken value: the default applies.
    const old = await mkdtemp(path.join(tmpdir(), 'lu-defaults-'))
    await writeFile(path.join(old, DATA_FILE_NAME), JSON.stringify({ schemaVersion: 5, settings: { notificationDurationSec: 9, widgetShortcut: 'W' } }), 'utf8')
    const older = new DataStore({ directory: old, platform: 'win32' })
    await older.load()
    expect(older.getSettings()).toMatchObject({ notificationDurationSec: 9, widgetShortcut: DEFAULT_WIDGET_SHORTCUT })

    // The earlier default moves to Ctrl+Alt+D; a custom shortcut is kept.
    for (const [saved, expected] of [
      ['CommandOrControl+Alt+W', DEFAULT_WIDGET_SHORTCUT],
      ['Alt+Shift+K', 'Alt+Shift+K']
    ]) {
      const d = await mkdtemp(path.join(tmpdir(), 'lu-defaults-'))
      await writeFile(path.join(d, DATA_FILE_NAME), JSON.stringify({ schemaVersion: 5, settings: { widgetShortcut: saved } }), 'utf8')
      const store = new DataStore({ directory: d, platform: 'win32' })
      await store.load()
      expect(store.getSettings().widgetShortcut).toBe(expected)
    }
  })
})
