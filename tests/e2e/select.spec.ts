import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { choose, launch, shots } from './helpers'

/**
 * The shared Select (Phase 6.7): one dropdown everywhere. Keyboard, Esc closing only the list (never
 * the dialog around it), outside click, the value kept after saving and a restart, the list kept inside
 * the window near the bottom of a scrolling dialog, and both appearances.
 */

const DATA = 'life-unlocked-data.json'
const settingsOf = async (userData: string): Promise<Record<string, unknown>> =>
  (JSON.parse(await readFile(path.join(userData, DATA), 'utf8')) as { settings: Record<string, unknown> }).settings

async function seed(userData: string, appearance: 'light' | 'dark'): Promise<void> {
  await writeFile(
    path.join(userData, DATA),
    JSON.stringify({ schemaVersion: 5, tasks: [], completions: [], plans: [], habits: [], habitCheckins: [], settings: { language: 'zh-CN', appearance } }),
    'utf8'
  )
}

const list = (page: Page) => page.getByTestId('select-list')

test('settings and theme selects: keyboard, outside click, saved and kept after a restart', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-select-'))
  await seed(userData, 'dark')
  let { app, page } = await launch(userData)
  await page.locator('aside button', { hasText: '设置' }).click()
  const close = page.getByRole('combobox', { name: '关闭主窗口时' })
  await expect(close).toHaveAttribute('data-value', 'tray')
  await expect(close).toHaveAttribute('aria-expanded', 'false')

  // Mouse: opens with the current value ticked; a click outside closes without a change.
  await close.click()
  await expect(list(page)).toBeVisible()
  await expect(list(page).locator('[aria-selected=true]')).toHaveAttribute('data-value', 'tray')
  await page.mouse.click(5, 300)
  await expect(list(page)).toHaveCount(0)
  await expect(close).toHaveAttribute('data-value', 'tray')

  // Keyboard: Enter opens, arrows move, Enter chooses; focus stays on the button.
  await close.focus()
  await page.keyboard.press('Enter')
  await expect(close).toHaveAttribute('aria-expanded', 'true')
  await expect(close).toHaveAttribute('aria-activedescendant', /.+/)
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(list(page)).toHaveCount(0)
  await expect(close).toHaveAttribute('data-value', 'quit')
  await expect(close).toBeFocused()
  await expect.poll(async () => (await settingsOf(userData)).closeAction).toBe('quit')
  // Space opens, Escape closes without a change.
  await page.keyboard.press(' ')
  await page.keyboard.press('Home')
  await page.keyboard.press('Escape')
  await expect(list(page)).toHaveCount(0)
  await expect(close).toHaveAttribute('data-value', 'quit')

  // Achievement theme options (Custom theme): sound, animation, position.
  await page.locator('nav button', { hasText: '主题' }).click()
  await choose(page, page.getByRole('combobox', { name: '动画' }), 'burst')
  await choose(page, page.getByRole('combobox', { name: '位置' }), 'top-left')
  await expect.poll(async () => ((await settingsOf(userData)).customTheme as { position: string }).position).toBe('top-left')
  await app.close()

  ;({ app, page } = await launch(userData))
  await page.locator('nav button', { hasText: '主题' }).click()
  await expect(page.getByRole('combobox', { name: '动画' })).toHaveAttribute('data-value', 'burst')
  await expect(page.getByRole('combobox', { name: '位置' })).toHaveAttribute('data-value', 'top-left')
  await app.close()
})

for (const appearance of ['light', 'dark'] as const) {
  test(`task dialog (${appearance}): Esc closes only the list; near the bottom the list opens upward inside the window`, async () => {
    const userData = await mkdtemp(path.join(tmpdir(), 'lu-select-dialog-'))
    await seed(userData, appearance)
    const { app, page } = await launch(userData, {}, ['--force-device-scale-factor=1.25'])
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'))?.setSize(900, 560)
    })
    await page.getByRole('button', { name: '新建任务' }).first().click()
    const dialog = page.getByRole('dialog', { name: '新建任务' })
    const theme = dialog.locator('[role=combobox][name=theme]')
    await theme.click()
    await expect(list(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(list(page)).toHaveCount(0)
    await expect(dialog).toBeVisible()

    // The repeat select at the bottom of the scrolled dialog.
    await dialog.getByTestId('advanced-options').locator('summary').click()
    const repeat = dialog.locator('[role=combobox][name=repeat]')
    await repeat.scrollIntoViewIfNeeded()
    await dialog.locator('form').evaluate((form) => {
      const scroller = form.parentElement as HTMLElement
      scroller.scrollTop = scroller.scrollHeight
    })
    await repeat.click()
    await page.waitForTimeout(250)
    const fit = await list(page).evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top >= 0, bottom: r.bottom <= window.innerHeight, right: r.right <= window.innerWidth, left: r.left >= 0 }
    })
    expect(fit).toEqual({ top: true, bottom: true, right: true, left: true })
    // Drawn above the dialog: a click on the last option hits it.
    const last = list(page).getByTestId('select-option').last()
    expect(
      await last.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
      })
    ).toBe(true)
    await page.screenshot({ path: path.join(shots, `select-dialog-${appearance}.png`) })
    await last.click()
    await expect(repeat).toHaveAttribute('data-value', 'custom')
    await expect(dialog).toBeVisible()
    // Type-ahead and arrows on a closed select change nothing until Enter.
    await repeat.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    await expect(repeat).toHaveAttribute('data-value', 'none')
    await app.close()
  })
}
