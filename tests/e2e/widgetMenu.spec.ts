import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launch, notificationPage, widgetPage } from './helpers'

/**
 * The desktop widget's right-click menu: "Quick complete task" lists today's tasks still to do and
 * completes the clicked one through the same path as the tray, the widget list and the main window.
 */

interface MenuItem {
  id: string
  label?: string
  type?: string
  enabled?: boolean
  submenu?: MenuItem[]
}
interface Hooks {
  widgetMenu: () => { shown: number; items: MenuItem[] }
  clickWidgetMenuItem: (id: string) => boolean
  notifications: () => { shown: { id: string; taskTitle: string }[] }
}

const menu = (app: ElectronApplication): Promise<{ shown: number; items: MenuItem[] }> =>
  app.evaluate(() => {
    const { shown, items } = (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.widgetMenu()
    const plain = (list: MenuItem[]): MenuItem[] =>
      list.map(({ id, label, type, enabled, submenu }) => ({ id, label, type, enabled, submenu: submenu && plain(submenu) }))
    return { shown, items: plain(items) }
  })
const quickItems = async (app: ElectronApplication): Promise<MenuItem[]> =>
  (await menu(app)).items.find((i) => i.id === 'quick-complete')?.submenu ?? []
const clickMenu = (app: ElectronApplication, id: string): Promise<boolean> =>
  app.evaluate(
    (_e, itemId) => (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.clickWidgetMenuItem(itemId),
    id
  )
const toastTitles = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() =>
    (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.notifications().shown.map((n) => n.taskTitle)
  )

const hoursAgo = (h: number): string => new Date(Date.now() - h * 3600 * 1000).toISOString()
const task = (id: string, title: string, createdAt: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  title,
  description: '',
  createdAt,
  updatedAt: createdAt,
  completedAt: null,
  status: 'active',
  timerConfig: null,
  themeOverride: null,
  ...extra
})

async function seed(userData: string): Promise<void> {
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 1,
      settings: { language: 'en', notificationDurationSec: 3, widget: { visible: true } },
      tasks: [
        task('read', 'Read 20 pages', hoursAgo(5)),
        task('gym', 'Go to the gym', hoursAgo(1)),
        task('run', 'Morning run', hoursAgo(10), { status: 'completed', completedAt: new Date().toISOString() })
      ]
    })
  )
}

const completionsOf = async (userData: string, taskId: string): Promise<number> => {
  const data = JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as {
    completions: { taskId: string; undoneAt: string | null }[]
  }
  return data.completions.filter((c) => c.taskId === taskId && !c.undoneAt).length
}

test('widget right-click menu: quick complete today\'s tasks, everything stays in sync', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-widget-menu-'))
  await seed(userData)
  const { app, page } = await launch(userData)
  const widget = await widgetPage(app)
  await expect(widget.getByTestId('widget-progress')).toHaveText('1 of 3 done')

  // Right-click on the task list opens the menu, built from what is to do right now.
  await widget.getByTestId('widget-panel').click({ button: 'right', position: { x: 160, y: 300 } })
  await expect.poll(async () => (await menu(app)).shown).toBe(1)
  const opened = await menu(app)
  expect(opened.items.map((i) => (i.type === 'separator' ? '-' : i.label))).toEqual(['Quick complete task', '-', 'Open Activra'])
  // Today's open tasks, in the widget's order; the completed one is not offered.
  expect((await quickItems(app)).map((i) => i.label)).toEqual(['Go to the gym', 'Read 20 pages'])

  // Clicking one completes it: the record is saved once, the achievement shows, the widget and
  // the main window follow.
  await expect(page.getByRole('tab', { name: /In progress/ })).toContainText('2')
  expect(await clickMenu(app, 'quick-complete:gym')).toBe(true)
  const toast = await notificationPage(app)
  await expect(toast.getByTestId('achievement-toast')).toContainText('Go to the gym')
  await expect(widget.getByTestId('widget-progress')).toHaveText('2 of 3 done')
  await expect(widget.getByRole('checkbox', { name: '"Go to the gym" is completed' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('tab', { name: /In progress/ })).toContainText('1')
  await expect.poll(() => completionsOf(userData, 'gym')).toBe(1)
  expect(await toastTitles(app)).toEqual(['Go to the gym'])

  // The next right-click on the drag handle shows the same menu (not Windows' Move/Close menu),
  // and the list no longer offers the completed task.
  await widget.getByTestId('widget-drag-handle').click({ button: 'right', position: { x: 60, y: 20 } })
  await expect.poll(async () => (await menu(app)).shown).toBe(2)
  expect((await quickItems(app)).map((i) => i.id)).toEqual(['quick-complete:read'])

  // A stale entry: the task is completed elsewhere while the menu is open. The store refuses the
  // second completion; nothing is unlocked twice and the app carries on.
  await page.evaluate(() => window.lifeUnlocked.tasks.complete('read'))
  await expect(widget.getByTestId('widget-progress')).toHaveText('3 of 3 done')
  expect(await clickMenu(app, 'quick-complete:read')).toBe(true)
  await page.waitForTimeout(500)
  expect(await completionsOf(userData, 'read')).toBe(1)
  expect((await toastTitles(app)).filter((t) => t === 'Read 20 pages')).toHaveLength(1)

  // Nothing left: the submenu says so and offers nothing to click.
  await widget.getByTestId('widget-panel').click({ button: 'right', position: { x: 160, y: 300 } })
  await expect.poll(async () => (await menu(app)).shown).toBe(3)
  expect(await quickItems(app)).toEqual([{ id: 'quick-complete-empty', label: 'Nothing left to do today', enabled: false }])
  expect(await clickMenu(app, 'quick-complete-empty')).toBe(false)

  // "Open Activra" brings the main window forward.
  expect(await clickMenu(app, 'open')).toBe(true)
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible')

  // The tray keeps its own "Quick complete task" entry, now with nothing left either.
  const trayQuick = await app.evaluate(() => {
    const items = (globalThis as unknown as { __lifeUnlockedTest: { tray: () => { items: MenuItem[] } } }).__lifeUnlockedTest.tray().items
    return items.find((i) => i.id === 'quick-complete')?.submenu?.map((i) => i.id) ?? null
  })
  expect(trayQuick).toEqual(['quick-complete-empty'])
  await app.close()
})
