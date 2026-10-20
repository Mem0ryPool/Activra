import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { launch, root, widgetPage, widgetWindow, choose } from './helpers'

interface TrayItem {
  id: string
  label?: string
  type?: string
  checked?: boolean
}

function trayState(app: ElectronApplication): Promise<{ exists: boolean; items: TrayItem[] }> {
  return app.evaluate(() => {
    const hooks = (
      globalThis as unknown as { __lifeUnlockedTest: { tray: () => { exists: boolean; items: TrayItem[] } } }
    ).__lifeUnlockedTest
    const { exists, items } = hooks.tray()
    return { exists, items: items.map(({ id, label, type, checked }) => ({ id, label, type, checked })) }
  })
}

function clickTrayItem(app: ElectronApplication, id: string): Promise<void> {
  return app.evaluate((_electron, itemId) => {
    const hooks = (
      globalThis as unknown as {
        __lifeUnlockedTest: { tray: () => { items: { id: string; click?: () => void }[] } }
      }
    ).__lifeUnlockedTest
    hooks.tray().items.find((i) => i.id === itemId)!.click!()
  }, id)
}

function hints(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    () => (globalThis as unknown as { __lifeUnlockedTest: { hints: unknown[] } }).__lifeUnlockedTest.hints.length
  )
}

function mainState(app: ElectronApplication): Promise<{ exists: boolean; visible: boolean; count: number }> {
  return app.evaluate(({ BrowserWindow }) => {
    const mains = BrowserWindow.getAllWindows().filter(
      (w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html')
    )
    return { exists: mains.length > 0, visible: mains.some((w) => w.isVisible()), count: mains.length }
  })
}

function closeMain(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('index.html'))!
      .close()
  })
}

async function seedEnglish(userData: string, extra: Record<string, unknown> = {}): Promise<void> {
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 1, settings: { language: 'en', ...extra }, tasks: [] })
  )
}

test('tray: close hides to the tray, menu actions, quit really quits', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-tray-'))
  await seedEnglish(userData)
  const first = await launch(userData)
  const page = first.page
  let app = first.app

  // One tray icon with the full menu.
  const tray = await trayState(app)
  expect(tray.exists).toBe(true)
  expect(tray.items.filter((i) => i.type !== 'separator').map((i) => i.label)).toEqual([
    'Open Activra',
    'Show desktop widget',
    'Widget always on top',
    'Quick add task',
    'Quick complete task',
    'Settings',
    'Quit Activra'
  ])

  // Closing the main window hides it; the app keeps running; a hint explains it once.
  await closeMain(app)
  await expect.poll(() => mainState(app)).toEqual({ exists: true, visible: false, count: 1 })
  expect(await hints(app)).toBe(1)

  // Left click brings back the same window, never a second one.
  await app.evaluate(() =>
    (globalThis as unknown as { __lifeUnlockedTest: { clickTray: () => void } }).__lifeUnlockedTest.clickTray()
  )
  await expect.poll(() => mainState(app)).toEqual({ exists: true, visible: true, count: 1 })
  await closeMain(app)
  await expect.poll(() => mainState(app)).toMatchObject({ visible: false })
  expect(await hints(app)).toBe(1)

  // Quick add opens the main window on the existing create dialog.
  await clickTrayItem(app, 'quick-add')
  await expect.poll(() => mainState(app)).toMatchObject({ visible: true, count: 1 })
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('input[name=title]')).toBeVisible()
  await page.locator('input[name=title]').fill('Added from the tray')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('task-card')).toContainText('Added from the tray')

  // Settings
  await closeMain(app)
  await clickTrayItem(app, 'settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'When closing the main window' })).toHaveAttribute('data-value', 'tray')

  // Widget toggles from the tray; the menu follows the settings.
  await clickTrayItem(app, 'widget')
  await widgetPage(app)
  await expect.poll(async () => (await trayState(app)).items.find((i) => i.id === 'widget')?.checked).toBe(true)
  await clickTrayItem(app, 'always-on-top')
  await expect.poll(async () => (await widgetWindow(app))?.alwaysOnTop).toBe(true)
  await expect(page.getByRole('switch', { name: 'Always on top' })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(async () => (await trayState(app)).items.find((i) => i.id === 'always-on-top')?.checked).toBe(true)

  // Menu language follows the app language.
  await choose(page, page.getByRole('combobox', { name: 'Language' }), 'zh-CN')
  await expect
    .poll(async () => (await trayState(app)).items.find((i) => i.id === 'quit')?.label)
    .toBe('退出 Activra')

  // Quit from the tray while the main window is hidden and the widget is open: the process ends.
  await closeMain(app)
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
  await clickTrayItem(app, 'quit')
  await exited
  const data = JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8'))
  expect(data.settings.widget.visible).toBe(true)
  expect(data.tasks).toHaveLength(1)

  // The hint is not shown again after a restart.
  ;({ app } = await launch(userData))
  await closeMain(app)
  await expect.poll(() => mainState(app)).toMatchObject({ visible: false })
  expect(await hints(app)).toBe(0)

  // A second launch while hidden in the tray shows the existing window instead of starting again.
  const args = [root]
  if (process.getuid?.() === 0) args.unshift('--no-sandbox')
  // It exits right away (single-instance lock), so Playwright reports a closed target; that is expected.
  const second = await electron
    .launch({ args, env: { ...process.env, LIFE_UNLOCKED_USER_DATA: userData } as Record<string, string> })
    .catch(() => null)
  await second?.close().catch(() => {})
  await expect.poll(() => mainState(app)).toEqual({ exists: true, visible: true, count: 1 })
  await app.close()
})

test('tray: "quit the app" on close quits even with the widget open', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-tray-'))
  await seedEnglish(userData, { closeAction: 'quit' })
  const { app, page } = await launch(userData)
  await page.evaluate(async () => {
    const s = await window.lifeUnlocked.settings.get()
    await window.lifeUnlocked.settings.update({ widget: { ...s.widget, visible: true } })
  })
  await widgetPage(app)
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
  await closeMain(app)
  await exited
})
