import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launch, shots, widgetPage, choose } from './helpers'

const pad = (n: number): string => String(n).padStart(2, '0')
const key = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const daysFromToday = (n: number): Date => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12)
}

const readData = async (
  userData: string
): Promise<{ tasks: Record<string, unknown>[]; completions: Record<string, unknown>[] }> =>
  JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8'))

const card = (page: Page, title: string) => page.getByTestId('task-card').filter({ hasText: title })
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name })

test('Create a daily task, complete today in the main window, restore it, and see it in the widget', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-repeat-'))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 2,
      tasks: [],
      completions: [],
      settings: { language: 'en', notificationDurationSec: 3, widget: { visible: true } }
    })
  )
  const { app, page } = await launch(userData)
  const widget = await widgetPage(app)

  await page.getByRole('button', { name: 'New task' }).first().click()
  await page.locator('input[name=title]').fill('Practice piano')
  // The repeat options live in the collapsible "More options" section, reachable by keyboard.
  const advanced = page.getByTestId('advanced-options')
  await expect(advanced).not.toHaveAttribute('open', '')
  await advanced.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(advanced).toHaveAttribute('open', '')
  await choose(page, page.locator('[role=combobox][name=repeat]'), 'daily')
  await expect(page.locator('input[name=timer]')).toBeDisabled()
  await expect(page.locator('input[name=repeat-start]')).toHaveValue(key(new Date()))
  await page.screenshot({ path: path.join(shots, '4b-03-repeat-dialog.png') })
  await page.getByRole('button', { name: 'Save' }).click()

  const piano = card(page, 'Practice piano')
  await expect(piano.getByTestId('repeat-badge')).toHaveText('Every day')
  await expect(widget.getByRole('checkbox', { name: 'Complete "Practice piano"' })).toBeEnabled()
  await expect(widget.getByTestId('widget-task')).toHaveAttribute('data-occurrence', key(new Date()))

  await piano.getByRole('button', { name: 'Complete' }).click()
  await expect(piano.getByTestId('occurrence-state')).toHaveText('Done today')
  await expect(piano.getByRole('button', { name: 'Complete' })).toHaveCount(0)
  // Still in progress as a series; the occurrence is in Completed.
  await expect(tab(page, /In progress/)).toContainText('1')
  await expect(tab(page, /Completed/)).toContainText('1')
  await expect(widget.getByRole('checkbox', { name: '"Practice piano" is completed' })).toBeDisabled()
  await page.screenshot({ path: path.join(shots, '4b-04-repeat-done-today.png') })

  // Restore from the series' menu: today is open again, everywhere.
  await piano.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Restore to not completed' }).click()
  await expect(piano.getByRole('button', { name: 'Complete' })).toBeEnabled()
  await expect(widget.getByRole('checkbox', { name: 'Complete "Practice piano"' })).toBeEnabled()

  // Complete from the widget this time.
  await widget.getByRole('checkbox', { name: 'Complete "Practice piano"' }).click()
  await expect(piano.getByTestId('occurrence-state')).toHaveText('Done today')
  const data = await readData(userData)
  expect(data.tasks[0]).toMatchObject({ status: 'active', recurrence: { preset: 'daily', startDate: key(new Date()) } })
  expect(data.completions.map((e) => [e.occurrence, !!e.undoneAt])).toEqual([
    [key(new Date()), true],
    [key(new Date()), false]
  ])
  await app.close()
})

