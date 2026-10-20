import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, shots, widgetPage } from './helpers'

const pad = (n: number): string => String(n).padStart(2, '0')
const dateKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const minutesFromNow = (n: number): Date => new Date(Date.now() + n * 60_000)

interface Shown {
  keys: string[]
  title: string
  body: string
  silent: boolean
  taskId: string | null
}

type Hooks = { reminders: Shown[]; runReminders: () => Promise<void>; clickReminder: (id: string | null) => void }

const shown = (app: ElectronApplication): Promise<Shown[]> =>
  app.evaluate(() => (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.reminders)
const runReminders = (app: ElectronApplication): Promise<void> =>
  app.evaluate(() => (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.runReminders())

function seedTask(id: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const createdAt = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
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
    recurrence: null,
    recurrenceHistory: [],
    skippedOccurrences: [],
    due: null,
    reminderMinutes: null,
    ...extra
  }
}

async function seed(
  userData: string,
  tasks: Record<string, unknown>[],
  settings: Record<string, unknown> = {}
): Promise<void> {
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 2, tasks, completions: [], settings: { language: 'en', ...settings } })
  )
}

const card = (page: Page, title: string) => page.getByTestId('task-card').filter({ hasText: title })

test('A deadline set in the dialog shows on the card and sends one reminder, also across a restart', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-due-'))
  await seed(userData, [])
  let { app, page } = await launch(userData)
  const due = minutesFromNow(10)

  await page.getByRole('button', { name: 'New task' }).first().click()
  await page.locator('input[name=title]').fill('Hand in the essay')
  await page.getByTestId('advanced-options').locator('summary').click()
  await page.locator('input[name=due]').check()
  await page.locator('input[name=due-date]').fill(dateKey(due))
  // Date only first: the dialog states the rule for date-only deadlines.
  await expect(page.getByText('Without a time, it is due by the end of the day')).toBeVisible()
  await expect(page.getByText('from 09:00 on the due day')).toBeVisible()
  await page.locator('input[name=due-time]').fill(hhmm(due))
  // The default reminder (15 minutes before) is filled in.
  await expect(page.locator('[role=combobox][name=reminder]')).toHaveAttribute('data-value', '15')
  await page.screenshot({ path: path.join(shots, '4b-07-deadline-dialog.png') })
  await page.getByRole('button', { name: 'Save' }).click()

  const essay = card(page, 'Hand in the essay')
  await expect(essay.getByTestId('due-badge')).toHaveAttribute('data-overdue', 'false')
  await expect(essay.getByTestId('due-badge')).toContainText(hhmm(due))

  // The reminder time (5 minutes ago) has passed: sent once, right after saving.
  await expect.poll(async () => (await shown(app)).length).toBe(1)
  const [reminder] = await shown(app)
  expect(reminder).toMatchObject({ title: 'Hand in the essay', silent: false })
  expect(reminder?.body).toContain(`Due`)
  expect(reminder?.body).toContain(hhmm(due))
  await runReminders(app)
  await page.evaluate(() => window.lifeUnlocked.tasks.list())
  expect(await shown(app)).toHaveLength(1)
  await app.close()
  ;({ app, page } = await launch(userData))
  await runReminders(app)
  expect(await shown(app)).toHaveLength(0)
  const state = JSON.parse(await readFile(path.join(userData, 'reminder-state.json'), 'utf8'))
  expect(Object.values(state.handled).map((x) => (x as { outcome: string }).outcome)).toEqual(['sent'])

  // Editing the deadline is a new deadline: it gets its own reminder.
  const id = (await page.evaluate(() => window.lifeUnlocked.tasks.list()))[0]!.id
  const later = minutesFromNow(12)
  await page.evaluate(([taskId, date, time]) => window.lifeUnlocked.tasks.update(taskId, { due: { date, time } }), [
    id,
    dateKey(later),
    hhmm(later)
  ] as const)
  await expect.poll(async () => (await shown(app)).length).toBe(1)
  await app.close()
})

