import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, notificationPage, shots, widgetPage } from './helpers'

/**
 * Quick completions: every completion shows its own achievement at once (replacing the one on
 * screen), and a round of two or more settles into one summary once nothing new is completed for 2 s.
 */

interface Shown {
  id: string
  kind: string
  heading: string
  taskTitle: string
}
interface TrayItem {
  id: string
  label?: string
  enabled?: boolean
  submenu?: TrayItem[]
}
interface Hooks {
  notifications: () => { active: string | null; shown: Shown[] }
  burst: () => { eventId: string }[]
  tray: () => { items: TrayItem[] }
  clickTrayItem: (id: string) => boolean
}

const state = (app: ElectronApplication): Promise<{ active: string | null; shown: Shown[]; burst: string[] }> =>
  app.evaluate(() => {
    const h = (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest
    const { active, shown } = h.notifications()
    return { active, shown, burst: h.burst().map((e) => e.eventId) }
  })
const shownOf = async (app: ElectronApplication, kind: string): Promise<Shown[]> =>
  (await state(app)).shown.filter((n) => n.kind === kind)

const quickCompleteMenu = (app: ElectronApplication): Promise<{ label?: string; enabled?: boolean; id: string }[]> =>
  app.evaluate(() => {
    const h = (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest
    const menu = h.tray().items.find((i) => i.id === 'quick-complete')
    return (menu?.submenu ?? []).map(({ id, label, enabled }) => ({ id, label, enabled }))
  })
const clickTrayItem = (app: ElectronApplication, id: string): Promise<boolean> =>
  app.evaluate(
    (_e, itemId) => (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.clickTrayItem(itemId),
    id
  )

interface Data {
  tasks: { id: string; status: string }[]
  completions: { id: string; taskId: string; undoneAt: string | null }[]
}
const readData = async (userData: string): Promise<Data> =>
  JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as Data

function task(id: string, title: string, minutesAgo: number): Record<string, unknown> {
  const createdAt = new Date(Date.now() - 24 * 3600 * 1000 - minutesAgo * 60_000).toISOString()
  return {
    id,
    title,
    description: '',
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    status: 'active',
    timerConfig: null,
    themeOverride: null
  }
}

async function seed(userData: string, tasks: Record<string, unknown>[], settings: Record<string, unknown> = {}): Promise<void> {
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 1, settings: { language: 'en', notificationDurationSec: 6, ...settings }, tasks })
  )
}

const pad = (n: number): string => String(n).padStart(2, '0')
const card = (page: Page, title: string) => page.getByTestId('task-card').filter({ hasText: title })

/** Completes the tasks one after another through the same API the pages use, without pausing. */
const completeAll = (page: Page, ids: string[]): Promise<string[]> =>
  page.evaluate(async (list) => {
    const events: string[] = []
    for (const id of list) {
      const result = await window.lifeUnlocked.tasks.complete(id)
      if (result.event) events.push(result.event.id)
    }
    return events
  }, ids)

