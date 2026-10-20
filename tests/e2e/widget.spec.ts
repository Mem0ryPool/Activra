import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, notificationPage, shots, widgetPage, widgetWindow, choose } from './helpers'

function desktopShot(file: string): void {
  if (process.platform === 'linux' && process.env['DISPLAY']) {
    execFileSync('import', ['-window', 'root', path.join(shots, file)])
  }
}

const hoursAgo = (h: number): string => new Date(Date.now() - h * 3600 * 1000).toISOString()

function seedTask(
  id: string,
  title: string,
  createdAt: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
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
    ...extra
  }
}

async function seed(userData: string, tasks: Record<string, unknown>[]): Promise<void> {
  // Short toasts keep the test quick; language fixed so labels are predictable.
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 1, settings: { language: 'en', notificationDurationSec: 3 }, tasks })
  )
}

async function readData(
  userData: string
): Promise<{ tasks: { id: string; status: string }[]; settings: { widget: unknown } }> {
  return JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8'))
}

/**
 * Records native window opacity calls. Linux ignores setOpacity (getOpacity stays 1),
 * so the tests check what the app asked for; Windows/macOS read the real value.
 */
async function spyOnOpacity(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const g = globalThis as unknown as { __opacity: number[] }
    g.__opacity = []
    const original = BrowserWindow.prototype.setOpacity
    BrowserWindow.prototype.setOpacity = function (this: Electron.BrowserWindow, value: number) {
      g.__opacity.push(value)
      return original.call(this, value)
    }
  })
}

function lastOpacity(app: ElectronApplication): Promise<number | undefined> {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(
      (x) => !x.isDestroyed() && !x.webContents.isDestroyed() && x.webContents.getURL().includes('widget.html')
    )
    if (w && process.platform !== 'linux') return w.getOpacity()
    return (globalThis as unknown as { __opacity: number[] }).__opacity.at(-1)
  })
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('aside').getByRole('button', { name: 'Settings' }).click()
}

async function waitForWidgetClosed(app: ElectronApplication): Promise<void> {
  await expect.poll(() => widgetWindow(app)).toBeNull()
}

