import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, shots } from './helpers'

/**
 * Phase 6.1: "接下来的4个小时内每个小时都喝水" is one goal of four timed windows. Each window is its own
 * task, completable only while open; the goal and "全成就！" unlock only with the fourth. Windows come
 * from the stored instants, so a restart or the clock moving on gives the same picture.
 */

interface Shown {
  id: string
  kind: string
  heading: string
  taskTitle: string
}
interface Hooks {
  notifications: () => { active: string | null; shown: Shown[] }
  clickTrayItem: (id: string) => boolean
}
const shown = (app: ElectronApplication): Promise<Shown[]> =>
  app.evaluate(() => (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.notifications().shown)
const clickTrayItem = (app: ElectronApplication, id: string): Promise<boolean> =>
  app.evaluate((_e, itemId) => (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.clickTrayItem(itemId), id)

interface Data {
  schemaVersion: number
  tasks: { id: string; title: string; status: string; window: { start: string; end: string } | null }[]
  completions: { id: string; taskId: string; completedAt: string; undoneAt: string | null }[]
  plans: {
    goals: { condition: { kind: string; start?: string | null; minutes?: number; count?: number }; nodeTaskIds: string[] }[]
    unlocks: { target: string; revokedAt: string | null }[]
  }[]
}
const readData = async (userData: string): Promise<Data> =>
  JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as Data

const card = (page: Page, title: string) => page.getByTestId('task-card').filter({ hasText: title })
const completeButton = (page: Page, title: string) => card(page, title).getByRole('button', { name: /^(完成|Complete)$/ })

const MIN = 60_000
const HOUR = 60 * MIN

test('智能计划「接下来的4个小时内每个小时都喝水」: preview shows 4 windows; only the open one can be completed', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-interval-zh-'))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 3, tasks: [], completions: [], plans: [], settings: { language: 'zh-CN', notificationDurationSec: 3 } })
  )
  const { app, page } = await launch(userData)

  await page.getByTestId('tasks-smart-plan').click()
  await page.getByTestId('wizard-input').fill('接下来的4个小时内每个小时都喝水')
  await page.getByTestId('wizard-parse').click()
  const goals = page.getByTestId('wizard-goal')
  await expect(goals).toHaveCount(1)
  await expect(goals.getByTestId('goal-title')).toHaveValue('喝水')
  await expect(goals.getByTestId('goal-kind')).toHaveAttribute('data-value', 'interval')
  await expect(goals.getByTestId('goal-slots')).toHaveValue('4')
  await expect(goals.getByTestId('goal-slot-minutes')).toHaveValue('60')
  // The preview shows each window, counted from now (to the minute).
  await expect(goals.getByTestId('goal-slot')).toHaveCount(4)
  await expect(goals.getByTestId('goal-slot').first()).toContainText(/第 1 段 .*\d{2}:\d{2} – .*\d{2}:\d{2}/)
  await expect(goals.getByTestId('goal-achievement-name')).not.toHaveValue('')
  await expect(page.getByTestId('wizard-master')).toContainText('全成就！')
  await expect(page.getByTestId('wizard-import')).toBeEnabled()
  await page.screenshot({ path: path.join(shots, 'p61-01-wizard-interval-zh.png') })
  const before = Date.now()
  await page.getByTestId('wizard-import').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Saved: version 4, four one-off tasks with back-to-back one-hour windows from the import time.
  const data = await readData(userData)
  expect(data.schemaVersion).toBe(5)
  const goal = data.plans[0]!.goals[0]!
  expect(goal.condition).toMatchObject({ kind: 'interval', minutes: 60, count: 4 })
  const start = Date.parse(goal.condition.start as string)
  expect(start % MIN).toBe(0)
  expect(Math.abs(start - Math.floor(before / MIN) * MIN)).toBeLessThanOrEqual(MIN)
  expect(data.tasks.map((t) => t.title)).toEqual(['喝水 (1/4)', '喝水 (2/4)', '喝水 (3/4)', '喝水 (4/4)'])
  data.tasks.forEach((t, i) => {
    expect(t.window).toEqual({ start: new Date(start + i * HOUR).toISOString(), end: new Date(start + (i + 1) * HOUR).toISOString() })
  })
  const [n1, n2] = goal.nodeTaskIds as [string, string]

  // Plans page: 0/4, the first window open, the others not yet.
  const plan = page.getByTestId('plan-card')
  await expect(plan.getByTestId('plan-goal-count')).toHaveText('0/4')
  await expect(plan.getByTestId('plan-progress')).toHaveText('0/4 个时段已完成')
  await expect(plan.getByTestId('plan-node')).toHaveCount(4)
  await expect(plan.getByTestId('plan-node').nth(0)).toHaveAttribute('data-state', 'open')
  await expect(plan.getByTestId('plan-node').nth(1)).toHaveAttribute('data-state', 'upcoming')
  await expect(plan.getByTestId('plan-master')).toHaveAttribute('data-unlocked', 'false')
  await page.screenshot({ path: path.join(shots, 'p61-02-plan-nodes-zh.png') })

  // Tasks page: only the open window has a Complete button; the next ones show when they open.
  await page.getByRole('button', { name: '任务', exact: true }).click()
  await expect(page.getByTestId('task-card')).toHaveCount(4)
  await expect(completeButton(page, '喝水 · 第1/4次')).toBeVisible()
  for (const title of ['喝水 · 第2/4次', '喝水 · 第3/4次', '喝水 · 第4/4次']) {
    await expect(completeButton(page, title)).toHaveCount(0)
    await expect(card(page, title).getByTestId('window-badge')).toHaveAttribute('data-state', 'upcoming')
  }
  await expect(card(page, '喝水 · 第2/4次').getByTestId('window-badge')).toContainText('等待开放')
  await page.screenshot({ path: path.join(shots, 'p61-03-tasks-windows-zh.png') })
  // The tray lists only the open window too.
  expect(await clickTrayItem(app, `quick-complete:${n2}`)).toBe(false)

  await completeButton(page, '喝水 · 第1/4次').click()
  await expect.poll(async () => (await readData(userData)).completions.length).toBe(1)
  // The task's own card only: no goal or "全成就！" yet.
  await expect.poll(async () => (await shown(app)).filter((n) => n.kind === 'achievement').length).toBe(1)
  await page.waitForTimeout(1000)
  expect((await shown(app)).filter((n) => n.kind === 'achievement').map((n) => n.taskTitle)).toEqual(['喝水 · 第1/4次'])
  expect((await readData(userData)).plans[0]!.unlocks).toEqual([])

  // Completing the next windows right away is refused by the main process, whatever the page does.
  const results = await page.evaluate(async (ids) => {
    const out: boolean[] = []
    for (const id of ids) out.push((await window.lifeUnlocked.tasks.complete(id, null)).unlocked)
    return out
  }, goal.nodeTaskIds.slice(1))
  expect(results).toEqual([false, false, false])
  expect((await readData(userData)).completions.map((e) => e.taskId)).toEqual([n1])

  await page.getByRole('button', { name: '计划', exact: true }).click()
  await expect(plan.getByTestId('plan-goal-count')).toHaveText('1/4')
  await expect(plan.getByTestId('plan-progress')).toHaveText('1/4 个时段已完成')
  await expect(plan.getByTestId('plan-node').nth(0)).toHaveAttribute('data-state', 'done')
  await expect(plan.getByTestId('plan-goal')).toHaveAttribute('data-status', 'active')
  await app.close()
})

