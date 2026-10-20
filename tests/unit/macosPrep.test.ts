import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import { buildMacAppMenu } from '../../src/main/appMenu'
import { DATA_FOLDER_NAME, DEV_DATA_FOLDER_NAME, resolveUserDataDir } from '../../src/main/dataDirectory'
import { DATA_FILE_NAME, DataStore } from '../../src/main/storage/dataStore'
import { escapeMenuLabel } from '../../src/main/trayMenu'
import { createTranslator } from '../../src/shared/i18n'
import {
  acceleratorFromKey,
  DEFAULT_WIDGET_SHORTCUT,
  defaultWidgetShortcut,
  formatAccelerator,
  isValidAccelerator,
  MAC_WIDGET_SHORTCUT
} from '../../src/shared/shortcut'

const root = path.resolve(__dirname, '../..')
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')

/** macOS preparation: checks that need no Mac (the build itself has not run on macOS yet). */
describe('macOS preparation', () => {
  it('the mac build is unsigned, for Apple silicon and Intel, with the Activra icon; Windows settings are unchanged', () => {
    const builder = read('electron-builder.yml')
    const mac = builder.slice(builder.indexOf('\nmac:'))
    expect(builder).toMatch(/^appId: app\.lifeunlocked\.desktop$/m)
    expect(builder).toMatch(/^publish: null$/m)
    expect(mac).toMatch(/^ {2}icon: build\/icon\.png$/m)
    expect(mac).toMatch(/^ {2}identity: null$/m)
    expect(mac).toMatch(/^ {6}arch: \[arm64, x64\]$/m)
    // Windows build settings are untouched.
    expect(builder).toMatch(/^win:\r?\n {2}icon: build\/icon\.ico\r?\n {2}target:\r?\n {4}- target: nsis\r?\n {6}arch: \[x64\]$/m)
  })

  it('keeps the same data folder rule (Application Support), and dev runs isolated', () => {
    const appData = '/Users/me/Library/Application Support'
    expect(resolveUserDataDir(appData, undefined, path.posix)).toBe(`${appData}/${DATA_FOLDER_NAME}`)
    expect(resolveUserDataDir(appData, undefined, path.posix, { packaged: false })).toBe(`${appData}/${DEV_DATA_FOLDER_NAME}`)
  })

  it('the widget shortcut is Cmd+Option+D on macOS and records Cmd as the portable modifier', () => {
    expect(formatAccelerator(DEFAULT_WIDGET_SHORTCUT, 'darwin')).toBe('⌘⌥D')
    const press = { code: 'KeyD', ctrlKey: false, altKey: true, shiftKey: false, metaKey: true }
    expect(acceleratorFromKey(press, 'darwin')).toEqual({ kind: 'ok', accelerator: DEFAULT_WIDGET_SHORTCUT })
  })

  it('the Dock icon reopens the window, and full-window views clear the traffic lights', () => {
    expect(read('src/main/index.ts')).toContain("app.on('activate'")
    expect(read('src/main/windows/mainWindow.ts')).toContain('trafficLightPosition')
    const css = read('src/renderer/src/styles.css')
    expect(css).toMatch(/\[data-platform='darwin'\] \.titlebar-left-pad/)
    expect(read('src/renderer/src/focus/FocusMode.tsx')).toContain('titlebar-left-pad')
  })
})

