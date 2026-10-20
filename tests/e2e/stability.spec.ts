import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launch, root, widgetPage } from './helpers'

type Hooks = {
  dataNotices: { message: string; detail: string }[]
  reminders: { keys: string[] }[]
  withdrawnReminders: string[][]
  runReminders: () => Promise<void>
  widgetBounds: () => { x: number; y: number; width: number; height: number } | null
  keepOnScreen: () => void
}

function hooks<T>(app: ElectronApplication, pick: (h: Hooks) => T): Promise<T> {
  return app.evaluate(
    (_e, source) => {
      const h = (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest
      return (new Function('h', `return (${source})(h)`) as (h: Hooks) => T)(h)
    },
    pick.toString()
  )
}

function task(id: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const createdAt = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
  return {
    id,
    title,
    description: '',
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    status: 'active',
    timerConfig: null,
    themeOverride: null,
    recurrence: null,
    recurrenceHistory: [],
    skippedOccurrences: [],
    due: null,
    reminderMinutes: null,
    ...extra
  }
}

const dataFile = (userData: string): string => path.join(userData, 'life-unlocked-data.json')
const mainWindowState = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const mains = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'))
    return { count: mains.length, visible: mains.some((w) => w.isVisible()), maximized: mains.some((w) => w.isMaximized()) }
  })

test('a second launch exits at once and brings back the hidden window of the first', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-single-'))
  const { app } = await launch(userData)
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('index.html')) w.hide()
  })
  expect((await mainWindowState(app)).visible).toBe(false)

  const electronPath = (await import('electron')).default as unknown as string
  const args = [root]
  if (process.getuid?.() === 0) args.unshift('--no-sandbox')
  const second = spawn(electronPath, args, {
    env: { ...process.env, LIFE_UNLOCKED_USER_DATA: userData },
    stdio: 'ignore'
  })
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('second instance kept running')), 15_000)
    second.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  expect(exitCode).toBe(0)
  await expect.poll(async () => (await mainWindowState(app)).visible).toBe(true)
  expect((await mainWindowState(app)).count).toBe(1)
  await app.close()
})

test('an unreadable data file is kept aside, the newest daily backup comes back, and the user is told', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-recover-'))
  await mkdir(path.join(userData, 'backups'))
  await writeFile(
    path.join(userData, 'backups', 'life-unlocked-data-2026-10-14.json'),
    JSON.stringify({ schemaVersion: 2, tasks: [task('kept', 'Saved by the backup')], completions: [], settings: { language: 'en' } })
  )
  await writeFile(dataFile(userData), '{"schemaVersion": 2, "tasks": [{"id": "x"', 'utf8')

  const { app, page } = await launch(userData)
  await expect(page.getByTestId('task-card').filter({ hasText: 'Saved by the backup' })).toBeVisible()
  const notices = await hooks(app, (h) => h.dataNotices)
  expect(notices).toHaveLength(1)
  expect(notices[0]?.message).toContain('most recent daily backup was restored')
  expect(notices[0]?.detail).toContain('life-unlocked-data.json.corrupt-')
  await app.close()

  // Restored data was written back at once: the next start is normal, without a notice.
  const again = await launch(userData)
  await expect(again.page.getByTestId('task-card').filter({ hasText: 'Saved by the backup' })).toBeVisible()
  expect(await hooks(again.app, (h) => h.dataNotices)).toHaveLength(0)
  await again.app.close()
})

test('quitting right after a change still saves it, and the main process writes a log', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-quit-'))
  const { app, page } = await launch(userData)
  await page.getByRole('button', { name: /New task|新建任务/ }).first().click()
  await page.locator('input[name=title]').fill('Saved before quitting')
  await page.locator('input[name=title]').press('Enter')
  await expect(page.getByTestId('task-card').filter({ hasText: 'Saved before quitting' })).toBeVisible()
  await app.evaluate(({ app: electronApp }) => electronApp.quit())
  await app.waitForEvent('close')
  const saved = JSON.parse(await readFile(dataFile(userData), 'utf8')) as { tasks: { title: string }[] }
  expect(saved.tasks.map((t) => t.title)).toContain('Saved before quitting')
  const log = await readFile(path.join(userData, 'logs', 'main.log'), 'utf8')
  expect(log).toMatch(/\[App\] Activra \d+\.\d+\.\d+/)
  expect(log).not.toContain('Saved before quitting')
})

// Maximizing needs a window manager, which the Linux test display does not have: this checks that a
// saved maximized state still opens a visible window; the maximized look is on the Windows checklist.
test('a window saved as maximized still opens and is shown', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-max-'))
  await writeFile(
    path.join(userData, 'window-state.json'),
    JSON.stringify({ x: 100, y: 100, width: 1000, height: 640, isMaximized: true })
  )
  const { app } = await launch(userData)
  await expect.poll(async () => mainWindowState(app)).toMatchObject({ count: 1, visible: true })
  await app.close()
})

test('a reminder that no longer applies is withdrawn when its task is completed', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-withdraw-'))
  const pad = (n: number): string => String(n).padStart(2, '0')
  const due = new Date(Date.now() + 5 * 60_000)
  const date = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`
  const time = `${pad(due.getHours())}:${pad(due.getMinutes())}`
  await writeFile(
    dataFile(userData),
    JSON.stringify({
      schemaVersion: 2,
      tasks: [task('t1', 'Pay the rent', { due: { date, time }, reminderMinutes: 15 })],
      completions: [],
      settings: { language: 'en' }
    })
  )
  const { app, page } = await launch(userData)
  await expect.poll(() => hooks(app, (h) => h.reminders.length)).toBe(1)
  const supported = await app.evaluate(({ Notification }) => Notification.isSupported())
  await page.getByTestId('task-card').filter({ hasText: 'Pay the rent' }).getByRole('button', { name: /^(Complete|完成)$/ }).click()
  await hooks(app, (h) => h.runReminders())
  if (supported) {
    await expect.poll(() => hooks(app, (h) => h.withdrawnReminders.length)).toBe(1)
  } else {
    test.info().annotations.push({ type: 'note', description: 'Native notifications unsupported here; withdraw not observable' })
  }
  // Running again shows nothing new: the reminder was handled once.
  await hooks(app, (h) => h.runReminders())
  expect(await hooks(app, (h) => h.reminders.length)).toBe(1)
  await app.close()
})

test('the widget is moved back onto a display after the screen layout changes', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-display-'))
  await writeFile(
    dataFile(userData),
    JSON.stringify({ schemaVersion: 2, tasks: [], completions: [], settings: { language: 'en', widget: { visible: true } } })
  )
  const { app } = await launch(userData)
  await widgetPage(app)
  // As if its monitor was unplugged: the widget is far outside every display.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('widget.html'))
    w?.setBounds({ x: 5000, y: 3000, width: 320, height: 420 })
  })
  await hooks(app, (h) => h.keepOnScreen())
  const bounds = await hooks(app, (h) => h.widgetBounds())
  const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(area.x)
  expect(bounds!.y).toBeGreaterThanOrEqual(area.y)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(area.x + area.width)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(area.y + area.height)
  // The new position is saved, so the next start opens it there too.
  await expect
    .poll(() =>
      readFile(path.join(userData, 'widget-state.json'), 'utf8')
        .then((text) => (JSON.parse(text) as { x: number }).x)
        .catch(() => null)
    )
    .toBe(bounds!.x)
  await app.close()
})