test('desktop widget: open, show today, complete in sync, settings, close and reopen', async () => {
  test.setTimeout(120_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-widget-'))
  // Midnight-safe: "yesterday" is clearly before today's local midnight, "today" is now.
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(12, 0, 0, 0)
  await seed(userData, [
    seedTask('read', 'Read 20 pages', hoursAgo(5)),
    seedTask('gym', 'Go to the gym', hoursAgo(1)),
    seedTask('lab', 'Submit lab report', hoursAgo(3), {
      timerConfig: { kind: 'countdown', durationSec: 3600, startedAt: hoursAgo(3) }
    }),
    seedTask('run', 'Morning run', hoursAgo(10), { status: 'completed', completedAt: new Date().toISOString() }),
    seedTask('old', 'Old win', hoursAgo(48), { status: 'completed', completedAt: yesterday.toISOString() })
  ])
  const first = await launch(userData)
  const page = first.page
  let app = first.app
  await spyOnOpacity(app)

  // Hidden by default
  expect(await widgetWindow(app)).toBeNull()

  // Show it from Settings
  await openSettings(page)
  const visibleSwitch = page.getByRole('switch', { name: 'Show desktop widget' })
  await expect(visibleSwitch).toHaveAttribute('aria-checked', 'false')
  await visibleSwitch.click()
  const widget = await widgetPage(app)
  await expect(visibleSwitch).toHaveAttribute('aria-checked', 'true')

  const info = await widgetWindow(app)
  expect(info).not.toBeNull()
  expect(info!.visible).toBe(true)
  expect(info!.bounds.width).toBe(320)
  expect(info!.bounds.height).toBe(420)
  expect(info!.alwaysOnTop).toBe(false)
  expect(info!.resizable).toBe(false)
  expect(info!.menuBarVisible).toBe(false)
  await expect(widget.getByTestId('widget-drag-handle')).toHaveCSS('-webkit-app-region', 'drag')
  await expect(widget.getByRole('button', { name: 'Close widget' })).toHaveCSS('-webkit-app-region', 'no-drag')

  // Today: active tasks newest first, then today's completed ones; yesterday's win is not shown.
  await expect(widget.getByTestId('widget-task')).toHaveText([
    'Go to the gym',
    /Submit lab report.*Time's up/,
    'Read 20 pages',
    'Morning run'
  ])
  await expect(widget.getByTestId('widget-progress')).toHaveText('1 of 4 done')
  await expect(widget.getByRole('checkbox', { name: 'Complete "Go to the gym"' })).toHaveAttribute(
    'aria-checked',
    'false'
  )
  await expect(widget.getByRole('checkbox', { name: '"Morning run" is completed' })).toBeDisabled()

  // The expired countdown never completes the task by itself.
  await widget.waitForTimeout(1500)
  await expect(widget.getByTestId('widget-task').filter({ hasText: 'Submit lab report' })).toHaveAttribute(
    'data-status',
    'active'
  )
  await page.locator('html').evaluate(() => document.fonts.ready)
  await widget.screenshot({ path: path.join(shots, 'p3-01-widget.png') })

  // Complete from the widget with a double click: one unlock, toast shown, main window in sync.
  await page.locator('aside').getByRole('button', { name: 'Tasks' }).click()
  await expect(page.getByRole('tab', { name: /In progress/ })).toContainText('3')
  await widget.getByRole('checkbox', { name: 'Complete "Go to the gym"' }).dblclick()
  const toast = await notificationPage(app)
  await expect(toast.getByTestId('achievement-toast')).toContainText('Go to the gym')
  await expect(widget.getByTestId('widget-progress')).toHaveText('2 of 4 done')
  await expect(widget.getByRole('checkbox', { name: '"Go to the gym" is completed' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await expect(page.getByRole('tab', { name: /In progress/ })).toContainText('2')
  await expect(page.getByRole('tab', { name: /Completed/ })).toContainText('3')
  await page.waitForTimeout(500)
  desktopShot('p3-02-desktop-widget-toast.png')

  // Persisted
  await expect.poll(async () => (await readData(userData)).tasks.find((x) => x.id === 'gym')?.status).toBe('completed')

  // Concurrent completion requests from the widget still unlock only once.
  const unlocks = await widget.evaluate(async () => {
    const api = window.lifeUnlockedWidget
    const results = await Promise.all([api.tasks.complete('read'), api.tasks.complete('read')])
    return results.filter((r) => r.unlocked).length
  })
  expect(unlocks).toBe(1)
  await expect(widget.getByTestId('widget-progress')).toHaveText('3 of 4 done')

  // Completing in the main window updates the widget.
  await page
    .getByTestId('task-card')
    .filter({ hasText: 'Submit lab report' })
    .getByRole('button', { name: 'Complete' })
    .click()
  await expect(widget.getByTestId('widget-progress')).toHaveText('4 of 4 done')

  // The widget API is narrower than the main window's.
  const surface = await widget.evaluate(() => ({
    hasMainApi: 'lifeUnlocked' in window,
    hasRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
    taskMethods: Object.keys(window.lifeUnlockedWidget.tasks).sort()
  }))
  expect(surface).toEqual({
    hasMainApi: false,
    hasRequire: false,
    taskMethods: ['complete', 'list', 'onChanged', 'snapshot', 'undoCompletion']
  })

  // Always on top and window opacity
  await openSettings(page)
  await page.getByRole('switch', { name: 'Always on top' }).click()
  await expect.poll(async () => (await widgetWindow(app))?.alwaysOnTop).toBe(true)
  await page.evaluate(async () => {
    const s = await window.lifeUnlocked.settings.get()
    await window.lifeUnlocked.settings.update({ widget: { ...s.widget, opacity: 70 } })
  })
  await expect.poll(() => lastOpacity(app)).toBe(0.7)
  await page.getByRole('heading', { name: 'Desktop widget' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(shots, 'p3-04-settings.png') })
  desktopShot('p3-05-desktop-settings.png')

  // Close from the widget: the app keeps running and the setting follows.
  await widget.getByRole('button', { name: 'Close widget' }).click()
  await waitForWidgetClosed(app)
  await expect(page.getByRole('switch', { name: 'Show desktop widget' })).toHaveAttribute('aria-checked', 'false')
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.isVisible() && w.webContents.getURL().includes('index.html'))
    )
  ).toBe(true)

  // Reopen from the Tasks page button; it keeps its settings.
  await page.locator('aside').getByRole('button', { name: 'Tasks' }).click()
  await page.getByRole('button', { name: 'Show desktop widget' }).click()
  await widgetPage(app)
  expect((await widgetWindow(app))?.alwaysOnTop).toBe(true)
  await expect.poll(() => lastOpacity(app)).toBe(0.7)

  // Position memory across restarts
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('widget.html'))!
      .setPosition(100, 200)
  })
  await page.waitForTimeout(800)
  await app.close()
  ;({ app } = await launch(userData))
  await widgetPage(app)
  const restored = await widgetWindow(app)
  expect(restored?.bounds).toMatchObject({ x: 100, y: 200, width: 320, height: 420 })
  expect(restored?.alwaysOnTop).toBe(true)
  await app.close()

  // A position on a monitor that no longer exists falls back to the primary display.
  await writeFile(
    path.join(userData, 'widget-state.json'),
    JSON.stringify({ x: 5000, y: 3000, width: 320, height: 420 })
  )
  ;({ app } = await launch(userData))
  await widgetPage(app)
  const fallback = await widgetWindow(app)
  const workArea = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
  expect(fallback!.bounds.x).toBeGreaterThanOrEqual(workArea.x)
  expect(fallback!.bounds.y).toBeGreaterThanOrEqual(workArea.y)
  expect(fallback!.bounds.x + fallback!.bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width)
  expect(fallback!.bounds.y + fallback!.bounds.height).toBeLessThanOrEqual(workArea.y + workArea.height)
  await app.close()
})

