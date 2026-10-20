import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launch, notificationPage, shots, choose } from './helpers'

test('create, edit, complete, delete and persist tasks', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-e2e-'))
  // Start in English whatever the system language is ('system' is the default and a Chinese Windows
  // would already show Chinese), so the switch to Chinese below is a real change on every machine.
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 2, tasks: [], completions: [], settings: { language: 'en' } })
  )
  let { app, page } = await launch(userData)
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()

  // Main window geometry
  const bounds = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'))!
    return { ...w.getBounds(), min: w.getMinimumSize() }
  })
  expect(bounds.width).toBe(1100)
  expect(bounds.height).toBe(680)
  expect(bounds.min).toEqual([900, 560])

  await page.locator('html').evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(shots, '01-empty.png') })

  // Create a task with a countdown
  await page.getByRole('button', { name: /New task|新建任务/ }).first().click()
  await page.locator('input[name=title]').fill('Finish math homework')
  await page.locator('textarea[name=description]').fill('Chapter 3, exercises 1-20')
  await page.locator('input[name=timer]').check()
  await page.screenshot({ path: path.join(shots, '02-create-dialog.png') })
  await page.getByRole('button', { name: /Save|保存/ }).click()

  // A second task without a countdown
  await page.getByRole('button', { name: /New task|新建任务/ }).first().click()
  await page.locator('input[name=title]').fill('Go to the gym')
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('task-card')).toHaveCount(2)
  await expect(page.getByTestId('countdown')).toContainText(/\d+:\d\d/)

  // Edit via the more menu
  const gymCard = page.getByTestId('task-card').filter({ hasText: 'Go to the gym' })
  await gymCard.getByRole('button', { name: /More actions|更多操作/ }).click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(shots, '03-menu.png') })
  await page.getByRole('menuitem', { name: /Edit|编辑/ }).click()
  await page.locator('input[name=title]').fill('Go to the gym (leg day)')
  await page.getByRole('button', { name: /Save|保存/ }).click()
  await expect(page.getByText('Go to the gym (leg day)')).toBeVisible()
  await page.screenshot({ path: path.join(shots, '04-tasks.png') })

  // Complete with a double click: only one unlock must fire
  const mathCard = page.getByTestId('task-card').filter({ hasText: 'Finish math homework' })
  await mathCard.getByRole('button', { name: /^(Complete|完成)$/ }).dblclick()
  const toast = await notificationPage(app)
  await expect(toast.getByTestId('achievement-toast')).toContainText('Finish math homework')
  const toastWindow = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('notification.html'))!
    const main = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'))!
    return {
      visible: w.isVisible(),
      focusable: w.isFocusable(),
      alwaysOnTop: w.isAlwaysOnTop(),
      bounds: w.getBounds(),
      workArea: screen.getPrimaryDisplay().workArea,
      mainMinimized: main.isMinimized(),
      mainVisible: main.isVisible()
    }
  })
  expect(toastWindow.visible).toBe(true)
  expect(toastWindow.focusable).toBe(false)
  expect(toastWindow.alwaysOnTop).toBe(true)
  expect(toastWindow.mainMinimized).toBe(false)
  expect(toastWindow.mainVisible).toBe(true)
  expect(toastWindow.bounds.x + toastWindow.bounds.width).toBe(toastWindow.workArea.x + toastWindow.workArea.width)
  expect(toastWindow.bounds.y + toastWindow.bounds.height).toBe(toastWindow.workArea.y + toastWindow.workArea.height)
  await page.waitForTimeout(700)
  await toast.screenshot({ path: path.join(shots, '05-toast.png') })
  // Whole virtual desktop (Linux/Xvfb only), to see the toast next to the main window.
  if (process.platform === 'linux' && process.env['DISPLAY']) {
    execFileSync('import', ['-window', 'root', path.join(shots, '05-desktop.png')])
  }


  // Completed history
  await expect(page.getByTestId('task-card')).toHaveCount(1)
  await page.getByRole('tab', { name: /Completed|已完成/ }).click()
  await expect(page.getByTestId('task-card')).toHaveCount(1)
  await page.screenshot({ path: path.join(shots, '06-completed.png') })

  // Other pages render
  for (const [name, file] of [
    [/Achievements|成就/, '07-achievements.png'],
    [/Statistics|统计/, '08-statistics.png'],
    [/Themes|主题/, '09-themes.png'],
    [/Settings|设置/, '10-settings.png']
  ] as const) {
    await page.locator('nav, aside').getByRole('button', { name }).first().click()
    await page.screenshot({ path: path.join(shots, file) })
  }

  // Switch to Chinese
  await choose(page, page.getByRole('combobox', { name: 'Language' }), 'zh-CN')
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
  await page.getByRole('button', { name: '任务' }).click()
  await page.screenshot({ path: path.join(shots, '11-tasks-zh.png') })

  // Delete
  await page.getByRole('button', { name: '更多操作' }).first().click()
  await page.getByRole('menuitem', { name: '删除' }).click()
  await page.screenshot({ path: path.join(shots, '12-delete-confirm.png') })
  await page.getByRole('dialog').getByRole('button', { name: '删除' }).click()
  await expect(page.getByTestId('task-card')).toHaveCount(0)

  // Minimum window size: nothing overflows horizontally
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'))!.setSize(900, 560)
  })
  await page.getByRole('tab', { name: /已完成/ }).click()
  await page.waitForTimeout(300)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
  await page.screenshot({ path: path.join(shots, '13-min-size.png') })
  await app.close()

  // Relaunch: data, language and window size persisted, and only one unlock was recorded
  ;({ app, page } = await launch(userData))
  await page.getByRole('tab', { name: '已完成' }).click()
  await expect(page.getByTestId('task-card')).toHaveCount(1)
  await expect(page.getByTestId('task-card')).toContainText('Finish math homework')
  // The restored size may differ by 1 px per side on Windows at fractional display scaling (125 %,
  // 150 %, 175 %): Windows stores the window in physical pixels and Chromium converts them to DIPs with
  // an enclosing rectangle (ui/display/win/screen_win.cc, ScreenToDIPRect), so the result depends on
  // where the window sits. Linux and 100 % scaling round-trip exactly.
  const first = await mainWindowGeometry(app, userData)
  expectRestoredSize(first, [900, 560])
  await app.close()

  // Restoring must not grow the window launch after launch: a second restart keeps exactly that size.
  ;({ app } = await launch(userData))
  const second = await mainWindowGeometry(app, userData)
  expect(second.size, JSON.stringify({ first, second })).toEqual(first.size)
  await app.close()
})

