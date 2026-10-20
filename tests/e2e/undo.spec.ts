import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, shots, widgetPage } from './helpers'

interface Data {
  schemaVersion: number
  tasks: { id: string; status: string; completedAt: string | null }[]
  completions: { id: string; taskId: string; undoneAt: string | null }[]
}

const readData = async (userData: string): Promise<Data> =>
  JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as Data

function seedTask(id: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const createdAt = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
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
    ...extra
  }
}

async function seed(userData: string, data: Record<string, unknown>): Promise<void> {
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ settings: { language: 'en', notificationDurationSec: 15 }, ...data })
  )
}

interface Shown {
  id: string
  kind: string
  heading: string
  taskTitle: string
}
interface Hooks {
  notifications: () => { active: string | null; shown: Shown[] }
  burst: () => { eventId: string; name: string }[]
}
const testHooks = (app: ElectronApplication): Promise<{ active: string | null; shown: Shown[]; burst: string[] }> =>
  app.evaluate(() => {
    const h = (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest
    const { active, shown } = h.notifications()
    return { active, shown, burst: h.burst().map((e) => e.eventId) }
  })
const active = async (app: ElectronApplication) => (await testHooks(app)).active
const shown = async (app: ElectronApplication) => (await testHooks(app)).shown
const burstIds = async (app: ElectronApplication) => (await testHooks(app)).burst

const card = (page: Page, title: string) => page.getByTestId('task-card').filter({ hasText: title })
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name })

async function openStats(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Statistics' }).click()
}

test('Undo from the toast puts the task back and withdraws its achievement everywhere', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-undo-'))
  await seed(userData, { schemaVersion: 1, tasks: [seedTask('read', 'Read 20 pages'), seedTask('run', 'Morning run')] })
  const { app, page } = await launch(userData)

  await card(page, 'Read 20 pages').getByRole('button', { name: 'Complete' }).click()
  const toast = page.getByTestId('undo-toast')
  await expect(toast).toHaveCount(1)
  await expect(toast).toContainText('Task completed')
  await expect(toast).toContainText('Read 20 pages')
  await page.screenshot({ path: path.join(shots, '4b-01-undo-toast.png') })
  await expect(tab(page, /Completed/)).toContainText('1')

  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(toast).toHaveCount(0)
  await expect(tab(page, /In progress/)).toContainText('2')
  await expect(tab(page, /Completed/)).toContainText('0')
  await expect(card(page, 'Read 20 pages').getByRole('button', { name: 'Complete' })).toBeEnabled()

  // Achievements and statistics no longer count it.
  await page.getByRole('button', { name: 'Achievements' }).click()
  await expect(page.getByTestId('achievement')).toHaveCount(0)
  await openStats(page)
  await expect(page.getByText('Achievements unlocked', { exact: true }).locator('..').locator('..')).toContainText('0')
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await expect(page.locator(`[data-testid=calendar-day][data-day="${today}"]`)).toHaveAttribute('data-count', '0')

  // Saved: the record is kept and marked undone, not deleted.
  await expect.poll(async () => (await readData(userData)).completions.map((e) => !!e.undoneAt)).toEqual([true])
  const data = await readData(userData)
  expect(data.schemaVersion).toBe(5)
  expect(data.tasks.find((x) => x.id === 'read')).toMatchObject({ status: 'active', completedAt: null })

  // The toast also goes away on its own after about 6 seconds.
  await page.getByRole('button', { name: 'Tasks' }).click()
  await card(page, 'Morning run').getByRole('button', { name: 'Complete' }).click()
  await expect(toast).toHaveCount(1)
  await page.waitForTimeout(5000)
  await expect(toast).toHaveCount(1)
  await expect(toast).toHaveCount(0, { timeout: 2500 })
  await expect(tab(page, /Completed/)).toContainText('1')

  // Later, the Completed list's menu restores it.
  await tab(page, /Completed/).click()
  await card(page, 'Morning run').getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Restore to not completed' }).click()
  await expect(page.getByTestId('task-card')).toHaveCount(0)
  await expect(tab(page, /In progress/)).toContainText('2')
  await app.close()
})

test('Quick completions show at once; undos leave the burst summary, nothing counted twice', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-undo-burst-'))
  await seed(userData, {
    schemaVersion: 1,
    tasks: [seedTask('a', 'Task A'), seedTask('b', 'Task B'), seedTask('c', 'Task C'), seedTask('d', 'Task D')]
  })
  // A longer idle time so the Undo clicks below land inside the same round.
  const { app, page } = await launch(userData, { LIFE_UNLOCKED_BURST_IDLE_MS: '6000' })

  for (const title of ['Task A', 'Task B', 'Task C', 'Task D']) {
    await card(page, title).getByRole('button', { name: 'Complete' }).click()
  }
  await expect(page.getByTestId('undo-toast')).toHaveCount(3)
  await expect.poll(async () => (await readData(userData)).completions.length).toBe(4)
  const ids = (await readData(userData)).completions.map((e) => e.id)
  expect(new Set(ids).size).toBe(4)

  // Every completion reached the screen the moment it happened; D (the latest) is on screen, nothing waits.
  await expect.poll(() => active(app)).toBe(ids[3])
  expect((await shown(app)).map((n) => n.id)).toEqual(ids)
  expect(await burstIds(app)).toEqual(ids)

  // Undo C from its toast and A from the API: both leave the round; D stays on screen.
  await page
    .getByTestId('undo-toast')
    .filter({ has: page.getByText('Task C', { exact: true }) })
    .getByRole('button', { name: 'Undo' })
    .click()
  await page.evaluate((id) => window.lifeUnlocked.tasks.undoCompletion(id), ids[0] as string)
  await expect.poll(() => burstIds(app)).toEqual([ids[1], ids[3]])
  expect(await active(app)).toBe(ids[3])

  // Completing C again is a new completion: shown at once and counted once; undoing it twice changes nothing more.
  await card(page, 'Task C').getByRole('button', { name: 'Complete' }).click()
  await expect.poll(async () => (await readData(userData)).completions.length).toBe(5)
  const again = (await readData(userData)).completions.at(-1)!.id
  await expect.poll(() => active(app)).toBe(again)
  expect(await burstIds(app)).toEqual([ids[1], ids[3], again])
  const results = await page.evaluate(
    (id) => Promise.all([window.lifeUnlocked.tasks.undoCompletion(id), window.lifeUnlocked.tasks.undoCompletion(id)]),
    again
  )
  expect(results.filter((r) => r.undone)).toHaveLength(1)
  await expect.poll(() => burstIds(app)).toEqual([ids[1], ids[3]])

  // The round settles into one summary of what still counts: B and D.
  await expect.poll(async () => (await shown(app)).at(-1)?.kind, { timeout: 10_000 }).toBe('summary')
  const summary = (await shown(app)).at(-1)!
  expect(summary).toMatchObject({ heading: '2 tasks completed in a row!', taskTitle: 'Task B, Task D' })
  expect((await shown(app)).filter((n) => n.kind === 'summary')).toHaveLength(1)
  expect(await burstIds(app)).toEqual([])

  const data = await readData(userData)
  expect(data.tasks.map((x) => x.status)).toEqual(['active', 'completed', 'active', 'completed'])
  expect(data.completions.filter((e) => !e.undoneAt).map((e) => e.taskId)).toEqual(['b', 'd'])
  await app.close()
})

