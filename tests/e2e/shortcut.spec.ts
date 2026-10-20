import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launch, shots, widgetWindow } from './helpers'

/**
 * Phase 6.7: the global shortcut that shows/hides the desktop widget, its Settings row (record, cancel,
 * off/on, conflicts) and the 5-second notification default. Unusual accelerators are used so a real
 * Activra running on the same PC (holding Ctrl+Alt+W) does not interfere.
 */

const DATA = 'life-unlocked-data.json'
const FIRST = 'Alt+Shift+F11'
const settingsOf = async (userData: string): Promise<Record<string, unknown>> =>
  (JSON.parse(await readFile(path.join(userData, DATA), 'utf8')) as { settings: Record<string, unknown> }).settings

const isRegistered = (app: ElectronApplication, accelerator: string): Promise<boolean> =>
  app.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), accelerator)
const press = (app: ElectronApplication): Promise<void> =>
  app.evaluate(() => (globalThis as unknown as { __lifeUnlockedTest: { pressWidgetShortcut: () => void } }).__lifeUnlockedTest.pressWidgetShortcut())
const widgetWindows = (app: ElectronApplication): Promise<number> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('widget.html')).length)

test('the shortcut toggles one widget; Settings records, cancels, turns it off and on', async () => {
  // Expects Windows key labels (Ctrl+Alt+D); the macOS labels and default (⌃⌥D) are in tests/unit/macosPrep.test.ts.
  test.skip(process.platform === 'darwin', 'Windows key labels')
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-shortcut-'))
  await writeFile(
    path.join(userData, DATA),
    JSON.stringify({ schemaVersion: 5, tasks: [], completions: [], settings: { language: 'zh-CN', widgetShortcut: FIRST } }),
    'utf8'
  )
  const { app, page } = await launch(userData)
  await expect.poll(() => isRegistered(app, FIRST)).toBe(true)

  // Pressing it shows the widget, pressing again hides it; never a second window.
  await press(app)
  await expect.poll(async () => (await widgetWindow(app))?.visible ?? false).toBe(true)
  await press(app)
  await expect.poll(async () => (await settingsOf(userData)).widget).toMatchObject({ visible: false })
  await press(app)
  await expect.poll(async () => (await settingsOf(userData)).widget).toMatchObject({ visible: true })
  // A window being hidden plays its exit for a moment while the new one opens; then exactly one is left.
  await expect.poll(() => widgetWindows(app)).toBe(1)
  await press(app)
  await expect.poll(async () => (await settingsOf(userData)).widget).toMatchObject({ visible: false })

  await page.locator('aside button', { hasText: '设置' }).click()
  const keys = page.getByTestId('widget-shortcut-keys')
  const status = page.getByTestId('widget-shortcut-status')
  await expect(keys).toHaveText('Alt+Shift+F11')
  await expect(status).toHaveAttribute('data-state', 'registered')
  await expect(status).toContainText('Alt+Shift+F11')
  await page.getByTestId('widget-shortcut-row').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(shots, 'settings-shortcut.png') })

  // Click the field to record: the old one is released (so it cannot fire); Esc cancels and takes it back.
  await keys.click()
  await expect(status).toHaveAttribute('data-state', 'recording')
  await expect.poll(() => isRegistered(app, FIRST)).toBe(false)
  await page.keyboard.press('Escape')
  await expect(status).toHaveAttribute('data-state', 'registered')
  await expect.poll(() => isRegistered(app, FIRST)).toBe(true)

  // A key without Ctrl/Alt/Win is refused; a real combination is saved and swapped in.
  await keys.click()
  await page.keyboard.press('KeyK')
  await expect(status).toContainText('需包含 Ctrl、Alt 或 Win')
  await page.keyboard.press('Control+Alt+Shift+F10')
  await expect(status).toContainText('最多 3 个键')
  await page.keyboard.press('Control+Shift+F10')
  await expect(keys).toHaveText('Ctrl+Shift+F10')
  await expect.poll(async () => (await settingsOf(userData)).widgetShortcut).toBe('CommandOrControl+Shift+F10')
  await expect.poll(() => isRegistered(app, 'CommandOrControl+Shift+F10')).toBe(true)
  expect(await isRegistered(app, FIRST)).toBe(false)
  // The pressed combination is used at once: no restart.
  await press(app)
  await expect.poll(async () => (await settingsOf(userData)).widget).toMatchObject({ visible: true })
  await press(app)

  // Off: released, said plainly; on again: the default.
  await page.getByTestId('widget-shortcut-off').click()
  await expect(status).toHaveAttribute('data-state', 'off')
  await expect(keys).toHaveText('未设置')
  await expect.poll(() => isRegistered(app, 'CommandOrControl+Shift+F10')).toBe(false)
  await page.getByTestId('widget-shortcut-default').click()
  await expect(keys).toHaveText('Ctrl+Alt+D')
  await expect(page.getByTestId('widget-shortcut-default')).toHaveCount(0)
  await app.close()
})

test('a shortcut another program holds is reported, and the app still starts', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-shortcut-conflict-'))
  await writeFile(
    path.join(userData, DATA),
    JSON.stringify({ schemaVersion: 5, tasks: [], completions: [], settings: { language: 'zh-CN', widgetShortcut: null } }),
    'utf8'
  )
  // The first instance holds the accelerator, like another program would.
  const holder = await launch(await mkdtemp(path.join(tmpdir(), 'lu-shortcut-holder-')))
  const taken = 'Alt+Shift+F9'
  await holder.page.evaluate((a) => window.lifeUnlocked.settings.update({ widgetShortcut: a }), taken)
  await expect.poll(() => isRegistered(holder.app, taken)).toBe(true)

  const { app, page } = await launch(userData)
  const working = 'Alt+Shift+F8'
  await page.evaluate((a) => window.lifeUnlocked.settings.update({ widgetShortcut: a }), working)
  await expect.poll(() => isRegistered(app, working)).toBe(true)
  await expect.poll(async () => (await settingsOf(userData)).notificationDurationSec).toBe(5)
  await page.locator('aside button', { hasText: '设置' }).click()
  const status = page.getByTestId('widget-shortcut-status')

  // Recording a combination another program holds: refused, the working one stays and is saved as before.
  await page.getByTestId('widget-shortcut-keys').click()
  await page.keyboard.press('Alt+Shift+F9')
  await expect(status).toHaveAttribute('data-state', 'rejected')
  await expect(status).toContainText('已被其他程序占用，未作更改，仍使用 Alt+Shift+F8')
  await expect(page.getByTestId('widget-shortcut-keys')).toHaveText('Alt+Shift+F8')
  expect(await isRegistered(app, working)).toBe(true)
  expect((await settingsOf(userData)).widgetShortcut).toBe(working)

  // Started with a saved shortcut that is taken: reported, the app runs normally.
  await page.evaluate((a) => window.lifeUnlocked.settings.update({ widgetShortcut: a }), taken)
  await expect(status).toHaveAttribute('data-state', 'conflict')
  await expect(status).toContainText('已被其他程序占用')
  // The default notification length for a new profile.
  await expect(page.getByText('5 秒').first()).toBeVisible()
  await holder.app.close()
  await app.close()
})
