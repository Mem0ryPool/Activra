import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launch, shots, widgetPage, choose } from './helpers'

const appearanceOf = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => document.documentElement.dataset.appearance)

function completed(id: string, title: string, at: Date): Record<string, unknown> {
  const iso = at.toISOString()
  return {
    id,
    title,
    description: '',
    createdAt: iso,
    updatedAt: iso,
    completedAt: iso,
    status: 'completed',
    timerConfig: null,
    themeOverride: null
  }
}

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

test('app and widget appearance are independent of each other and of the achievement theme', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-appearance-'))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 1,
      settings: { language: 'en', achievementTheme: 'custom' },
      tasks: [completed('x', 'Read 20 pages', new Date())]
    })
  )
  const { app, page } = await launch(userData)
  const before = await page.evaluate(() => window.lifeUnlocked.settings.get())

  // A profile without a saved choice follows the system (and so does this window when the OS changes).
  expect(before.appearance).toBe('system')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => appearanceOf(page)).toBe('dark')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 24, 39)')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => appearanceOf(page)).toBe('light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => appearanceOf(page)).toBe('dark')

  await page.locator('aside').getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'Show desktop widget' }).click()
  const widget = await widgetPage(app)

  // Main window light, widget stays dark.
  await choose(page, page.getByRole('combobox', { name: 'App appearance' }), 'light')
  await expect.poll(() => appearanceOf(page)).toBe('light')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 245, 247)')
  expect(await appearanceOf(widget)).toBe('dark')
  await page.screenshot({ path: path.join(shots, 'p3c-01-settings-light.png') })

  // Widget light, main back to dark: neither overrides the other.
  await choose(page, page.getByRole('combobox', { name: 'Widget appearance' }), 'light')
  await expect.poll(() => appearanceOf(widget)).toBe('light')
  await choose(page, page.getByRole('combobox', { name: 'App appearance' }), 'dark')
  await expect.poll(() => appearanceOf(page)).toBe('dark')
  expect(await appearanceOf(widget)).toBe('light')
  await widget.screenshot({ path: path.join(shots, 'p3c-02-widget-light.png') })

  // Follow system tracks the OS color scheme live.
  await choose(page, page.getByRole('combobox', { name: 'App appearance' }), 'system')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => appearanceOf(page)).toBe('light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => appearanceOf(page)).toBe('dark')
  await widget.getByRole('checkbox').first().isVisible()
  expect(await appearanceOf(widget)).toBe('light')

  // Achievement theme and its options untouched.
  const after = await page.evaluate(() => window.lifeUnlocked.settings.get())
  expect(after.achievementTheme).toBe(before.achievementTheme)
  expect(after.customTheme).toEqual(before.customTheme)
  expect(after.customTheme.animation).toBe('burst')
  expect(after.customTheme.sound).toBe('bright')

  // Light screenshots of the main pages for review.
  await choose(page, page.getByRole('combobox', { name: 'App appearance' }), 'light')
  for (const [name, file] of [
    ['Tasks', 'p3c-03-tasks-light.png'],
    ['Achievements', 'p3c-04-achievements-light.png'],
    ['Themes', 'p3c-05-themes-light.png'],
    ['Statistics', 'p3c-06-statistics-light.png']
  ] as const) {
    await page.locator('aside').getByRole('button', { name }).first().click()
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(shots, file) })
  }
  await page.locator('aside').getByRole('button', { name: 'Tasks' }).click()
  await page.getByRole('button', { name: 'New task' }).first().click()
  await page.screenshot({ path: path.join(shots, 'p3c-07-dialog-light.png') })
  await page.keyboard.press('Escape')
  await app.close()

  // Saved across restarts.
  const again = await launch(userData)
  expect(await appearanceOf(again.page)).toBe('light')
  const w2 = await widgetPage(again.app)
  expect(await appearanceOf(w2)).toBe('light')
  await again.app.close()
})