/** A data file with two timed plans placed relative to now. */
async function seedTimedPlans(userData: string, language: 'zh-CN' | 'en'): Promise<{ last: string; late: string }> {
  const now = Date.now()
  const iso = (t: number): string => new Date(t).toISOString()
  const task = (id: string, title: string, start: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    title,
    description: '',
    createdAt: iso(now - 4 * HOUR),
    updatedAt: iso(now - 4 * HOUR),
    completedAt: null,
    status: 'active',
    timerConfig: null,
    themeOverride: null,
    recurrence: null,
    recurrenceHistory: [],
    skippedOccurrences: [],
    due: null,
    reminderMinutes: null,
    window: { start: iso(start), end: iso(start + HOUR) },
    ...extra
  })
  const achievement = (name: string): Record<string, unknown> => ({ name, description: name, icon: 'heart-pulse', rarity: 'uncommon' })
  // Plan A: windows 1–3 done in time, window 4 open now.
  const a = now - 3 * HOUR - 10 * MIN
  // Plan B: started 2.5 hours ago, nothing done: windows 1–2 missed.
  const b = now - 2.5 * HOUR
  const doneAt = (i: number): number => a + i * HOUR + 5 * MIN
  const tasks = [
    ...[0, 1, 2].map((i) => task(`a${i + 1}`, `Water (${i + 1}/4)`, a + i * HOUR, { status: 'completed', completedAt: iso(doneAt(i)) })),
    task('a4', 'Water (4/4)', a + 3 * HOUR),
    ...[0, 1, 2, 3].map((i) => task(`b${i + 1}`, `Stretch (${i + 1}/4)`, b + i * HOUR))
  ]
  const interval = (id: string, title: string, start: number, prefix: string): Record<string, unknown> => ({
    id,
    title,
    category: 'health',
    quantity: null,
    condition: { kind: 'interval', start: iso(start), minutes: 60, count: 4 },
    after: null,
    taskId: `${prefix}1`,
    nodeTaskIds: [1, 2, 3, 4].map((n) => `${prefix}${n}`),
    startedOn: null,
    achievement: achievement(`${title} badge`)
  })
  const master = { name: language === 'zh-CN' ? '全成就！' : 'All Achievements!', description: '4', icon: 'crown', rarity: 'rare' }
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 4,
      tasks,
      completions: [0, 1, 2].map((i) => ({
        id: `c${i + 1}`, taskId: `a${i + 1}`, occurrence: null, completedAt: iso(doneAt(i)), undoneAt: null, title: `Water (${i + 1}/4)`
      })),
      plans: [
        { id: 'pa', title: 'Hydration', sourceText: '', createdAt: iso(a), updatedAt: iso(a), goals: [interval('ga', 'Water', a, 'a')], master, unlocks: [] },
        { id: 'pb', title: 'Desk breaks', sourceText: '', createdAt: iso(b), updatedAt: iso(b), goals: [interval('gb', 'Stretch', b, 'b')], master, unlocks: [] }
      ],
      settings: { language, notificationDurationSec: 6 }
    })
  )
  return { last: 'a4', late: 'b1' }
}

