import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, root } from './helpers'

// Written by the Windows-validated Phase 5 build (see tests/unit/upgradeFromPhase5.test.ts).
const OLD_DATA = path.join(root, 'tests', 'unit', 'fixtures', 'phase5-v2-data.json')

test('the window, sidebar and settings show the Activra name and tagline', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-brand-'))
  const { app, page } = await launch(userData)
  expect(await page.title()).toBe('Activra')
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()))).toContain('Activra')
  expect(await app.evaluate(({ app: electronApp }) => electronApp.getName())).toBe('Activra')
  await expect(page.locator('aside')).toContainText('Activra')
  // The sidebar logo is the Activra icon and actually loads (CSP allows it, the file is in the build).
  expect(await page.locator('aside img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0)
  await expect(page.locator('body')).not.toContainText('Life Unlocked')
  await page.getByRole('button', { name: /Settings|设置/ }).click()
  await expect(page.getByText(/Action · Progress · Achievement|行动 · 推进 · 成就/)).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Life Unlocked')
  await app.close()
})

// Electron takes the app-data folder from XDG_CONFIG_HOME on Linux, so the real default path can be
// pointed at a temporary folder there. On Windows it is always the user's %APPDATA%, which a test must
// never touch; the folder name itself is checked by the unit test of resolveUserDataDir.
test('without a test profile, data is read from and kept in the old "Life Unlocked" folder', async () => {
  test.skip(process.platform !== 'linux', 'Only Linux lets the default app-data folder be redirected safely')
  const appData = await mkdtemp(path.join(tmpdir(), 'lu-appdata-'))
  const oldFolder = path.join(appData, 'Life Unlocked')
  const original = await readFile(OLD_DATA, 'utf8')
  await mkdir(oldFolder, { recursive: true })
  await writeFile(path.join(oldFolder, 'life-unlocked-data.json'), original)

  // The installed app's path: an unpackaged run needs the explicit opt-in (otherwise it uses "Life Unlocked Dev").
  const { app, page } = await launch('', { LIFE_UNLOCKED_USER_DATA: '', LIFE_UNLOCKED_USE_PRODUCTION_DATA: '1', XDG_CONFIG_HOME: appData })
  expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(oldFolder)
  await expect(page.getByTestId('task-card').filter({ hasText: '背单词' })).toBeVisible()
  await app.close()

  // Nothing was created under the new name, and the old file was upgraded in place with its copy kept.
  expect(await readdir(appData)).toEqual(['Life Unlocked'])
  const files = await readdir(oldFolder)
  expect(files).toContain('life-unlocked-data.json')
  expect(await readFile(path.join(oldFolder, 'life-unlocked-data.v2-backup.json'), 'utf8')).toBe(original)
  const saved = JSON.parse(await readFile(path.join(oldFolder, 'life-unlocked-data.json'), 'utf8')) as { tasks: { title: string }[] }
  expect(saved.tasks.map((t) => t.title)).toEqual(expect.arrayContaining(['读完一本书', '交报告', '背单词']))
})