/** macOS port (Phase A): behavior that differs on a Mac, checked with the platform passed in. */
describe('macOS port', () => {
  it('a new Mac profile gets ⌃⌥D (⌘⌥D is the system Dock shortcut); Windows keeps Ctrl+Alt+D; a recorded choice stays', async () => {
    expect(defaultWidgetShortcut('win32')).toBe(DEFAULT_WIDGET_SHORTCUT)
    expect(defaultWidgetShortcut('darwin')).toBe(MAC_WIDGET_SHORTCUT)
    expect(formatAccelerator(MAC_WIDGET_SHORTCUT, 'darwin')).toBe('⌃⌥D')
    expect(isValidAccelerator(MAC_WIDGET_SHORTCUT)).toBe(true)
    // Recording Control+Option+D on a Mac gives the same value.
    const press = { code: 'KeyD', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false }
    expect(acceleratorFromKey(press, 'darwin')).toEqual({ kind: 'ok', accelerator: MAC_WIDGET_SHORTCUT })

    const fresh = new DataStore({ directory: await mkdtemp(path.join(tmpdir(), 'lu-mac-')), platform: 'darwin' })
    await fresh.load()
    expect(fresh.getSettings().widgetShortcut).toBe(MAC_WIDGET_SHORTCUT)

    const dir = await mkdtemp(path.join(tmpdir(), 'lu-mac-'))
    const file = (settings: object): string => JSON.stringify({ schemaVersion: 5, tasks: [], completions: [], settings })
    await writeFile(path.join(dir, DATA_FILE_NAME), file({ widgetShortcut: DEFAULT_WIDGET_SHORTCUT }), 'utf8')
    const recorded = new DataStore({ directory: dir, platform: 'darwin' })
    await recorded.load()
    expect(recorded.getSettings().widgetShortcut).toBe(DEFAULT_WIDGET_SHORTCUT)

    const win = new DataStore({ directory: await mkdtemp(path.join(tmpdir(), 'lu-mac-')), platform: 'win32' })
    await win.load()
    expect(win.getSettings().widgetShortcut).toBe(DEFAULT_WIDGET_SHORTCUT)
  })

  it('menu labels keep "&" as typed: doubled for Windows, untouched on macOS', () => {
    expect(escapeMenuLabel('Tom & Jerry', 'win32')).toBe('Tom && Jerry')
    expect(escapeMenuLabel('Tom & Jerry', 'darwin')).toBe('Tom & Jerry')
  })

  it('the Mac menu bar has Edit/Window roles, ⌘, for Settings, and reload/devtools only in development', () => {
    let opened = 0
    const t = createTranslator('zh-CN')
    const production = buildMacAppMenu(t, { openSettings: () => (opened += 1) }, false)
    expect(production.map((m) => m.role)).toEqual(['appMenu', 'editMenu', 'viewMenu', 'windowMenu'])
    const appItems = production[0]?.submenu as MenuItemConstructorOptions[]
    const settings = appItems.find((i) => i.id === 'settings')
    expect(settings).toMatchObject({ label: '设置…', accelerator: 'Command+,' })
    ;(settings?.click as () => void)()
    expect(opened).toBe(1)
    expect(appItems.some((i) => i.role === 'quit')).toBe(true)
    const roles = (menu: MenuItemConstructorOptions[]): string[] =>
      (menu[2]?.submenu as MenuItemConstructorOptions[]).map((i) => String(i.role ?? i.type))
    expect(roles(production)).toEqual(['togglefullscreen'])
    expect(roles(buildMacAppMenu(t, { openSettings: () => {} }, true))).toContain('reload')
  })

  it('every Mac-only text exists in both languages and names the menu bar / macOS, not the Windows tray', () => {
    const keys = [
      'tray.hint.bodyMac',
      'settings.closeAction.trayMac',
      'settings.reminders.hintMac',
      'settings.widget.shortcut.tooManyMac',
      'settings.widget.shortcut.offMac',
      'settings.widget.shortcut.needsModifierMac'
    ] as const
    for (const locale of ['en', 'zh-CN'] as const) {
      const t = createTranslator(locale)
      for (const key of keys) {
        expect(t(key)).not.toBe(key)
        expect(t(key)).not.toMatch(/Windows|Ctrl|Win\b|托盘|任务栏/)
      }
    }
  })

  it('the menu bar icon opens its menu on macOS; Windows keeps left click = open', () => {
    const tray = read('src/main/tray.ts')
    expect(tray).toContain("if (process.platform !== 'darwin') tray.on('click'")
    expect(read('src/main/index.ts')).toContain('Menu.setApplicationMenu')
  })
})

/** macOS DMG window: asset checks only (the DMG itself is built and looked at on a Mac). */
describe('macOS DMG window', () => {
  const png = (file: string): number[] => {
    const buf = readFileSync(path.join(root, file))
    expect(buf.subarray(1, 4).toString('latin1'), file).toBe('PNG')
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
  }

  it('has an Activra background at 1x and @2x, the app and an Applications link where the background expects them', () => {
    expect(png('build/dmg-background.png')).toEqual([540, 380])
    expect(png('build/dmg-background@2x.png')).toEqual([1080, 760])
    const builder = read('electron-builder.yml')
    const dmg = builder.slice(builder.indexOf('\ndmg:'))
    expect(dmg).toMatch(/^ {2}background: build\/dmg-background\.png$/m)
    expect(dmg).toMatch(/^ {2}icon: build\/icon\.icns$/m)
    expect(dmg).toMatch(/^ {2}iconSize: 96$/m)
    expect(dmg).toMatch(/- x: 140\r?\n {6}y: 200\r?\n {6}type: file/)
    expect(dmg).toMatch(/- x: 400\r?\n {6}y: 200\r?\n {6}type: link\r?\n {6}path: \/Applications/)
    const script = read('scripts/generate-dmg-assets.mjs')
    expect(script).toContain('const APP = { x: 140, y: 200 }')
    expect(script).toContain('const APPLICATIONS = { x: 400, y: 200 }')
  })

  it('the volume icon is a valid .icns with every size as PNG', () => {
    const buf = readFileSync(path.join(root, 'build/icon.icns'))
    expect(buf.subarray(0, 4).toString('latin1')).toBe('icns')
    expect(buf.readUInt32BE(4)).toBe(buf.length)
    const sizes: Record<string, number> = {}
    for (let at = 8; at < buf.length; ) {
      const type = buf.subarray(at, at + 4).toString('latin1')
      const length = buf.readUInt32BE(at + 4)
      const data = buf.subarray(at + 8, at + length)
      expect(data.subarray(1, 4).toString('latin1'), type).toBe('PNG')
      expect(data.readUInt32BE(16), type).toBe(data.readUInt32BE(20))
      sizes[type] = data.readUInt32BE(16)
      at += length
    }
    expect(sizes).toEqual({ icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 })
  })
})
