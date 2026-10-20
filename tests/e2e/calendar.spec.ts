import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, shots } from './helpers'

/**
 * Phase 6.9 calendar & timeline: the month grid marks days, the chosen day lists done and planned
 * items in time order, a task entry opens it on the Tasks page, and nothing is written.
 */

const pad = (n: number): string => String(n).padStart(2, '0')
const key = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const todayAt = (h: number, m = 0): Date => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}
const plusDays = (n: number): Date => {
  const d = todayAt(12)
  d.setDate(d.getDate() + n)
  return d
}

const base = {
  description: '',
  createdAt: plusDays(-10).toISOString(),
  updatedAt: plusDays(-10).toISOString(),
  completedAt: null,
  status: 'active',
  timerConfig: null,
  themeOverride: null,
  recurrence: null,
  recurrenceHistory: [],
  skippedOccurrences: [],
  due: null,
  reminderMinutes: null,
  window: null
}

test('日历: marks, day timeline in order, open a task, other days, light/dark at the smallest window', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-calendar-'))
  const today = key(todayAt(12))
  const tomorrow = key(plusDays(1))
  const done = todayAt(0, 30)
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 5,
      tasks: [
        { ...base, id: 'report', title: '写周报', status: 'completed', completedAt: done.toISOString() },
        { ...base, id: 'pay', title: '交水电费', due: { date: tomorrow, time: '18:00' } },
        {
          ...base,
          id: 'stretch',
          title: '拉伸',
          recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: key(plusDays(-10)), endDate: null }
        }
      ],
      completions: [{ id: 'c1', taskId: 'report', occurrence: null, completedAt: done.toISOString(), undoneAt: null, title: '写周报' }],
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
      sessions: [{ id: 'f1', taskId: 'report', taskTitle: '写周报', plannedSec: 1500, focusedSec: 600, startedAt: todayAt(0, 5).toISOString(), endedAt: todayAt(0, 15).toISOString(), outcome: 'ended-early' }]
    }),
    'utf8'
  )
  const dataBefore = await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')
  const { app, page } = await launch(userData)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'))?.setSize(900, 560)
  })
  await page.locator('nav button', { hasText: '日历' }).click()
  const timeline = page.getByTestId('calendar-timeline')
  await expect(timeline).toHaveAttribute('data-day', today)
  await expect(page.locator(`[data-testid=calendar-day][data-day="${today}"]`)).toHaveAttribute('data-completed', '1')

  // Today: the repeating task (all day) first, then focus 00:05, then the completion 00:30.
  const kinds = await timeline.getByTestId('timeline-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
  expect(kinds).toEqual(['occurrence', 'focus', 'completion'])
  await expect(timeline.locator('[data-kind=occurrence]')).toHaveAttribute('data-status', 'today')
  await expect(timeline.locator('[data-kind=focus]')).toContainText('10 分钟 · 提前结束')
  await page.screenshot({ path: path.join(shots, 'calendar-light-900.png') })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)

  // Tomorrow: the deadline at 18:00 and the planned occurrence.
  if (tomorrow.slice(0, 7) !== today.slice(0, 7)) await page.getByTestId('calendar-next').click()
  await page.locator(`[data-testid=calendar-day][data-day="${tomorrow}"]`).click()
  await expect(timeline).toHaveAttribute('data-day', tomorrow)
  await expect(page.locator(`[data-testid=calendar-day][data-day="${tomorrow}"]`)).toHaveAttribute('data-due', '1')
  await expect(timeline.locator('[data-kind=deadline]')).toHaveAttribute('data-status', 'upcoming')
  await expect(timeline.locator('[data-kind=deadline]')).toContainText('交水电费')
  await expect(timeline.locator('[data-kind=occurrence]')).toHaveAttribute('data-status', 'upcoming')

  await page.evaluate(() => window.lifeUnlocked.settings.update({ appearance: 'dark' }))
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'calendar-dark-900.png') })

  // Back to today; a task entry opens it on the Tasks page.
  await page.getByTestId('calendar-today').click()
  await expect(timeline).toHaveAttribute('data-day', today)
  await timeline.locator('[data-kind=occurrence]').getByRole('button', { name: '拉伸' }).click()
  await expect(page.getByTestId('task-card').filter({ hasText: '拉伸' }).first()).toBeVisible()

  const after = JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as { tasks: unknown; completions: unknown }
  const before = JSON.parse(dataBefore) as { tasks: unknown; completions: unknown }
  expect(after.tasks).toEqual(before.tasks)
  expect(after.completions).toEqual(before.completions)
  await app.close()
})
