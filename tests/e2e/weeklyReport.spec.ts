import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, shots } from './helpers'

/**
 * Phase 6.8 weekly report: Statistics → 周报 shows this week's numbers from the stored records only,
 * browses back a week (never forward past this week), copies plain text, and changes no data.
 */

const pad = (n: number): string => String(n).padStart(2, '0')
const key = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monday = (offsetWeeks = 0): Date => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offsetWeeks * 7)
  return d
}
const day = (base: Date, plus: number, hour = 12): Date => {
  const d = new Date(base)
  d.setDate(d.getDate() + plus)
  d.setHours(hour, 0, 0, 0)
  return d
}

const task = (id: string, title: string) => ({
  id,
  title,
  description: '',
  createdAt: day(monday(-2), 0).toISOString(),
  updatedAt: day(monday(-2), 0).toISOString(),
  completedAt: null,
  status: 'active',
  timerConfig: null,
  themeOverride: null,
  recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: key(monday(-2)), endDate: null },
  recurrenceHistory: [],
  skippedOccurrences: [],
  due: null,
  reminderMinutes: null,
  window: null
})

test('周报: this week from records, last week, copy, light and dark; nothing is written', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-weekly-'))
  const thisMon = monday(0)
  const lastMon = monday(-1)
  // This week: Monday only (it may be the only day that has passed), 2 completions + 1 undone.
  const completions = [
    { id: 'c1', taskId: 'read', occurrence: key(thisMon), completedAt: day(thisMon, 0, 9).toISOString(), undoneAt: null, title: '阅读' },
    { id: 'c2', taskId: 'run', occurrence: key(thisMon), completedAt: day(thisMon, 0, 10).toISOString(), undoneAt: null, title: '跑步' },
    { id: 'c3', taskId: 'read', occurrence: key(lastMon), completedAt: day(lastMon, 0).toISOString(), undoneAt: null, title: '阅读' },
    { id: 'c4', taskId: 'run', occurrence: key(lastMon), completedAt: day(lastMon, 0).toISOString(), undoneAt: day(lastMon, 0, 13).toISOString(), title: '跑步' }
  ]
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 5,
      tasks: [task('read', '阅读'), task('run', '跑步')],
      completions,
      plans: [],
      habits: [],
      habitCheckins: [],
      settings: { language: 'zh-CN', appearance: 'light' }
    }),
    'utf8'
  )
  await writeFile(
    path.join(userData, 'life-unlocked-focus.json'),
    JSON.stringify({
      version: 1,
      durations: { focusMin: 25, shortBreakMin: 5, longBreakMin: 15 },
      state: { run: null, nextPhase: 'focus', taskId: null, cycle: 0 },
      sessions: [
        { id: 'f1', taskId: 'read', taskTitle: '阅读', plannedSec: 1500, focusedSec: 1500, startedAt: day(thisMon, 0, 8).toISOString(), endedAt: day(thisMon, 0, 8).toISOString(), outcome: 'completed' },
        { id: 'f2', taskId: null, taskTitle: '', plannedSec: 1500, focusedSec: 600, startedAt: day(thisMon, 0, 11).toISOString(), endedAt: day(thisMon, 0, 11).toISOString(), outcome: 'ended-early' }
      ]
    }),
    'utf8'
  )
  const dataBefore = await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')
  const { app, page } = await launch(userData)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'))?.setSize(900, 560)
  })
  await page.locator('nav button', { hasText: '统计' }).click()
  // Two clear tabs under the header; the overview is selected first.
  await expect(page.getByTestId('stats-tab-overview')).toContainText('数据概览')
  await expect(page.getByTestId('stats-tab-weekly')).toContainText('智能周报')
  await expect(page.getByTestId('stats-tab-overview')).toHaveAttribute('aria-selected', 'true')
  await page.screenshot({ path: path.join(shots, 'stats-tabs-light-900.png') })
  // Keyboard: arrows move between the tabs and select them.
  await page.getByTestId('stats-tab-overview').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('stats-tab-weekly')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('stats-tab-weekly')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('stats-tab-overview')).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('stats-tab-weekly').click()
  // The chosen tab is kept while visiting another page.
  await page.locator('nav button', { hasText: '任务' }).click()
  await page.locator('nav button', { hasText: '统计' }).click()
  await expect(page.getByTestId('stats-tab-weekly')).toHaveAttribute('aria-selected', 'true')
  const report = page.getByTestId('weekly-report')
  await expect(report).toHaveAttribute('data-week', key(thisMon))
  await expect(page.getByTestId('report-tasks-value')).toHaveText('2')
  await expect(page.getByTestId('report-tasks')).toContainText('上周 1')
  await expect(page.getByTestId('report-active-days-value')).toHaveText('1/7 天')
  await expect(page.getByTestId('report-focus-value')).toHaveText('35 分钟')
  await expect(page.getByTestId('report-focus')).toContainText('完成 1 次 · 提前结束 1 次')
  await expect(page.getByTestId('report-day').first()).toHaveAttribute('data-tasks', '2')
  await expect(page.getByTestId('report-next')).toBeDisabled()
  await expect(page.getByTestId('report-insight').first()).toBeVisible()
  await page.screenshot({ path: path.join(shots, 'weekly-light.png'), fullPage: true })

  // Copy: plain text on the clipboard.
  await page.getByTestId('report-copy').click()
  await expect(page.getByTestId('report-copy')).toContainText('已复制')
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(copied.split('\n')[0]).toMatch(/^Activra 周报 · /)
  expect(copied).toContain('专注: 35 分钟')

  // Last week: the undone completion is left out.
  await page.getByTestId('report-prev').click()
  await expect(report).toHaveAttribute('data-week', key(lastMon))
  await expect(page.getByTestId('report-tasks-value')).toHaveText('1')
  await page.getByTestId('report-next').click()
  await expect(report).toHaveAttribute('data-week', key(thisMon))

  await page.evaluate(() => window.lifeUnlocked.settings.update({ appearance: 'dark' }))
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(shots, 'weekly-dark.png'), fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
  // The overview tab is unchanged.
  await page.getByTestId('stats-tab-overview').click()
  await expect(report).toHaveCount(0)

  // Settings changed (appearance) but tasks and completions were never written by the report.
  const after = JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as { completions: unknown[]; tasks: unknown[] }
  const before = JSON.parse(dataBefore) as { completions: unknown[]; tasks: unknown[] }
  expect(after.completions).toEqual(before.completions)
  await app.close()
})
