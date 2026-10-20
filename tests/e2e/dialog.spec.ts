import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, shots, choose } from './helpers'

type TitleBar = { modalOpen: boolean; colors: { color: string; symbolColor: string } | null }
const titleBar = (app: ElectronApplication): Promise<TitleBar> =>
  app.evaluate(() => (globalThis as unknown as { __lifeUnlockedTest: { titleBar: () => TitleBar } }).__lifeUnlockedTest.titleBar())

const mainWindowFacts = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html')) as Electron.BrowserWindow
    return {
      closable: w.isClosable(),
      minimizable: w.isMinimizable(),
      maximizable: w.isMaximizable(),
      resizable: w.isResizable(),
      movable: w.isMovable()
    }
  })

const appRegion = (page: Page, selector: string): Promise<string> =>
  page.evaluate((s) => getComputedStyle(document.querySelector(s) as Element).getPropertyValue('-webkit-app-region'), selector)

/** The whole X screen, including the title bar buttons Electron draws itself on Linux. Best effort. */
function screenGrab(file: string): void {
  try {
    execFileSync('import', ['-window', 'root', file], { stdio: 'ignore', timeout: 10_000 })
  } catch {
    // ImageMagick or a display may be missing; the screenshot is only for the report.
  }
}

const readData = async (userData: string): Promise<{ tasks: Record<string, unknown>[] }> =>
  JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8'))

async function profile(appearance: 'light' | 'dark', tasks: unknown[] = []): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-dialog-'))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 2, tasks, completions: [], settings: { language: 'zh-CN', appearance } })
  )
  return userData
}

const existing = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '晨跑',
  description: '公园两圈',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  completedAt: null,
  status: 'active',
  timerConfig: null,
  themeOverride: 'legendary',
  recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: '2026-10-01', endDate: null },
  due: { date: null, time: '07:30' },
  reminderMinutes: 15
}

for (const appearance of ['light', 'dark'] as const) {
  test(`dialogs dim the title bar buttons and keep the window controls working (${appearance})`, async () => {
    const userData = await profile(appearance, [existing])
    const { app, page } = await launch(userData)
    const normal = await titleBar(app)
    expect(normal.modalOpen).toBe(false)
    const before = await mainWindowFacts(app)

    // New task
    await page.getByRole('button', { name: '新建任务' }).first().click()
    await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible()
    await expect.poll(async () => (await titleBar(app)).modalOpen).toBe(true)
    const dimmed = (await titleBar(app)).colors
    expect(dimmed?.color).toBe(appearance === 'light' ? '#6e6e6f' : '#080b12')
    // The window keeps all its controls while the dialog is open, and the top strip still drags the window.
    expect(await mainWindowFacts(app)).toEqual(before)
    expect(await appRegion(page, '[data-testid=dialog-drag-strip]')).toBe('drag')
    expect(await appRegion(page, '[role=dialog]')).toBe('no-drag')
    const strip = await page.getByTestId('dialog-drag-strip').boundingBox()
    const panel = await page.getByRole('dialog').boundingBox()
    expect(strip && panel && panel.y >= strip.y + strip.height).toBe(true)
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(shots, `hotfix-01-scrim-${appearance}.png`) })
    screenGrab(path.join(shots, `hotfix-02-screen-${appearance}.png`))
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(async () => (await titleBar(app)).modalOpen).toBe(false)
    expect((await titleBar(app)).colors).toEqual(
      appearance === 'light' ? { color: '#f4f5f7', symbolColor: '#4b5563' } : { color: '#111827', symbolColor: '#9CA3AF' }
    )

    // Edit task and delete confirmation use the same dialog.
    const card = page.getByTestId('task-card').filter({ hasText: '晨跑' })
    await card.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menuitem', { name: '编辑' }).click()
    await expect(page.getByRole('dialog', { name: '编辑任务' })).toBeVisible()
    await expect.poll(async () => (await titleBar(app)).modalOpen).toBe(true)
    await page.getByRole('button', { name: '取消' }).click()
    await expect.poll(async () => (await titleBar(app)).modalOpen).toBe(false)

    await card.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect.poll(async () => (await titleBar(app)).modalOpen).toBe(true)
    // Clicking the scrim closes it, as before.
    await page.mouse.click(20, 300)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(async () => (await titleBar(app)).modalOpen).toBe(false)

    // A reload with a dialog open does not leave the title bar dimmed.
    await page.getByRole('button', { name: '新建任务' }).first().click()
    await expect.poll(async () => (await titleBar(app)).modalOpen).toBe(true)
    await page.reload()
    await page.waitForSelector('nav')
    await expect.poll(async () => (await titleBar(app)).modalOpen).toBe(false)
    await app.close()
  })
}