test('Widget and main window: complete in one, undo in the other, and it survives a restart', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-undo-widget-'))
  await seed(userData, {
    schemaVersion: 1,
    tasks: [seedTask('gym', 'Go to the gym'), seedTask('read', 'Read 20 pages')],
    settings: { language: 'en', notificationDurationSec: 3, widget: { visible: true } }
  })
  let { app, page } = await launch(userData)
  let widget = await widgetPage(app)

  await widget.getByRole('checkbox', { name: 'Complete "Go to the gym"' }).click()
  await expect(widget.getByTestId('undo-toast')).toContainText('Go to the gym')
  await widget.screenshot({ path: path.join(shots, '4b-02-widget-undo.png') })
  await expect(tab(page, /Completed/)).toContainText('1')

  // Restore from the main window; the widget follows, and its own Undo then changes nothing.
  await tab(page, /Completed/).click()
  await card(page, 'Go to the gym').getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Restore to not completed' }).click()
  await expect(widget.getByRole('checkbox', { name: 'Complete "Go to the gym"' })).toBeEnabled()
  await widget.getByTestId('undo-toast').getByRole('button', { name: 'Undo' }).click()
  await expect(widget.getByTestId('undo-toast')).toHaveCount(0)
  await expect(tab(page, /In progress/)).toContainText('2')

  // Completing in the main window shows up in the widget at once.
  await tab(page, /In progress/).click()
  await card(page, 'Read 20 pages').getByRole('button', { name: 'Complete' }).click()
  await expect(widget.getByRole('checkbox', { name: '"Read 20 pages" is completed' })).toBeDisabled()
  await expect(widget.getByTestId('widget-progress')).toHaveText('1 of 2 done')

  const data = await readData(userData)
  expect(data.completions.map((e) => [e.taskId, !!e.undoneAt])).toEqual([
    ['gym', true],
    ['read', false]
  ])
  await app.close()

  // Restart: same state, no new migration, nothing duplicated.
  ;({ app, page } = await launch(userData))
  widget = await widgetPage(app)
  await expect(tab(page, /Completed/)).toContainText('1')
  await expect(widget.getByTestId('widget-progress')).toHaveText('1 of 2 done')
  expect((await readData(userData)).completions).toHaveLength(2)
  const files = await readdir(userData)
  expect(files).toContain('life-unlocked-data.v1-backup.json')
  await app.close()
})

test('Undoing a completion from before midnight fixes that day, not today', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-undo-midnight-'))
  const now = new Date()
  const lateYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 50).toISOString()
  const earlyToday = new Date(
    Math.min(now.getTime(), new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 20).getTime())
  ).toISOString()
  await seed(userData, {
    schemaVersion: 2,
    tasks: [
      seedTask('late', 'Late night essay', { status: 'completed', completedAt: lateYesterday }),
      seedTask('early', 'Early run', { status: 'completed', completedAt: earlyToday })
    ],
    completions: [
      {
        id: 'ev-late',
        taskId: 'late',
        occurrence: null,
        completedAt: lateYesterday,
        undoneAt: null,
        title: 'Late night essay'
      },
      { id: 'ev-early', taskId: 'early', occurrence: null, completedAt: earlyToday, undoneAt: null, title: 'Early run' }
    ]
  })
  const { app, page } = await launch(userData)
  const key = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const yesterdayKey = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

  await openStats(page)
  // Month view may not show yesterday on the 1st; the year heatmap always does.
  await page.getByRole('tab', { name: 'Year' }).click()
  const yesterdayCell = page.locator(`[data-testid=heatmap-day][data-day="${yesterdayKey}"]`)
  const todayCell = page.locator(`[data-testid=heatmap-day][data-day="${key(now)}"]`)
  await expect(yesterdayCell).toHaveAttribute('data-count', '1')
  await expect(todayCell).toHaveAttribute('data-count', '1')

  await page.evaluate(() => window.lifeUnlocked.tasks.undoCompletion('ev-late'))
  await expect(yesterdayCell).toHaveAttribute('data-count', '0')
  await expect(todayCell).toHaveAttribute('data-count', '1')
  await app.close()
})
