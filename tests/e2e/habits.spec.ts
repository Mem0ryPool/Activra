import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch } from './helpers'

/**
 * Phase 6.6 habits: their own page, one check-in per day, cancel, pause/archive, streaks, heatmap,
 * a milestone card, and data safety (upgrade from schema 4, habits restored after an older version
 * saved the file). The language is set explicitly so the test reads the same on any system language.
 */

interface Data {
  schemaVersion: number
  tasks: { id: string; title: string }[]
  completions: { id: string }[]
  habits: { id: string; name: string; state: string; frequency: { kind: string } }[]
  habitCheckins: { id: string; habitId: string; date: string; undoneAt: string | null }[]
}
const readData = async (userData: string): Promise<Data> =>
  JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as Data
const counted = (data: Data): Data['habitCheckins'] => data.habitCheckins.filter((c) => c.undoneAt === null)

const pad = (n: number): string => String(n).padStart(2, '0')
const day = (n: number): { key: string; iso: string } => {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12)
  return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, iso: d.toISOString() }
}
const today = day(0).key

async function seed(userData: string, data: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(userData, 'life-unlocked-data.json'), JSON.stringify(data), 'utf8')
}

async function openHabits(page: Page): Promise<void> {
  await page.locator('nav button', { hasText: /Habits|习惯/ }).click()
  await expect(page.getByTestId('habit-new').first()).toBeVisible()
}