test('widget empty state; closing the window natively; closing the main window with "quit" set', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-widget-'))
  await seed(userData, [])
  const { app, page } = await launch(userData)
  await page.evaluate(async () => {
    const s = await window.lifeUnlocked.settings.get()
    await window.lifeUnlocked.settings.update({ language: 'zh-CN', widget: { ...s.widget, visible: true } })
  })
  const widget = await widgetPage(app)
  await expect(widget.getByTestId('widget-empty')).toContainText('今天没有任务')
  await expect(widget.getByTestId('widget-progress')).toHaveCount(0)
  await widget.screenshot({ path: path.join(shots, 'p3-03-widget-empty-zh.png') })

  // A task created in the main window appears in the widget.
  await page.evaluate(() => window.lifeUnlocked.tasks.create({ title: '背单词' }))
  await expect(widget.getByTestId('widget-task')).toHaveText(['背单词'])
  await expect(widget.getByTestId('widget-progress')).toHaveText('已完成 0 / 1')

  // Turning it off and straight back on leaves exactly one open widget.
  await page.evaluate(async () => {
    const s = await window.lifeUnlocked.settings.get()
    void window.lifeUnlocked.settings.update({ widget: { ...s.widget, visible: false } })
    await window.lifeUnlocked.settings.update({ widget: { ...s.widget, visible: true } })
  })
  await expect
    .poll(() =>
      app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().filter(
            (w) => !w.isDestroyed() && w.webContents.getURL().includes('widget.html')
          ).length
      )
    )
    .toBe(1)
  await page.waitForTimeout(300)
  expect(await widgetWindow(app)).not.toBeNull()

  // Alt+F4 / taskbar close behaves like the close button.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('widget.html'))!
      .close()
  })
  await waitForWidgetClosed(app)
  await expect.poll(async () => (await readData(userData)).settings.widget).toMatchObject({ visible: false })
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible')

  // With "quit the app" on close and the widget open, closing the main window quits the whole app,
  // and the widget is remembered as visible for next time. (The tray default is covered in tray.spec.ts.)
  await page.evaluate(async () => {
    const s = await window.lifeUnlocked.settings.get()
    await window.lifeUnlocked.settings.update({ closeAction: 'quit', widget: { ...s.widget, visible: true } })
  })
  await widgetPage(app)
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('index.html'))!
      .close()
  })
  await exited
  expect((await readData(userData)).settings.widget).toMatchObject({ visible: true })
})