test('bursts of 2, 5 and 20 completions: each shown at once, one summary per round, none for a single one', async () => {
  test.setTimeout(120_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-burst-'))
  const ids = Array.from({ length: 28 }, (_, i) => `t${pad(i + 1)}`)
  // Oldest first in the data; T01 is the newest so the list shows it at the top.
  await seed(userData, ids.map((id, i) => task(id, `T${pad(i + 1)}`, i)))
  const { app, page } = await launch(userData)

  // Round 1: two clicks in the main window.
  await card(page, 'T01').getByRole('button', { name: 'Complete' }).click()
  await card(page, 'T02').getByRole('button', { name: 'Complete' }).click()
  await expect.poll(async () => (await readData(userData)).completions.length).toBe(2)
  const round1 = (await readData(userData)).completions.map((e) => e.id)
  await expect.poll(async () => (await state(app)).active).toBe(round1[1])
  // Not settled yet: the summary waits for the idle time.
  expect(await shownOf(app, 'summary')).toEqual([])
  expect((await state(app)).burst).toEqual(round1)
  await expect.poll(async () => (await shownOf(app, 'summary')).length, { timeout: 5000 }).toBe(1)
  expect((await shownOf(app, 'summary'))[0]).toMatchObject({
    heading: '2 tasks completed in a row!',
    taskTitle: 'T01, T02'
  })
  const toast = await notificationPage(app)
  const toastCard = toast.getByTestId('achievement-toast')
  await expect(toastCard).toHaveAttribute('data-variant', 'summary')
  await expect(toastCard).toContainText('T01, T02')
  await toast.screenshot({ path: path.join(shots, 'hotfix-01-summary-2.png') })

  // Round 2: five completions.
  const round2 = await completeAll(page, ids.slice(2, 7))
  expect(round2).toHaveLength(5)
  expect((await state(app)).active).toBe(round2[4])
  await expect.poll(async () => (await shownOf(app, 'summary')).length, { timeout: 5000 }).toBe(2)
  expect((await shownOf(app, 'summary'))[1]).toMatchObject({
    heading: '5 tasks completed in a row!',
    taskTitle: 'T03, T04, T05 and 2 more'
  })

  // Round 3: twenty completions.
  const round3 = await completeAll(page, ids.slice(7, 27))
  expect(round3).toHaveLength(20)
  expect((await state(app)).active).toBe(round3[19])
  await expect.poll(async () => (await shownOf(app, 'summary')).length, { timeout: 5000 }).toBe(3)
  expect((await shownOf(app, 'summary'))[2]).toMatchObject({
    heading: '20 tasks completed in a row!',
    taskTitle: 'T08, T09, T10 and 17 more'
  })
  await expect(toastCard).toContainText('20 tasks completed in a row!')
  await toast.screenshot({ path: path.join(shots, 'hotfix-02-summary-20.png') })

  // A single completion gets its own achievement and no summary.
  const single = await completeAll(page, [ids[27]!])
  await page.waitForTimeout(3500)
  expect(await shownOf(app, 'summary')).toHaveLength(3)

  // Every completion reached the screen exactly once, in order; every record was saved.
  const achievements = (await shownOf(app, 'achievement')).map((n) => n.id)
  expect(achievements).toEqual([...round1, ...round2, ...round3, ...single])
  const data = await readData(userData)
  expect(data.completions.filter((e) => !e.undoneAt)).toHaveLength(28)
  expect(data.tasks.every((t) => t.status === 'completed')).toBe(true)
  await app.close()
})

test('a new completion interrupts the summary at once and starts a new round', async () => {
  test.setTimeout(60_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-burst-interrupt-'))
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  await seed(userData, ids.map((id, i) => task(id, `Task ${id.toUpperCase()}`, i)), { notificationDurationSec: 8 })
  const { app, page } = await launch(userData)

  await completeAll(page, ['a', 'b', 'c'])
  await expect.poll(async () => (await state(app)).shown.at(-1)?.kind, { timeout: 5000 }).toBe('summary')
  const summaryId = (await state(app)).active
  const toast = await notificationPage(app)
  await expect(toast.getByTestId('achievement-toast')).toHaveAttribute('data-variant', 'summary')

  // While the summary is on screen, complete D: it replaces the summary at once.
  const [d] = await completeAll(page, ['d'])
  expect((await state(app)).active).toBe(d)
  await expect(toast.getByTestId('achievement-toast')).toHaveAttribute('data-variant', 'single', { timeout: 1000 })
  await expect(toast.getByTestId('achievement-card')).toContainText('Task D')
  expect(summaryId).not.toBe(d)

  // D alone: no summary, and the interrupted summary does not come back.
  await page.waitForTimeout(3500)
  expect(await shownOf(app, 'summary')).toHaveLength(1)
  expect((await state(app)).active).toBe(d)

  // E and F form their own round; the earlier completions are not counted again.
  await completeAll(page, ['e', 'f'])
  await expect.poll(async () => (await shownOf(app, 'summary')).length, { timeout: 5000 }).toBe(2)
  expect((await shownOf(app, 'summary')).map((n) => n.taskTitle)).toEqual(['Task A, Task B, Task C', 'Task E, Task F'])
  expect((await shownOf(app, 'achievement')).map((n) => n.taskTitle)).toEqual([
    'Task A',
    'Task B',
    'Task C',
    'Task D',
    'Task E',
    'Task F'
  ])
  await app.close()
})

test('completions made while the notification window is still loading all reach the screen, in order', async () => {
  test.setTimeout(60_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-burst-slow-window-'))
  const ids = ['a', 'b', 'c', 'd']
  await seed(userData, ids.map((id, i) => task(id, `Task ${id.toUpperCase()}`, i)), { notificationDurationSec: 8 })
  // A notification window that takes 3 s to get ready (a slow first load, as seen on Windows), and a
  // longer idle time so the last single card can be checked before the summary replaces it.
  const { app, page } = await launch(userData, {
    LIFE_UNLOCKED_NOTIFICATION_READY_DELAY_MS: '3000',
    LIFE_UNLOCKED_BURST_IDLE_MS: '6000'
  })

  const events = await completeAll(page, ['a', 'b', 'c'])
  expect(events).toHaveLength(3)
  // The window is not ready yet: nothing has reached the screen, but the newest completion is active.
  expect((await state(app)).shown).toEqual([])
  expect((await state(app)).active).toBe(events[2])
  await expect.poll(async () => (await shownOf(app, 'achievement')).map((n) => n.id), { timeout: 8000 }).toEqual(events)
  const toast = await notificationPage(app)
  await expect(toast.getByTestId('achievement-toast')).toHaveAttribute('data-variant', 'single')
  await expect(toast.getByTestId('achievement-card')).toContainText('Task C')
  expect((await state(app)).active).toBe(events[2])

  await expect.poll(async () => (await shownOf(app, 'summary')).length, { timeout: 10_000 }).toBe(1)
  expect((await shownOf(app, 'summary'))[0]).toMatchObject({ taskTitle: 'Task A, Task B, Task C' })
  await expect(toast.getByTestId('achievement-toast')).toHaveAttribute('data-variant', 'summary')

  // The window is ready now: D interrupts the summary at once.
  const [d] = await completeAll(page, ['d'])
  expect((await state(app)).active).toBe(d)
  expect((await state(app)).shown.at(-1)).toMatchObject({ id: d, kind: 'achievement', taskTitle: 'Task D' })
  await expect(toast.getByTestId('achievement-toast')).toHaveAttribute('data-variant', 'single', { timeout: 1000 })
  await expect(toast.getByTestId('achievement-card')).toContainText('Task D')

  const data = await readData(userData)
  expect(data.completions.filter((e) => !e.undoneAt).map((e) => e.taskId)).toEqual(ids)
  await app.close()
})

test('main window, widget and tray "Quick complete task" share one round', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-burst-tray-'))
  await seed(
    userData,
    [task('tray', 'Tray & task', 0), task('widget', 'Widget task', 1), task('main', 'Main task', 2)],
    { widget: { visible: true }, notificationDurationSec: 4 }
  )
  // A longer idle time: the three windows are driven one after another.
  const { app, page } = await launch(userData, { LIFE_UNLOCKED_BURST_IDLE_MS: '5000' })
  const widget = await widgetPage(app)

  // The tray lists today's tasks still to do, with "&" shown as typed.
  await expect
    .poll(async () => (await quickCompleteMenu(app)).map((i) => i.label))
    .toEqual(['Tray && task', 'Widget task', 'Main task'])

  expect(await clickTrayItem(app, 'quick-complete:tray')).toBe(true)
  await expect.poll(async () => (await state(app)).shown.at(-1)?.taskTitle).toBe('Tray & task')
  // The menu drops the completed task; the main window and widget hear about it too.
  await expect.poll(async () => (await quickCompleteMenu(app)).map((i) => i.label)).toEqual(['Widget task', 'Main task'])

  await widget.getByRole('checkbox', { name: 'Complete "Widget task"' }).click()
  await expect.poll(async () => (await state(app)).shown.at(-1)?.taskTitle).toBe('Widget task')
  await card(page, 'Main task').getByRole('button', { name: 'Complete' }).click()
  await expect.poll(async () => (await state(app)).shown.at(-1)?.taskTitle).toBe('Main task')

  await expect.poll(async () => (await shownOf(app, 'summary')).length, { timeout: 8000 }).toBe(1)
  expect((await shownOf(app, 'summary'))[0]).toMatchObject({
    heading: '3 tasks completed in a row!',
    taskTitle: 'Tray & task, Widget task, Main task'
  })
  // Nothing left: the submenu says so and offers nothing to click.
  expect(await quickCompleteMenu(app)).toEqual([
    { id: 'quick-complete-empty', label: 'Nothing left to do today', enabled: false }
  ])
  expect(await clickTrayItem(app, 'quick-complete-empty')).toBe(false)
  const data = await readData(userData)
  expect(data.completions.filter((e) => !e.undoneAt).map((e) => e.taskId)).toEqual(['tray', 'widget', 'main'])
  await expect(widget.getByTestId('widget-progress')).toHaveText('3 of 3 done')
  await app.close()
})

test('quitting mid-round keeps every completion; the restart shows nothing again', async () => {
  test.setTimeout(60_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-burst-quit-'))
  await seed(userData, ['a', 'b', 'c'].map((id, i) => task(id, `Task ${id}`, i)))
  let { app, page } = await launch(userData)
  const events = await completeAll(page, ['a', 'b', 'c'])
  expect((await state(app)).burst).toEqual(events)
  await app.close()

  const data = await readData(userData)
  expect(data.completions.map((e) => e.id)).toEqual(events)
  expect(data.completions.every((e) => !e.undoneAt)).toBe(true)
  ;({ app, page } = await launch(userData))
  await page.waitForTimeout(3000)
  expect(await state(app)).toEqual({ active: null, shown: [], burst: [] })
  await page.getByRole('button', { name: 'Achievements' }).click()
  await expect(page.getByTestId('achievement')).toHaveCount(3)
  await app.close()
})