test('saving without a name scrolls to the name field, focuses it and keeps everything else', async () => {
  const userData = await profile('light')
  const { app, page } = await launch(userData)
  await page.getByRole('button', { name: '新建任务' }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建任务' })
  const title = dialog.locator('input[name=title]')

  await dialog.locator('textarea[name=description]').fill('每天读 20 页')
  await choose(page, dialog.locator('[role=combobox][name=theme]'), 'legendary')
  await dialog.getByTestId('advanced-options').locator('summary').click()
  await choose(page, dialog.locator('[role=combobox][name=repeat]'), 'weekly')
  await dialog.locator('input[name=due]').check()
  await dialog.locator('input[name=due-time]').fill('21:00')
  // Scroll to the bottom, as a user would to reach the last fields.
  await dialog.locator('form').evaluate((form) => {
    const scroller = form.parentElement as HTMLElement
    scroller.scrollTop = scroller.scrollHeight
  })
  await expect(title).not.toBeInViewport()
  const heightBefore = (await dialog.boundingBox())?.height

  await dialog.getByRole('button', { name: '保存' }).click()
  const error = dialog.getByTestId('title-error')
  await expect(error).toHaveText('请输入任务名称')
  await expect(error).toBeInViewport()
  await expect(title).toBeInViewport()
  await expect(title).toBeFocused()
  await expect(title).toHaveAttribute('aria-invalid', 'true')
  await expect(title).toHaveAttribute('aria-describedby', 'task-title-error')
  // Nothing moved or was lost, and nothing was saved.
  expect((await dialog.boundingBox())?.height).toBe(heightBefore)
  await expect(dialog.locator('textarea[name=description]')).toHaveValue('每天读 20 页')
  await expect(dialog.locator('[role=combobox][name=theme]')).toHaveAttribute('data-value', 'legendary')
  await expect(dialog.locator('[role=combobox][name=repeat]')).toHaveAttribute('data-value', 'weekly')
  await expect(dialog.locator('input[name=due-time]')).toHaveValue('21:00')
  await expect(page.getByTestId('task-card')).toHaveCount(0)
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'hotfix-03-title-error-light.png') })

  // Spaces are still not a name.
  await title.fill('   ')
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(error).toBeVisible()
  await expect(page.getByTestId('task-card')).toHaveCount(0)

  // A real name clears the error right away.
  await title.fill('读书')
  await expect(error).toHaveCount(0)
  await expect(title).toHaveAttribute('aria-invalid', 'false')

  // Enter goes through the same check.
  await title.fill('')
  await title.press('Enter')
  await expect(error).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('task-card')).toHaveCount(0)

  await title.fill('读书')
  await title.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('task-card').filter({ hasText: '读书' })).toHaveCount(1)
  const data = await readData(userData)
  expect(data.tasks).toHaveLength(1)
  expect(data.tasks[0]).toMatchObject({
    title: '读书',
    description: '每天读 20 页',
    themeOverride: 'legendary',
    recurrence: { preset: 'weekly' },
    due: { date: null, time: '21:00' }
  })
  await app.close()
})

test('editing a task: clearing the name shows the same error and changes nothing (dark)', async () => {
  const userData = await profile('dark', [existing])
  const { app, page } = await launch(userData)
  const card = page.getByTestId('task-card').filter({ hasText: '晨跑' })
  await card.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '编辑' }).click()
  const dialog = page.getByRole('dialog', { name: '编辑任务' })
  const title = dialog.locator('input[name=title]')
  await title.fill('  ')
  await dialog.locator('form').evaluate((form) => {
    const scroller = form.parentElement as HTMLElement
    scroller.scrollTop = scroller.scrollHeight
  })
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog.getByTestId('title-error')).toHaveText('请输入任务名称')
  await expect(title).toBeInViewport()
  await expect(title).toBeFocused()
  await expect(dialog.locator('[role=combobox][name=repeat]')).toHaveAttribute('data-value', 'daily')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'hotfix-04-title-error-edit-dark.png') })
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(1)
  const data = await readData(userData)
  expect(data.tasks[0]).toMatchObject({ title: '晨跑', description: '公园两圈' })
  await app.close()
})