test('Missed days stay missed, skip only this time, and history survives a restart', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-repeat-missed-'))
  const created = daysFromToday(-3)
  const series = {
    id: 'walk',
    title: 'Evening walk',
    description: '',
    createdAt: created.toISOString(),
    updatedAt: created.toISOString(),
    completedAt: null,
    status: 'active',
    timerConfig: null,
    themeOverride: null,
    recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: key(created), endDate: null },
    recurrenceHistory: [],
    skippedOccurrences: []
  }
  const twoDaysAgo = daysFromToday(-2)
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 2,
      tasks: [series],
      completions: [
        {
          id: 'w1',
          taskId: 'walk',
          occurrence: key(twoDaysAgo),
          completedAt: twoDaysAgo.toISOString(),
          undoneAt: null,
          title: 'Evening walk'
        }
      ],
      settings: { language: 'en', widget: { visible: true } }
    })
  )
  let { app, page } = await launch(userData)
  const widget = await widgetPage(app)

  // Nothing was completed for the missed days, and opening the app did not create any records.
  await expect(card(page, 'Evening walk').getByRole('button', { name: 'Complete' })).toBeEnabled()
  expect((await readData(userData)).completions).toHaveLength(1)

  await page.getByRole('button', { name: 'Statistics' }).click()
  await page.getByRole('tab', { name: 'Year' }).click()
  await expect(page.getByText('Achievements unlocked', { exact: true }).locator('../..')).toContainText('1')
  await page.locator(`[data-testid=heatmap-day][data-day="${key(daysFromToday(-1))}"]`).click()
  await expect(page.getByTestId('calendar-detail')).toContainText('1 not done')
  await expect(page.getByTestId('calendar-missed')).toContainText('Evening walk')
  await page.locator(`[data-testid=heatmap-day][data-day="${key(twoDaysAgo)}"]`).click()
  await expect(page.getByTestId('calendar-task')).toContainText('Evening walk')
  await expect(page.getByTestId('calendar-missed')).toHaveCount(0)
  // Before the task existed: nothing planned, nothing missed.
  await page.locator(`[data-testid=heatmap-day][data-day="${key(daysFromToday(-5))}"]`).click()
  await expect(page.getByTestId('calendar-detail')).toContainText('Nothing completed on this day.')
  await page.getByRole('tab', { name: 'Month' }).click()
  if (daysFromToday(-1).getMonth() === new Date().getMonth()) {
    await expect(page.locator(`[data-testid=calendar-day][data-day="${key(daysFromToday(-1))}"]`)).toHaveAttribute(
      'data-missed',
      '1'
    )
    await expect(page.locator(`[data-testid=calendar-day][data-day="${key(new Date())}"]`)).toHaveAttribute(
      'data-missed',
      '0'
    )
  }
  await page.screenshot({ path: path.join(shots, '4b-05-calendar-missed.png') })

  // Skip only today: no Complete button, gone from the widget, series unchanged.
  await page.getByRole('button', { name: 'Tasks' }).click()
  const walk = card(page, 'Evening walk')
  await walk.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Skip this time' }).click()
  await expect(walk.getByTestId('occurrence-state')).toContainText('Skipped today · Next:')
  await expect(walk.getByRole('button', { name: 'Complete' })).toHaveCount(0)
  await expect(widget.getByTestId('widget-empty')).toBeVisible()
  await app.close()
  ;({ app, page } = await launch(userData))
  const walkAgain = card(page, 'Evening walk')
  await expect(walkAgain.getByTestId('occurrence-state')).toContainText('Skipped today')
  await walkAgain.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Undo skip' }).click()
  await expect(walkAgain.getByRole('button', { name: 'Complete' })).toBeEnabled()
  await app.close()
})

test('Custom repeat: chosen weekdays, an end date, and edits that apply from today', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-repeat-custom-'))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 2, tasks: [], completions: [], settings: { language: 'zh-CN' } })
  )
  const { app, page } = await launch(userData)
  await page.getByRole('button', { name: '新建任务' }).first().click()
  await page.locator('input[name=title]').fill('背单词')
  await page.getByTestId('advanced-options').locator('summary').click()
  await choose(page, page.locator('[role=combobox][name=repeat]'), 'custom')
  await choose(page, page.locator('[role=combobox][name=repeat-unit]'), 'week')
  // No day chosen: a clear message, nothing saved.
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('请至少选择一天。')).toBeVisible()
  const toggles = page.getByTestId('weekday-toggle')
  await toggles.nth(0).click() // Monday
  await toggles.nth(2).click() // Wednesday
  await page.locator('input[name=repeat-interval]').fill('2')
  await choose(page, page.locator('[role=combobox][name=repeat-ends]'), 'on')
  const end = key(daysFromToday(60))
  await page.locator('input[name=repeat-end]').fill(end)
  await expect(page.getByTestId('advanced-options').locator('summary')).toContainText('每 2 周的周一、周三')
  await page.screenshot({ path: path.join(shots, '4b-06-repeat-custom-zh.png') })
  await page.getByRole('button', { name: '保存' }).click()

  const words = card(page, '背单词')
  await expect(words.getByTestId('repeat-badge')).toContainText('每 2 周的周一、周三 至')

  // Edit: the dialog explains that changes apply from today; the saved rule keeps no history yet (created today).
  await words.getByRole('button', { name: /更多操作/ }).click()
  await page.getByRole('menuitem', { name: '编辑' }).click()
  await expect(page.getByTestId('advanced-options')).toHaveAttribute('open', '')
  await expect(page.getByText('修改从今天起生效')).toBeVisible()
  await choose(page, page.locator('[role=combobox][name=repeat]'), 'weekdays')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(words.getByTestId('repeat-badge')).toContainText('每个工作日')
  const data = await readData(userData)
  expect(data.tasks[0]).toMatchObject({ recurrence: { preset: 'weekdays', endDate: end }, recurrenceHistory: [] })
  await app.close()
})
