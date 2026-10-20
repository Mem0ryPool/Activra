import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DATA_FOLDER_NAME, DEV_DATA_FOLDER_NAME, resolveUserDataDir } from '../../src/main/dataDirectory'
import { DATA_FILE_NAME } from '../../src/main/storage/dataStore'
import { en } from '../../src/shared/i18n/en'
import { zhCN } from '../../src/shared/i18n/zh-CN'

const root = path.resolve(__dirname, '../..')
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')

describe('Activra data folder', () => {
  it('keeps the pre-Activra folder name, so existing data is found without moving it', () => {
    expect(DATA_FOLDER_NAME).toBe('Life Unlocked')
    expect(resolveUserDataDir('C:\\Users\\me\\AppData\\Roaming', undefined, path.win32)).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\Life Unlocked'
    )
    expect(resolveUserDataDir('/home/me/.config', undefined, path.posix)).toBe('/home/me/.config/Life Unlocked')
    expect(resolveUserDataDir('/Users/me/Library/Application Support', undefined, path.posix)).toBe(
      '/Users/me/Library/Application Support/Life Unlocked'
    )
  })

  it('uses the test profile when one is given, and ignores an empty one', () => {
    expect(resolveUserDataDir('/home/me/.config', '/tmp/profile', path.posix)).toBe('/tmp/profile')
    expect(resolveUserDataDir('/home/me/.config', '', path.posix)).toBe('/home/me/.config/Life Unlocked')
  })

  it('an unpackaged development run never uses the real data folder', () => {
    const appData = 'C:\\Users\\me\\AppData\\Roaming'
    const dev = { packaged: false }
    expect(DEV_DATA_FOLDER_NAME).not.toBe(DATA_FOLDER_NAME)
    expect(resolveUserDataDir(appData, undefined, path.win32, dev)).toBe('C:\\Users\\me\\AppData\\Roaming\\Life Unlocked Dev')
    expect(resolveUserDataDir(appData, '', path.win32, dev)).toBe('C:\\Users\\me\\AppData\\Roaming\\Life Unlocked Dev')
    // An override pointing at the real folder (any case, trailing slash) is redirected too.
    expect(resolveUserDataDir(appData, 'c:\\users\\me\\appdata\\roaming\\life unlocked\\', path.win32, dev)).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\Life Unlocked Dev'
    )
    // Isolated test and acceptance profiles still work.
    expect(resolveUserDataDir(appData, 'C:\\dev\\patches\\dev-data', path.win32, dev)).toBe('C:\\dev\\patches\\dev-data')
    // Only an explicit opt-in, or the installed app, reaches the real folder.
    expect(resolveUserDataDir(appData, undefined, path.win32, { packaged: false, useProduction: true })).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\Life Unlocked'
    )
    expect(resolveUserDataDir(appData, undefined, path.win32, { packaged: true })).toBe('C:\\Users\\me\\AppData\\Roaming\\Life Unlocked')
    expect(resolveUserDataDir('/home/me/.config', undefined, path.posix, dev)).toBe('/home/me/.config/Life Unlocked Dev')
  })

  it('keeps the data file name', () => {
    expect(DATA_FILE_NAME).toBe('life-unlocked-data.json')
  })

  it('is set before anything else in the main process can read userData', () => {
    const main = read('src/main/index.ts')
    const setPath = main.indexOf("app.setPath('userData'")
    expect(setPath).toBeGreaterThan(-1)
    for (const use of ["getPath('userData')", 'requestSingleInstanceLock(', 'startFileLog(', 'new DataStore(']) {
      expect(main.indexOf(use), use).toBeGreaterThan(setPath)
    }
  })
})

describe('Activra name', () => {
  it('replaces the old name in every visible string, in both languages', () => {
    for (const strings of [en, zhCN] as Record<string, string>[]) {
      expect(strings['app.name']).toBe('Activra')
      for (const [key, value] of Object.entries(strings)) expect(value, key).not.toMatch(/Life Unlocked/i)
    }
    expect(en['app.tagline']).toBe('Action · Progress · Achievement')
    expect(zhCN['app.tagline']).toBe('行动 · 推进 · 成就')
  })

  it('shows Activra in the window titles and installer names, and keeps the ids the installer upgrades by', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, string>
    expect(pkg['productName']).toBe('Activra')
    expect(pkg['name']).toBe('life-unlocked')
    const builder = read('electron-builder.yml')
    expect(builder).toMatch(/^appId: app\.lifeunlocked\.desktop$/m)
    expect(builder).toMatch(/^productName: Activra$/m)
    expect(builder).toMatch(/^\s+shortcutName: Activra$/m)
    expect(builder).toMatch(/^\s+uninstallDisplayName: Activra \$\{version\}$/m)
    expect(builder).toMatch(/^\s+deleteAppDataOnUninstall: false$/m)
    expect(read('src/main/index.ts')).toContain("setAppUserModelId('app.lifeunlocked.desktop')")
    for (const file of ['src/renderer/index.html', 'src/renderer/widget.html', 'src/main/windows/mainWindow.ts', 'src/main/windows/widgetWindow.ts']) {
      expect(read(file), file).not.toContain('Life Unlocked')
    }
  })
})
