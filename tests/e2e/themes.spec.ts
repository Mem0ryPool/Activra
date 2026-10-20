import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, notificationPage, shots, choose } from './helpers'
import { createSyntheticMediaFixtures } from './syntheticFixtures'

function desktopShot(file: string): void {
  if (process.platform === 'linux' && process.env['DISPLAY']) {
    execFileSync('import', ['-window', 'root', path.join(shots, file)])
  }
}

/** Replaces the native file picker so the import flow can run unattended. */
async function stubFilePicker(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as typeof dialog.showOpenDialog
  }, filePath)
}

async function shortNotifications(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.lifeUnlocked.settings.update({ notificationDurationSec: 3, language: 'en' })
  })
}

test('theme gallery, preview of all four themes, and per-task override', async () => {
  test.setTimeout(120_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-themes-'))
  const { app, page } = await launch(userData)
  await shortNotifications(page)

  await page.locator('aside').getByRole('button', { name: 'Themes' }).click()
  for (const id of ['classic', 'enhanced', 'legendary', 'custom']) {
    await expect(page.getByTestId(`theme-${id}`)).toBeVisible()
  }
  // Legendary is the default theme
  await expect(page.getByTestId('theme-legendary')).toContainText('In use')
  await page.screenshot({ path: path.join(shots, 'p2-01-themes.png'), fullPage: true })

  // Each preview plays at once, replacing the one before it (no waiting for the old one to end)
  let toast: Page | null = null
  for (const id of ['classic', 'enhanced', 'legendary', 'custom']) {
    await page.getByTestId(`theme-${id}`).getByRole('button', { name: 'Preview' }).click()
    toast ??= await notificationPage(app)
    await expect(toast.getByTestId('achievement-toast')).toHaveAttribute('data-theme', id, { timeout: id === 'classic' ? 8000 : 1500 })
    await expect(toast.getByTestId('achievement-card')).toHaveCount(1)
    await toast.waitForTimeout(700)
    await toast.screenshot({ path: path.join(shots, `p2-toast-${id}.png`) })
    if (id === 'legendary') desktopShot('p2-02-desktop-legendary.png')
  }
  if (!toast) throw new Error('No notification window')
  // The notification window never took focus from the main window
  const focus = await app.evaluate(({ BrowserWindow }) => {
    const toastWin = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('notification.html'))!
    return { toastFocused: toastWin.isFocused(), focusable: toastWin.isFocusable() }
  })
  expect(focus).toEqual({ toastFocused: false, focusable: false })

  // Switch the global theme
  await page.getByTestId('theme-classic').getByRole('button', { name: 'Use' }).click()
  await expect(page.getByTestId('theme-classic')).toContainText('In use')
  await expect(toast.getByTestId('achievement-toast')).toHaveCount(0, { timeout: 8000 }).catch(() => undefined)
  await page.getByRole('button', { name: 'Test achievement' }).click()
  await expect(toast.getByTestId('achievement-toast')).toHaveAttribute('data-theme', 'classic', { timeout: 8000 })

  // A task that overrides the global (Classic) theme with Legendary
  await page.locator('aside').getByRole('button', { name: 'Tasks' }).click()
  await page.getByRole('button', { name: 'New task' }).first().click()
  await page.locator('input[name=title]').fill('Ship the GitHub project')
  await choose(page, page.locator('[role=combobox][name=theme]'), 'legendary')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'p2-03-task-theme.png') })
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('theme-badge')).toHaveText('Legendary')
  await page.waitForTimeout(3500)
  await page.getByRole('button', { name: /^Complete$/ }).click()
  await expect(toast.getByTestId('achievement-toast')).toHaveAttribute('data-theme', 'legendary', { timeout: 8000 })
  await expect(toast.getByTestId('achievement-card')).toContainText('Ship the GitHub project')

  // Theme choice persists across restarts
  await app.close()
  const second = await launch(userData)
  const settings = await second.page.evaluate(() => window.lifeUnlocked.settings.get())
  expect(settings.achievementTheme).toBe('classic')
  await second.app.close()
})

test('custom theme options and imported icon and sound', async () => {
  test.setTimeout(90_000)
  const fixtures = await createSyntheticMediaFixtures()
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-custom-'))
  const { app, page } = await launch(userData)
  await shortNotifications(page)
  await page.locator('aside').getByRole('button', { name: 'Themes' }).click()

  // Rejected import: a WAV offered as an icon
  await stubFilePicker(app, fixtures.sound)
  await page.getByRole('button', { name: 'Import image' }).click()
  await expect(page.getByText('That file type is not supported.')).toBeVisible()

  // Icon import
  await stubFilePicker(app, fixtures.icon)
  await page.getByRole('button', { name: 'Import image' }).click()
  await expect(page.getByRole('radio', { name: 'Imported image' })).toHaveAttribute('aria-checked', 'true')
  // Sound import
  await stubFilePicker(app, fixtures.sound)
  await page.getByRole('button', { name: 'Import audio' }).click()
  await expect(page.getByRole('combobox', { name: 'Sound' })).toHaveAttribute('data-value', 'imported')

  // Other options
  await page.getByRole('button', { name: '#ec4899' }).click()
  await choose(page, page.getByRole('combobox', { name: 'Animation' }), 'burst')
  await choose(page, page.getByRole('combobox', { name: 'Position' }), 'top-left')
  await page.getByTestId('theme-custom').getByRole('button', { name: 'Use' }).click()

  const settings = await page.evaluate(() => window.lifeUnlocked.settings.get())
  expect(settings.customTheme).toMatchObject({
    icon: 'imported',
    sound: 'imported',
    accentColor: '#ec4899',
    animation: 'burst',
    position: 'top-left'
  })
  // Files were copied into the app's own folder; the page never saw a path
  expect((await readdir(path.join(userData, 'assets'))).sort()).toEqual(
    [settings.customTheme.iconAssetId, settings.customTheme.soundAssetId].sort()
  )
  await page.screenshot({ path: path.join(shots, 'p2-04-custom-editor.png'), fullPage: true })

  await page.getByRole('button', { name: 'Test achievement' }).click()
  const toast = await notificationPage(app)
  await expect(toast.getByTestId('achievement-toast')).toHaveAttribute('data-theme', 'custom')
  // Imported icon actually loads through the app's asset protocol
  await expect
    .poll(() => toast.locator('.ach-icon-img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(64)
  const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('notification.html'))!
    return { b: w.getBounds(), area: screen.getPrimaryDisplay().workArea }
  })
  expect(bounds.b.x).toBe(bounds.area.x)
  expect(bounds.b.y).toBe(bounds.area.y)
  await toast.waitForTimeout(700)
  await toast.screenshot({ path: path.join(shots, 'p2-toast-custom-imported.png') })
  desktopShot('p2-05-desktop-custom-top-left.png')

  // A page cannot fetch arbitrary files through the asset protocol
  const probe = await page.evaluate(async () => {
    const tries = ['lu-asset://asset/../../etc/passwd', 'lu-asset://other/x.png', 'lu-asset://asset/notes.txt']
    return Promise.all(tries.map((u) => fetch(u).then((r) => r.status).catch(() => 'error')))
  })
  for (const result of probe) expect(result === 404 || result === 'error').toBe(true)

  await app.close()
})