test('timed plan after a restart: progress from the file, missed windows stay missed, the 4th window unlocks goal + All Achievements!', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-interval-en-'))
  await seedTimedPlans(userData, 'en')
  let { app, page } = await launch(userData)

  const check = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Plans', exact: true }).click()
    const hydration = page.getByTestId('plan-card').filter({ hasText: 'Hydration' })
    const breaks = page.getByTestId('plan-card').filter({ hasText: 'Desk breaks' })
    await expect(hydration.getByTestId('plan-goal-count')).toHaveText('3/4')
    await expect(hydration.getByTestId('plan-node')).toHaveCount(4)
    for (const [i, state] of ['done', 'done', 'done', 'open'].entries()) {
      await expect(hydration.getByTestId('plan-node').nth(i)).toHaveAttribute('data-state', state)
    }
    await expect(breaks.getByTestId('plan-goal')).toHaveAttribute('data-status', 'failed')
    for (const [i, state] of ['missed', 'missed', 'open', 'upcoming'].entries()) {
      await expect(breaks.getByTestId('plan-node').nth(i)).toHaveAttribute('data-state', state)
    }
  }
  await check()
  // Restart: nothing is recomputed from a timer; the same picture comes back from the stored windows.
  await app.close()
  ;({ app, page } = await launch(userData))
  await check()
  await page.screenshot({ path: path.join(shots, 'p61-04-plans-restart-en.png') })

  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  await expect(card(page, 'Stretch · 1 of 4').getByTestId('window-badge')).toHaveAttribute('data-state', 'closed')
  await expect(card(page, 'Stretch · 1 of 4').getByTestId('window-badge')).toContainText('Missed')
  await expect(completeButton(page, 'Stretch · 1 of 4')).toHaveCount(0)
  await expect(completeButton(page, 'Stretch · 3 of 4')).toBeVisible()
  // A missed window cannot be completed through the API either.
  expect(await page.evaluate(async () => (await window.lifeUnlocked.tasks.complete('b1', null)).unlocked)).toBe(false)

  // The 4th window of Hydration: the task, then its goal, then "All Achievements!".
  await completeButton(page, 'Water · 4 of 4').click()
  await expect.poll(async () => (await shown(app)).filter((n) => n.kind === 'achievement').length, { timeout: 8000 }).toBe(3)
  expect((await shown(app)).filter((n) => n.kind === 'achievement').map((n) => n.taskTitle)).toEqual([
    'Water · 4 of 4',
    'Water badge',
    'Hydration'
  ])
  const data = await readData(userData)
  expect(data.plans[0]!.unlocks.map((u) => u.target)).toEqual(['ga', 'plan'])
  expect(data.plans[1]!.unlocks).toEqual([])
  await page.getByRole('button', { name: 'Plans', exact: true }).click()
  const hydration = page.getByTestId('plan-card').filter({ hasText: 'Hydration' })
  await expect(hydration.getByTestId('plan-goal-count')).toHaveText('4/4')
  await expect(hydration.getByTestId('plan-goal')).toHaveAttribute('data-status', 'achieved')
  await expect(hydration.getByTestId('plan-master')).toHaveAttribute('data-unlocked', 'true')

  // Undo inside the open window: both achievements are withdrawn, and it can be done again.
  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  const completion = data.completions.find((e) => e.taskId === 'a4')!.id
  await page.evaluate(async (id) => void (await window.lifeUnlocked.tasks.undoCompletion(id)), completion)
  await expect.poll(async () => (await readData(userData)).plans[0]!.unlocks.every((u) => u.revokedAt !== null)).toBe(true)
  await expect(completeButton(page, 'Water · 4 of 4')).toBeVisible()
  await app.close()
})