async function createHabit(page: Page, name: string, weekly?: number): Promise<void> {
  await page.getByTestId('habit-new').first().click()
  await page.getByTestId('habit-name').fill(name)
  if (weekly) {
    await page.getByTestId('habit-frequency-weekly').click()
    await page.getByTestId('habit-times').fill(String(weekly))
  }
  await page.getByTestId('habit-save').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

const card = (page: Page, name: string) => page.getByTestId('habit-card').filter({ hasText: name })

async function menu(page: Page, name: string, item: string): Promise<void> {
  await card(page, name).locator('header').getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

interface Shown {
  kind: string
  heading: string
  taskTitle: string
}
const shown = (app: ElectronApplication): Promise<Shown[]> =>
  app.evaluate(
    () => (globalThis as unknown as { __lifeUnlockedTest: { notifications: () => { shown: Shown[] } } }).__lifeUnlockedTest.notifications().shown
  )

test('daily habit: check in once despite a double click, cancel, streak, heatmap, pause, archive and restore', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-habits-'))
  await seed(userData, { schemaVersion: 5, settings: { language: 'en' } })
  const { app, page } = await launch(userData)
  await openHabits(page)

  // A blank name is shown at the field and nothing is saved.
  await page.getByTestId('habit-new').first().click()
  await page.getByTestId('habit-save').click()
  await expect(page.getByTestId('habit-name-error')).toBeVisible()
  await page.keyboard.press('Escape')

  await createHabit(page, 'Drink water')
  const water = card(page, 'Drink water')
  await expect(water.getByTestId('habit-frequency')).toHaveText('Every day')
  await water.getByTestId('habit-check-in').dblclick()
  await expect(water.getByTestId('habit-checked')).toBeVisible()
  await expect(water.getByTestId('habit-streak-current')).toHaveAttribute('data-value', '1')
  await expect.poll(async () => counted(await readData(userData)).length).toBe(1)
  expect((await readData(userData)).habitCheckins).toHaveLength(1)

  // Cancel keeps the record (marked), then a new check-in counts again.
  await water.getByTestId('habit-undo').click()
  await expect(water.getByTestId('habit-check-in')).toBeVisible()
  await expect(water.getByTestId('habit-streak-current')).toHaveAttribute('data-value', '0')
  await expect.poll(async () => counted(await readData(userData)).length).toBe(0)
  await water.getByTestId('habit-check-in').click()
  await expect(water.getByTestId('habit-checked')).toBeVisible()
  await expect.poll(async () => (await readData(userData)).habitCheckins.length).toBe(2)
  expect(counted(await readData(userData)).map((c) => c.date)).toEqual([today])

  await water.getByTestId('habit-history-toggle').click()
  await expect(water.locator(`[data-testid=habit-heatmap-day][data-day="${today}"]`)).toHaveAttribute('data-status', 'done')

  // Paused: moves to its own section and cannot be checked in; resuming brings it back.
  await menu(page, 'Drink water', 'Pause')
  await expect(page.getByTestId('habit-section-active')).toHaveCount(0)
  await page.getByTestId('habit-section-paused').getByRole('button', { name: /Paused/ }).click()
  await expect(water).toHaveAttribute('data-state', 'paused')
  await expect(water.getByTestId('habit-check-in')).toHaveCount(0)
  await menu(page, 'Drink water', 'Resume')
  await expect(water).toHaveAttribute('data-state', 'active')

  await menu(page, 'Drink water', 'Archive')
  await page.getByTestId('habit-section-archived').getByRole('button', { name: /Archived/ }).click()
  await expect(water).toHaveAttribute('data-state', 'archived')
  await menu(page, 'Drink water', 'Restore')
  await expect(water).toHaveAttribute('data-state', 'active')
  expect((await readData(userData)).habits.map((h) => h.state)).toEqual(['active'])

  // Edit: rename and switch to weekly; the week's count shows.
  await menu(page, 'Drink water', 'Edit')
  await page.getByTestId('habit-name').fill('Water')
  await page.getByTestId('habit-frequency-weekly').click()
  await expect(page.getByTestId('habit-frequency-changed')).toBeVisible()
  await page.getByTestId('habit-times').fill('2')
  await page.getByTestId('habit-save').click()
  const renamed = card(page, 'Water')
  await expect(renamed.getByTestId('habit-week-progress')).toContainText('1/2')
  await expect(renamed.getByTestId('habit-streak-current')).toHaveText('0 weeks')
  await app.close()
})

test('a streak milestone shows one card; tasks, statistics and the file stay as they were', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-habits-milestone-'))
  const created = day(-2)
  const checkin = (id: string, n: number): Record<string, unknown> => ({
    id,
    habitId: 'h1',
    date: day(n).key,
    checkedAt: day(n).iso,
    undoneAt: null
  })
  const task = {
    id: 't1', title: 'Old task', description: '', createdAt: created.iso, updatedAt: created.iso, completedAt: created.iso,
    status: 'completed', timerConfig: null, themeOverride: null, recurrence: null, recurrenceHistory: [],
    skippedOccurrences: [], due: null, reminderMinutes: null, window: null
  }
  await seed(userData, {
    schemaVersion: 5,
    tasks: [task],
    completions: [{ id: 'e1', taskId: 't1', occurrence: null, completedAt: created.iso, undoneAt: null, title: 'Old task' }],
    plans: [],
    habits: [
      {
        id: 'h1', name: '读书', note: '', frequency: { kind: 'daily' }, startDate: created.key, state: 'active',
        pauses: [], createdAt: created.iso, updatedAt: created.iso, archivedAt: null
      }
    ],
    habitCheckins: [checkin('c1', -2), checkin('c2', -1)],
    settings: { language: 'zh-CN' }
  })
  const { app, page } = await launch(userData)
  await openHabits(page)
  const reading = card(page, '读书')
  await expect(reading.getByTestId('habit-streak-current')).toHaveText('2 天')
  await reading.getByTestId('habit-check-in').click()
  await expect(reading.getByTestId('habit-streak-current')).toHaveText('3 天')
  await expect(reading.getByTestId('habit-streak-longest')).toHaveText('3 天')
  await expect
    .poll(async () => (await shown(app)).filter((n) => n.taskTitle === '读书').map((n) => n.heading))
    // Phase 6.6.1: reaching 3 days also beats the longest streak (2), so the card is the new record.
    .toEqual(['🔥 新纪录！连续坚持 3 天！'])

  // Cancelling and checking in again the same day does not show the record a second time: since
  // Phase 6.6.2c that check-in gets the quiet "already given" card.
  await reading.getByTestId('habit-undo').click()
  await reading.getByTestId('habit-check-in').click()
  await expect(reading.getByTestId('habit-checked')).toBeVisible()
  await page.waitForTimeout(500)
  expect((await shown(app)).filter((n) => n.taskTitle === '读书').map((n) => n.heading)).toEqual(['🔥 新纪录！连续坚持 3 天！', '今日目标已达成'])

  // A habit check-in is not a task completion: tasks and completion records are untouched.
  const data = await readData(userData)
  expect(data.tasks).toEqual([task])
  expect(data.completions.map((e) => e.id)).toEqual(['e1'])
  await app.close()
})