test('widget appearance: shape, opacity preview, animation, saved across restarts', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-widget-'))
  // A file written by Phase 3A: opacity from the old range, no shape or animation yet.
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 1,
      settings: {
        language: 'en',
        achievementTheme: 'custom',
        widget: { visible: true, alwaysOnTop: false, opacity: 40 }
      },
      tasks: [seedTask('a', 'Stretch for 10 minutes', hoursAgo(1))]
    })
  )
  let { app, page } = await launch(userData)
  await spyOnOpacity(app)
  let widget = await widgetPage(app)

  // Migrated: kept visible, opacity clamped into the new range, defaults for the new options.
  await openSettings(page)
  await expect(page.getByRole('combobox', { name: 'Corners' })).toHaveAttribute('data-value', 'rounded')
  await expect(page.getByRole('combobox', { name: 'Widget animation' })).toHaveAttribute('data-value', 'fade')
  await expect(page.getByRole('slider', { name: 'Opacity' })).toHaveValue('60')
  expect(await page.evaluate(() => window.lifeUnlocked.settings.get().then((s) => s.achievementTheme))).toBe('custom')

  // Rounded by default; the panel clips its content and the window around it stays transparent.
  const panel = widget.getByTestId('widget-panel')
  await expect(panel).toHaveAttribute('data-shape', 'rounded')
  await expect(panel).toHaveCSS('border-top-left-radius', '12px')
  await expect(panel).toHaveCSS('overflow', 'hidden')
  expect(await widget.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  await expect(panel).toHaveAttribute('data-phase', 'shown')

  await choose(page, page.getByRole('combobox', { name: 'Corners' }), 'square')
  await expect(panel).toHaveCSS('border-top-left-radius', '0px')
  await widget.screenshot({ path: path.join(shots, 'p3b-01-square.png') })

  // Opacity: live preview while dragging (not saved), saved on release.
  const slider = page.getByRole('slider', { name: 'Opacity' })
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => lastOpacity(app)).toBe(0.62)
  await page.keyboard.up('ArrowRight')
  await expect
    .poll(() => page.evaluate(() => window.lifeUnlocked.settings.get().then((s) => s.widget.opacity)))
    .toBe(62)
  await slider.fill('100')
  await slider.dispatchEvent('pointerup')
  await expect.poll(() => lastOpacity(app)).toBe(1)
  expect(
    await page.evaluate(() =>
      window.lifeUnlocked.widget.previewOpacity(5).then(
        () => 'ok',
        () => 'rejected'
      )
    )
  ).toBe('rejected')

  // Each animation applies to the page; hiding waits for the exit transition before the window closes.
  for (const anim of ['none', 'fade', 'slide', 'scale', 'smooth']) {
    await choose(page, page.getByRole('combobox', { name: 'Widget animation' }), anim)
    await expect(panel).toHaveAttribute('data-anim', anim)
  }
  const started = Date.now()
  await widget.getByRole('button', { name: 'Close widget' }).click()
  await expect(panel).toHaveAttribute('data-phase', 'hidden')
  await expect.poll(() => widgetWindow(app)).toBeNull()
  expect(Date.now() - started).toBeGreaterThanOrEqual(280)

  // Show again: it enters with the transition and ends fully visible.
  await page.getByRole('switch', { name: 'Show desktop widget' }).click()
  widget = await widgetPage(app)
  await expect(widget.getByTestId('widget-panel')).toHaveAttribute('data-phase', 'shown')
  await expect(widget.getByTestId('widget-panel')).toHaveCSS('opacity', '1')

  // Ticking a task while the animation is on is not blocked.
  await widget.getByRole('checkbox', { name: 'Complete "Stretch for 10 minutes"' }).click()
  await expect(widget.getByTestId('widget-progress')).toHaveText('1 of 1 done')
  await page.getByRole('switch', { name: 'Always on top' }).click()
  await expect.poll(async () => (await widgetWindow(app))?.alwaysOnTop).toBe(true)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('widget.html'))!
      .setPosition(300, 150)
  })
  await page.waitForTimeout(800)
  await app.close()

  // Everything comes back after a restart.
  ;({ app, page } = await launch(userData))
  widget = await widgetPage(app)
  await expect(widget.getByTestId('widget-panel')).toHaveAttribute('data-shape', 'square')
  await expect(widget.getByTestId('widget-panel')).toHaveAttribute('data-anim', 'smooth')
  const restored = await widgetWindow(app)
  expect(restored?.bounds).toMatchObject({ x: 300, y: 150 })
  expect(restored?.alwaysOnTop).toBe(true)
  const saved = await page.evaluate(() => window.lifeUnlocked.settings.get().then((s) => s.widget))
  expect(saved).toEqual({
    visible: true,
    alwaysOnTop: true,
    opacity: 100,
    shape: 'square',
    animation: 'smooth',
    appearance: 'dark'
  })
  await app.close()
})

test('widget honours reduced motion', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-widget-'))
  await seed(userData, [])
  const { app, page } = await launch(userData)
  await page.evaluate(async () => {
    const s = await window.lifeUnlocked.settings.get()
    await window.lifeUnlocked.settings.update({ widget: { ...s.widget, visible: true, animation: 'smooth' } })
  })
  const widget = await widgetPage(app)
  await widget.emulateMedia({ reducedMotion: 'reduce' })
  await expect(widget.getByTestId('widget-panel')).toHaveCSS('transition-duration', '0s')
  await widget.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(widget.getByTestId('widget-panel')).toHaveCSS('transition-duration', '0.28s')
  await app.close()
})