test('a window opening while the app runs enables its step; the widget lists only open steps (中文)', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-interval-open-'))
  const now = Date.now()
  const opensAt = now + 9_000
  const iso = (t: number): string => new Date(t).toISOString()
  const node = (id: string, n: number, start: number): Record<string, unknown> => ({
    id, title: `喝水 (${n}/2)`, description: '', createdAt: iso(now), updatedAt: iso(now), completedAt: null, status: 'active',
    timerConfig: null, themeOverride: null, recurrence: null, recurrenceHistory: [], skippedOccurrences: [], due: null,
    reminderMinutes: null, window: { start: iso(start), end: iso(start + 30 * MIN) }
  })
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 4,
      tasks: [node('n1', 1, opensAt), node('n2', 2, opensAt + 30 * MIN)],
      completions: [],
      plans: [
        {
          id: 'p', title: '喝水计划', sourceText: '', createdAt: iso(now), updatedAt: iso(now),
          goals: [
            {
              id: 'g', title: '喝水', category: 'health', quantity: null, condition: { kind: 'interval', start: iso(opensAt), minutes: 30, count: 2 },
              after: null, taskId: 'n1', nodeTaskIds: ['n1', 'n2'], startedOn: null,
              achievement: { name: '补水', description: '', icon: 'heart-pulse', rarity: 'common' }
            }
          ],
          master: { name: '全成就！', description: '', icon: 'crown', rarity: 'uncommon' },
          unlocks: []
        }
      ],
      settings: { language: 'zh-CN', widget: { visible: true } }
    })
  )
  const { app, page } = await launch(userData)
  await expect(card(page, '喝水 · 第1/2次').getByTestId('window-badge')).toHaveAttribute('data-state', 'upcoming')
  await expect(completeButton(page, '喝水 · 第1/2次')).toHaveCount(0)
  expect(await clickTrayItem(app, 'quick-complete:n1')).toBe(false)
  const widget = await expect
    .poll(() => app.windows().some((w) => w.url().includes('widget.html')))
    .toBe(true)
    .then(() => app.windows().find((w) => w.url().includes('widget.html')) as Page)
  await expect(widget.getByText('喝水 · 第1/2次')).toHaveCount(0)

  // Opens on its own, with no other change (page checks every few seconds; the tray every 15 s).
  await expect(completeButton(page, '喝水 · 第1/2次')).toBeVisible({ timeout: 20_000 })
  await expect(card(page, '喝水 · 第1/2次').getByTestId('window-badge')).toHaveAttribute('data-state', 'open')
  await expect(widget.getByTestId('widget-task-title')).toHaveText(['喝水 · 第1/2次'], { timeout: 10_000 })
  await expect.poll(() => clickTrayItem(app, 'quick-complete:n1'), { timeout: 20_000, intervals: [1000] }).toBe(true)
  // The tray click completed it: same record and notification as a click in the app.
  await expect.poll(async () => (await readData(userData)).completions.map((e) => e.taskId)).toEqual(['n1'])
  await expect(completeButton(page, '喝水 · 第2/2次')).toHaveCount(0)
  expect((await readData(userData)).plans[0]!.unlocks).toEqual([])
  await app.close()
})

test('English: "drink water every hour" without a length is never imported as an endless task', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-interval-missing-'))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 4, tasks: [], completions: [], plans: [], settings: { language: 'en' } })
  )
  const { app, page } = await launch(userData)
  await page.getByTestId('tasks-smart-plan').click()
  await page.getByTestId('wizard-input').fill('drink water every hour')
  await page.getByTestId('wizard-parse').click()
  const goal = page.getByTestId('wizard-goal')
  await expect(goal.getByTestId('goal-kind')).toHaveAttribute('data-value', 'interval')
  await expect(goal.getByTestId('goal-slots')).toHaveValue('')
  await expect(goal.getByTestId('goal-problem')).toContainText('enter how many slots (60 minutes each)')
  await expect(page.getByTestId('wizard-import')).toBeDisabled()
  await goal.getByTestId('goal-slots').fill('3')
  await expect(goal.getByTestId('goal-slot')).toHaveCount(3)
  await expect(page.getByTestId('wizard-master')).toContainText('All Achievements!')
  await expect(page.getByTestId('wizard-import')).toBeEnabled()
  await page.getByTestId('wizard-import').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const data = await readData(userData)
  expect(data.tasks.map((t) => t.title)).toEqual(['Drink water (1/3)', 'Drink water (2/3)', 'Drink water (3/3)'])
  expect(data.tasks.every((t) => t.window !== null)).toBe(true)
  expect(data.plans[0]!.goals[0]!.condition).toMatchObject({ kind: 'interval', minutes: 60, count: 3 })
  await app.close()
})