test('upgrading from schema 4 keeps everything; habits saved away by an older version come back', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-habits-upgrade-'))
  const created = day(-3)
  const task = {
    id: 't1', title: 'Keep me', description: '', createdAt: created.iso, updatedAt: created.iso, completedAt: null,
    status: 'active', timerConfig: null, themeOverride: null, recurrence: null, recurrenceHistory: [],
    skippedOccurrences: [], due: null, reminderMinutes: null, window: null
  }
  // As an older version (schema 4) leaves the file after it saved over a schema 5 file.
  const v4 = { schemaVersion: 4, tasks: [task], completions: [], plans: [], settings: { language: 'en' } }
  await seed(userData, v4)
  await writeFile(
    path.join(userData, 'life-unlocked-habits-mirror.json'),
    JSON.stringify({
      schemaVersion: 5,
      habits: [
        {
          id: 'h1', name: 'Stretch', note: '', frequency: { kind: 'daily' }, startDate: created.key, state: 'active',
          pauses: [], createdAt: created.iso, updatedAt: created.iso, archivedAt: null
        }
      ],
      habitCheckins: [{ id: 'c1', habitId: 'h1', date: day(-1).key, checkedAt: day(-1).iso, undoneAt: null }]
    }),
    'utf8'
  )
  const { app, page } = await launch(userData)
  await openHabits(page)
  const stretch = card(page, 'Stretch')
  await expect(stretch.getByTestId('habit-streak-current')).toHaveText('1 day')
  await stretch.getByTestId('habit-check-in').click()
  await expect(stretch.getByTestId('habit-streak-current')).toHaveText('2 days')

  const data = await readData(userData)
  expect(data.schemaVersion).toBe(5)
  expect(data.tasks).toEqual([task])
  expect(data.habits.map((h) => h.name)).toEqual(['Stretch'])
  expect(counted(data)).toHaveLength(2)
  expect(JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.v4-backup.json'), 'utf8'))).toEqual(v4)
  await app.close()
})

test('custom days: only chosen days can be checked in; deleting removes the habit and its check-ins', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-habits-custom-'))
  await seed(userData, { schemaVersion: 5, settings: { language: 'en' } })
  const { app, page } = await launch(userData)
  await openHabits(page)
  const todayDay = new Date().getDay()
  const otherDay = (todayDay + 3) % 7
  const createCustom = async (name: string, days: number[]): Promise<void> => {
    await page.getByTestId('habit-new').first().click()
    await page.getByTestId('habit-name').fill(name)
    await page.getByTestId('habit-frequency-weekdays').click()
    // Start from no days selected, then pick the wanted ones.
    for (let d = 0; d < 7; d++) {
      const button = page.getByTestId(`habit-weekday-${d}`)
      if ((await button.getAttribute('aria-pressed')) === 'true') await button.click()
    }
    await page.getByTestId('habit-save').click()
    await expect(page.getByTestId('habit-weekdays-error')).toBeVisible()
    for (const d of days) await page.getByTestId(`habit-weekday-${d}`).click()
    await page.getByTestId('habit-save').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }

  await createCustom('Gym', [todayDay, otherDay])
  await createCustom('Swim', [otherDay])
  await expect(card(page, 'Gym').getByTestId('habit-frequency')).toContainText('Every')
  await expect(card(page, 'Swim').getByTestId('habit-not-today')).toBeVisible()
  await expect(card(page, 'Swim').getByTestId('habit-check-in')).toHaveCount(0)
  await card(page, 'Gym').getByTestId('habit-check-in').click()
  await expect(card(page, 'Gym').getByTestId('habit-streak-current')).toHaveText('1 day')
  await expect.poll(async () => counted(await readData(userData)).length).toBe(1)

  await menu(page, 'Gym', 'Delete')
  await page.getByTestId('confirm-delete-habit').click()
  await expect(card(page, 'Gym')).toHaveCount(0)
  await expect.poll(async () => (await readData(userData)).habits.map((h) => h.name)).toEqual(['Swim'])
  expect((await readData(userData)).habitCheckins).toEqual([])
  await app.close()
})