test('statistics calendar: month view, day details, year heatmap', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-calendar-'))
  const now = new Date()
  const at = (daysAgo: number, h: number, m: number): Date =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m)
  const today1 = at(0, 0, 5)
  const yesterday = at(1, 21, 30)
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10, 9, 15)
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 1,
      settings: { language: 'en' },
      tasks: [
        completed('a', 'Morning run', today1),
        completed('b', 'Finish math homework', new Date(Math.max(today1.getTime() + 60_000, now.getTime() - 60_000))),
        completed('c', 'Call grandma', yesterday),
        completed('d', 'Clean the desk', lastMonth),
        {
          ...completed('e', 'Still going', now),
          status: 'active',
          completedAt: null
        }
      ]
    })
  )
  const { app, page } = await launch(userData)
  await page.locator('aside').getByRole('button', { name: 'Statistics' }).click()

  // The four cards stay, the calendar sits below them.
  await expect(page.getByText('Achievements unlocked', { exact: true })).toBeVisible()
  const calendar = page.getByTestId('activity-calendar')
  await expect(calendar).toBeVisible()

  const todayCell = calendar.locator(`[data-testid=calendar-day][data-day="${dayKey(now)}"]`)
  await expect(todayCell).toHaveAttribute('aria-current', 'date')
  await expect(todayCell).toHaveAttribute('data-count', '2')
  // Today is selected at first and lists its tasks with times.
  await expect(calendar.getByTestId('calendar-task')).toHaveCount(2)
  await expect(calendar.getByTestId('calendar-task').first()).toContainText('Morning run')

  // Yesterday may sit in the previous month's grid.
  const yKey = dayKey(yesterday)
  let yCell = calendar.locator(`[data-testid=calendar-day][data-day="${yKey}"]`)
  if ((await yCell.count()) === 0) {
    await calendar.getByRole('button', { name: 'Previous month' }).click()
    yCell = calendar.locator(`[data-testid=calendar-day][data-day="${yKey}"]`)
  }
  await yCell.click()
  await expect(calendar.getByTestId('calendar-task')).toHaveText([/21:30.*Call grandma|9:30.*Call grandma/])

  // A day without completions is neutral, with a clear empty message.
  await page.locator('aside').getByRole('button', { name: 'Tasks' }).click()
  await page.locator('aside').getByRole('button', { name: 'Statistics' }).click()
  await calendar.getByRole('button', { name: 'Previous month' }).click()
  await expect(calendar.getByTestId('calendar-month')).toContainText(
    new Intl.DateTimeFormat('en', { month: 'long' }).format(lastMonth)
  )
  const lmCell = calendar.locator(`[data-testid=calendar-day][data-day="${dayKey(lastMonth)}"]`)
  await expect(lmCell).toHaveAttribute('data-count', '1')
  const emptyKey = dayKey(new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 11))
  await calendar.locator(`[data-testid=calendar-day][data-day="${emptyKey}"]`).click()
  await expect(calendar.getByTestId('calendar-detail')).toContainText('Nothing completed on this day.')
  await calendar.getByRole('button', { name: 'Next month' }).click()
  await page.screenshot({ path: path.join(shots, 'p3c-08-calendar-month.png') })

  // Future days cannot be opened.
  const tomorrow = calendar.locator(`[data-testid=calendar-day][data-day="${dayKey(at(-1, 0, 0))}"]`)
  if ((await tomorrow.count()) > 0) await expect(tomorrow).toBeDisabled()

  // Year heatmap
  await calendar.getByRole('tab', { name: 'Year' }).click()
  await expect(calendar.getByTestId('year-heatmap')).toBeVisible()
  await expect(calendar).toContainText('4 completed in the last year')
  await expect(calendar.locator(`[data-testid=heatmap-day][data-day="${dayKey(now)}"]`)).toHaveAttribute(
    'data-count',
    '2'
  )
  await calendar.locator(`[data-testid=heatmap-day][data-day="${dayKey(lastMonth)}"]`).click()
  await expect(calendar.getByTestId('calendar-task')).toHaveText([/Clean the desk/])
  await page.screenshot({ path: path.join(shots, 'p3c-09-calendar-year.png') })

  // Completing a task updates the calendar right away.
  await page.evaluate(async () => {
    const t = await window.lifeUnlocked.tasks.list()
    await window.lifeUnlocked.tasks.complete(t.find((x) => x.status === 'active')!.id)
  })
  await expect(calendar.locator(`[data-testid=heatmap-day][data-day="${dayKey(now)}"]`)).toHaveAttribute(
    'data-count',
    '3'
  )
  await app.close()
})