interface MainWindowGeometry {
  size: number[]
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  saved: string
}

/** The main window's size and what explains it (the hidden notification window is also loaded at startup). */
async function mainWindowGeometry(app: ElectronApplication, userData: string): Promise<MainWindowGeometry> {
  const live = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'))!
    const bounds = w.getBounds()
    return { size: w.getSize(), bounds, scaleFactor: screen.getDisplayMatching(bounds).scaleFactor }
  })
  // What the previous run saved (written on close).
  const saved = await readFile(path.join(userData, 'window-state.json'), 'utf8').catch(() => 'missing')
  return { ...live, saved }
}

function expectRestoredSize(geometry: MainWindowGeometry, [width, height]: [number, number]): void {
  const details = JSON.stringify(geometry)
  const [w, h] = geometry.size as [number, number]
  expect(Math.abs(w - width), `width ${w}, expected ${width} ±1 (${details})`).toBeLessThanOrEqual(1)
  expect(Math.abs(h - height), `height ${h}, expected ${height} ±1 (${details})`).toBeLessThanOrEqual(1)
}

test('IPC rejects invalid input', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-e2e-'))
  const { app, page } = await launch(userData)
  const errors = await page.evaluate(async () => {
    const api = window.lifeUnlocked
    const attempts = [
      () => api.tasks.create({ title: '' }),
      () => api.tasks.create({ title: 'x', path: '/etc/passwd' } as never),
      () => api.tasks.complete('../../etc'),
      () => api.settings.update({ notificationVolume: 5000 })
    ]
    const out: string[] = []
    for (const attempt of attempts) {
      try {
        await attempt()
        out.push('accepted')
      } catch {
        out.push('rejected')
      }
    }
    const task = await api.tasks.create({ title: 'Once' })
    const results = await Promise.all([api.tasks.complete(task.id), api.tasks.complete(task.id)])
    out.push(results.filter((r) => r.unlocked).length === 1 ? 'single-unlock' : 'double-unlock')
    return { out, hasRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined' }
  })
  expect(errors.out).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'single-unlock'])
  expect(errors.hasRequire).toBe(false)
  await app.close()
})

test("an expired countdown shows time's up but does not complete the task", async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-e2e-'))
  const startedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 1,
      settings: { language: 'en' },
      tasks: [
        {
          id: 'expired-1',
          title: 'Submit lab report',
          description: '',
          createdAt: startedAt,
          updatedAt: startedAt,
          completedAt: null,
          status: 'active',
          timerConfig: { kind: 'countdown', durationSec: 3600, startedAt },
          themeOverride: null
        }
      ]
    })
  )
  const { app, page } = await launch(userData)
  await expect(page.getByTestId('countdown')).toHaveText("Time's up")
  await expect(page.getByRole('tab', { name: /Completed/ })).toContainText('0')
  // No achievement: nothing was ever sent to the (preloaded, hidden) notification window, and it never showed.
  const notified = await app.evaluate(({ BrowserWindow }) => {
    const hooks = (globalThis as unknown as { __lifeUnlockedTest: { notifications: () => { active: string | null; shown: unknown[] } } })
      .__lifeUnlockedTest
    const toast = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('notification.html'))
    return { ...hooks.notifications(), visible: toast?.isVisible() ?? false }
  })
  expect(notified).toEqual({ active: null, waitingPreview: null, shown: [], visible: false })
  await page.screenshot({ path: path.join(shots, '14-time-up.png') })
  await app.close()
})