test('Overdue is a marker with how long, old reminders are skipped, and a click opens the task', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-due-overdue-'))
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
  await seed(
    userData,
    [
      seedTask('late', 'Library books', { due: { date: dateKey(yesterday), time: null }, reminderMinutes: 0 }),
      seedTask('soon', 'Call the dentist', {
        due: { date: dateKey(minutesFromNow(90)), time: hhmm(minutesFromNow(90)) },
        reminderMinutes: 15
      })
    ],
    { widget: { visible: true } }
  )
  const { app, page } = await launch(userData)
  const widget = await widgetPage(app)

  const late = card(page, 'Library books')
  await expect(late.getByTestId('due-badge')).toHaveAttribute('data-overdue', 'true')
  await expect(late.getByTestId('due-badge')).toHaveText(/^Overdue \d+ (min|h)$/)
  await expect(late).not.toContainText(/fail/i)
  await expect(late.getByRole('button', { name: 'Complete' })).toBeEnabled()
  await expect(widget.getByTestId('widget-due').first()).toHaveAttribute('data-overdue', 'true')
  await page.screenshot({ path: path.join(shots, '4b-08-overdue.png') })
  await widget.screenshot({ path: path.join(shots, '4b-09-widget-due.png') })

  // Yesterday 09:00 is far past the catch-up window: recorded as skipped, no notification.
  await runReminders(app)
  expect(await shown(app)).toHaveLength(0)
  await expect
    .poll(async () => JSON.parse(await readFile(path.join(userData, 'reminder-state.json'), 'utf8')).handled)
    .toEqual({ [`late@once@${dateKey(yesterday)}Tday@0`]: expect.objectContaining({ outcome: 'skipped' }) })

  // Clicking a reminder brings up the main window on that task.
  await page.evaluate(() => window.lifeUnlocked.app.info())
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('index.html'))
      ?.hide()
  )
  await app.evaluate(() =>
    (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.clickReminder('soon')
  )
  await expect(card(page, 'Call the dentist')).toHaveAttribute('data-highlighted', 'true')
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('index.html'))
        ?.isVisible()
    )
  ).toBe(true)
  await app.close()
})

test('Complete, undo and repeating occurrences each change what is reminded, and nothing is sent twice', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-due-sync-'))
  const due = minutesFromNow(5)
  const dueValue = { date: dateKey(due), time: hhmm(due) }
  await seed(userData, [
    seedTask('done', 'Already done', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      due: dueValue,
      reminderMinutes: 15
    }),
    seedTask('daily', 'Take vitamins', {
      recurrence: {
        preset: 'daily',
        unit: 'day',
        interval: 1,
        weekdays: [],
        startDate: dateKey(new Date(Date.now() - 2 * 864e5)),
        endDate: null
      },
      due: { date: null, time: hhmm(due) },
      reminderMinutes: 15
    })
  ])
  const { app, page } = await launch(userData)

  // Completed task: no reminder. Today's occurrence of the repeating task: one.
  await expect.poll(async () => (await shown(app)).map((r) => r.title)).toEqual(['Take vitamins'])
  expect((await shown(app))[0]?.keys[0]).toBe(`daily@${dateKey(due)}@${dateKey(due)}T${hhmm(due)}@15`)

  // Undo the completed task: it is in progress again, so its reminder is now sent (once).
  const eventId = await page.evaluate(async () => (await window.lifeUnlocked.tasks.snapshot()).completions[0]!.id)
  await page.evaluate((id) => window.lifeUnlocked.tasks.undoCompletion(id), eventId)
  await expect.poll(async () => (await shown(app)).map((r) => r.title)).toEqual(['Take vitamins', 'Already done'])

  // Four new deadlines due at once: one summary notification instead of four.
  await page.evaluate(async (d) => {
    for (const title of ['A', 'B', 'C', 'D']) {
      await window.lifeUnlocked.tasks.create({ title, due: d, reminderMinutes: 15 })
    }
  }, dueValue)
  await expect.poll(async () => (await shown(app)).length).toBeGreaterThanOrEqual(3)
  await runReminders(app)
  const all = await shown(app)
  // Created one by one, so the first may arrive alone; together nothing is sent twice.
  const keys = all.flatMap((r) => r.keys)
  expect(new Set(keys).size).toBe(keys.length)
  expect(keys).toHaveLength(6)
  await app.close()
})

test('Summary for many at once; reminders off and sound off in Settings', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-due-settings-'))
  const due = minutesFromNow(5)
  const dueValue = { date: dateKey(due), time: hhmm(due) }
  await seed(
    userData,
    ['A', 'B', 'C', 'D'].map((t) => seedTask(t.toLowerCase(), `Task ${t}`, { due: dueValue, reminderMinutes: 15 })),
    { reminders: { enabled: true, defaultMinutes: 30, sound: false, allDayTime: '08:00' } }
  )
  const { app, page } = await launch(userData)
  await expect.poll(async () => (await shown(app)).length).toBe(1)
  expect((await shown(app))[0]).toMatchObject({ title: '4 tasks are due soon', silent: true, taskId: null })
  expect((await shown(app))[0]?.keys).toHaveLength(4)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'Remind me before deadlines' }).click()
  await expect(page.getByLabel('Reminder time for date-only deadlines')).toHaveValue('08:00')
  await page.screenshot({ path: path.join(shots, '4b-10-reminder-settings.png'), fullPage: true })
  await page.evaluate(
    (d) => window.lifeUnlocked.tasks.create({ title: 'While off', due: d, reminderMinutes: 15 }),
    dueValue
  )
  await runReminders(app)
  expect(await shown(app)).toHaveLength(1)
  await app.close()
})
