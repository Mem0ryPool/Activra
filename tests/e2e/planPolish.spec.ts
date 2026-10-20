import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, shots, widgetPage } from './helpers'

/**
 * Phase 6.3: timed goals as one block per slot, a duplicate check before importing a plan, one name
 * for a timed step on every surface (task list, Plans page, widget, tray, notification, undo toast),
 * and wizard hints next to the field that needs them. Display and checks only.
 */

interface Shown {
  id: string
  kind: string
  heading: string
  taskTitle: string
}
interface MenuItem {
  id: string
  label?: string
  submenu?: MenuItem[]
}
interface Hooks {
  notifications: () => { active: string | null; shown: Shown[] }
  clickTrayItem: (id: string) => boolean
  tray: () => { exists: boolean; items: MenuItem[] }
}
const shown = (app: ElectronApplication): Promise<Shown[]> =>
  app.evaluate(() => (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.notifications().shown)
const clickTrayItem = (app: ElectronApplication, id: string): Promise<boolean> =>
  app.evaluate((_e, itemId) => (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.clickTrayItem(itemId), id)
const quickCompleteLabels = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => {
    const items = (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.tray().items
    return (items.find((i) => i.id === 'quick-complete')?.submenu ?? []).map((i) => i.label ?? '')
  })

interface Data {
  schemaVersion: number
  tasks: { id: string; title: string; status: string }[]
  completions: { id: string; taskId: string; undoneAt: string | null; title: string }[]
  plans: { id: string; title: string; unlocks: { target: string; revokedAt: string | null }[] }[]
}
const readData = async (userData: string): Promise<Data> =>
  JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as Data

const MIN = 60_000
const HOUR = 60 * MIN
const iso = (t: number): string => new Date(t).toISOString()

async function fresh(language: 'zh-CN' | 'en', prefix: string, extra: Record<string, unknown> = {}): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), prefix))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 4, tasks: [], completions: [], plans: [], settings: { language, notificationDurationSec: 3, ...extra } })
  )
  return userData
}

/**
 * A stored 4-slot plan "喝水" whose first slot starts at `start`; slots in `done` were completed in time.
 * Written as the app would have saved it (schema 4), so the page reads real records.
 */
async function seedTimedPlan(
  userData: string,
  opts: { start: number; done: number[]; language: 'zh-CN' | 'en'; title?: string; extraTasks?: Record<string, unknown>[]; settings?: Record<string, unknown> }
): Promise<string[]> {
  const name = opts.title ?? '喝水'
  const created = opts.start - MIN
  const ids = [1, 2, 3, 4].map((n) => `w${n}`)
  const task = (i: number): Record<string, unknown> => ({
    id: ids[i],
    title: `${name} (${i + 1}/4)`,
    description: '',
    createdAt: iso(created),
    updatedAt: iso(created),
    completedAt: opts.done.includes(i) ? iso(opts.start + i * HOUR + 5 * MIN) : null,
    status: opts.done.includes(i) ? 'completed' : 'active',
    timerConfig: null,
    themeOverride: null,
    recurrence: null,
    recurrenceHistory: [],
    skippedOccurrences: [],
    due: null,
    reminderMinutes: null,
    window: { start: iso(opts.start + i * HOUR), end: iso(opts.start + (i + 1) * HOUR) }
  })
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 4,
      tasks: [...[0, 1, 2, 3].map(task), ...(opts.extraTasks ?? [])],
      completions: opts.done.map((i) => ({
        id: `c${i + 1}`,
        taskId: ids[i],
        occurrence: null,
        completedAt: iso(opts.start + i * HOUR + 5 * MIN),
        undoneAt: null,
        title: `${name} (${i + 1}/4)`
      })),
      plans: [
        {
          id: 'p1',
          title: opts.language === 'zh-CN' ? '4小时喝水挑战' : 'Drink water: 4-hour challenge',
          sourceText: '',
          createdAt: iso(created),
          updatedAt: iso(created),
          goals: [
            {
              id: 'g1',
              title: name,
              category: 'health',
              quantity: null,
              condition: { kind: 'interval', start: iso(opts.start), minutes: 60, count: 4 },
              after: null,
              taskId: ids[0],
              nodeTaskIds: ids,
              startedOn: null,
              achievement: { name: `${name}达人`, description: '4', icon: 'heart-pulse', rarity: 'uncommon' }
            }
          ],
          master: { name: opts.language === 'zh-CN' ? '全成就！' : 'All Achievements!', description: '4', icon: 'crown', rarity: 'rare' },
          unlocks: []
        }
      ],
      settings: { language: opts.language, notificationDurationSec: 3, ...opts.settings }
    })
  )
  return ids
}

const nodeStates = (page: Page) => page.getByTestId('plan-node').evaluateAll((els) => els.map((e) => e.getAttribute('data-state')))

test('分段进度条: four states with icons and text, details on hover/click, slots move on with the clock, same after a restart', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-segments-'))
  // Slot 1 done, slot 2 missed, slot 3 open for ~20 more seconds, then slot 4 opens.
  const start = Date.now() + 20_000 - 3 * HOUR
  await seedTimedPlan(userData, { start, done: [0], language: 'zh-CN', settings: { appearance: 'dark' } })
  let { app, page } = await launch(userData)
  await page.getByRole('button', { name: '计划', exact: true }).click()
  const plan = page.getByTestId('plan-card')
  await expect(plan.getByTestId('plan-progress')).toHaveText('1/4 个时段已完成')
  await expect(plan.getByTestId('plan-goal-count')).toHaveText('1/4')
  expect(await nodeStates(page)).toEqual(['done', 'missed', 'open', 'upcoming'])
  // No plain bar for a timed goal; every block says its slot, window and state in words.
  await expect(plan.getByTestId('plan-goal').getByRole('progressbar')).toHaveCount(0)
  const nodes = plan.getByTestId('plan-node')
  await expect(nodes.nth(0)).toHaveAttribute('aria-label', /^第 1 段 · \S.* · 已完成$/)
  await expect(nodes.nth(1)).toHaveAttribute('aria-label', /^第 2 段 · .* · 已错过$/)
  await expect(nodes.nth(2)).toHaveAttribute('aria-label', /^第 3 段 · .* · 当前可完成$/)
  await expect(nodes.nth(3)).toHaveAttribute('aria-label', /^第 4 段 · .* · 等待开放$/)
  // Each state has its own icon, not only a color.
  const icons = await nodes.evaluateAll((els) => els.map((e) => e.querySelector('svg')?.getAttribute('class') ?? ''))
  expect(new Set(icons.map((c) => c.split(' ').find((x) => x.startsWith('lucide-') && x !== 'lucide-icon'))).size).toBe(4)
  // Hover: tooltip and the line below; click keeps it there; keyboard focus does the same.
  await expect(nodes.nth(3)).toHaveAttribute('title', /第 4 段 · \d{2}:\d{2} – .*\d{2}:\d{2} · 等待开放/)
  await nodes.nth(1).hover()
  await expect(plan.getByTestId('plan-segment-detail')).toContainText(/第 2 段 · \d{2}:\d{2} – \d{2}:\d{2} · 已错过/)
  await nodes.nth(0).click()
  await page.mouse.move(5, 5)
  await expect(plan.getByTestId('plan-segment-detail')).toContainText('第 1 段')
  await expect(nodes.nth(0)).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Tab')
  await expect(nodes.nth(1)).toBeFocused()
  await expect(plan.getByTestId('plan-segment-detail')).toContainText('第 2 段')
  // The legend now lives under 查看详情.
  await plan.getByTestId('plan-details-toggle').click()
  await expect(plan.getByTestId('plan-segment-legend').getByRole('listitem')).toHaveText(['已完成', '当前可完成', '等待开放', '已错过'])
  await page.screenshot({ path: path.join(shots, 'p63-01-segments-dark-zh.png') })

  // The clock moves on: slot 3 closes unfinished (missed), slot 4 opens; nothing else changes.
  await expect.poll(() => nodeStates(page), { timeout: 30_000, intervals: [1000] }).toEqual(['done', 'missed', 'missed', 'open'])
  await expect(plan.getByTestId('plan-goal')).toHaveAttribute('data-status', 'failed')
  await expect(plan.getByTestId('plan-goal-count')).toHaveText('1/4')
  await app.close()

  // A restart (now in the light appearance) reads the same picture from the file.
  const file = path.join(userData, 'life-unlocked-data.json')
  const data = JSON.parse(await readFile(file, 'utf8')) as { settings: Record<string, unknown> }
  data.settings['appearance'] = 'light'
  await writeFile(file, JSON.stringify(data))
  ;({ app, page } = await launch(userData))
  await page.getByRole('button', { name: '计划', exact: true }).click()
  expect(await nodeStates(page)).toEqual(['done', 'missed', 'missed', 'open'])
  await expect(page.getByTestId('plan-progress')).toHaveText('1/4 个时段已完成')
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light')
  await page.screenshot({ path: path.join(shots, 'p63-02-segments-light-zh.png') })
  await app.close()
})

test('分段进度条: many slots wrap without horizontal overflow; day and daily plans keep their plain bar', async () => {
  const userData = await fresh('zh-CN', 'lu-segments-many-', { appearance: 'light' })
  const { app, page } = await launch(userData)
  await page.getByRole('button', { name: '计划', exact: true }).click()
  for (const text of ['未来24小时每30分钟站起来活动', '未来7天每天健身']) {
    await page.getByTestId('open-plan-wizard').click()
    await page.getByTestId('wizard-input').fill(text)
    await page.getByTestId('wizard-parse').click()
    await page.getByTestId('wizard-import').click()
    await expect(page.getByTestId('wizard-preview')).toHaveCount(0)
  }
  const many = page.getByTestId('plan-card').filter({ hasText: '站起来活动' })
  await expect(many.getByTestId('plan-node')).toHaveCount(48)
  await expect(many.getByTestId('plan-progress')).toHaveText('0/48 个时段已完成')
  // Rows of at most 12; nothing wider than the card.
  const fits = await many.evaluate((card) => {
    const list = card.querySelector('[data-testid=plan-segments]') as HTMLElement
    const tops = new Set(Array.from(list.querySelectorAll('[data-testid=plan-node]')).map((b) => Math.round(b.getBoundingClientRect().top)))
    return { rows: tops.size, inside: list.scrollWidth <= list.clientWidth + 1, card: card.scrollWidth <= card.clientWidth + 1 }
  })
  expect(fits).toEqual({ rows: 4, inside: true, card: true })
  // The window can be made narrow: still no horizontal scroll.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))?.setSize(820, 640))
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect.poll(() => many.evaluate((c) => c.scrollWidth <= c.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: path.join(shots, 'p63-03-segments-many-light-zh.png') })
  const daily = page.getByTestId('plan-card').filter({ hasText: '健身' })
  await expect(daily.getByTestId('plan-segments')).toHaveCount(0)
  await expect(daily.getByTestId('plan-node')).toHaveCount(0)
  // A one-goal day plan shows its bar at the top of the card (Phase 6.5).
  await expect(daily.getByTestId('plan-progress-bar').getByRole('progressbar')).toHaveCount(1)
  await app.close()
})

test('名称一致: a timed step reads "喝水 · 第1/4次" in the list, widget, tray, notification and undo toast; undo and the burst stay correct', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-names-'))
  const now = Date.now()
  const plain = {
    id: 't-plain', title: '买牛奶', description: '', createdAt: iso(now - HOUR), updatedAt: iso(now - HOUR), completedAt: null,
    status: 'active', timerConfig: null, themeOverride: null, recurrence: null, recurrenceHistory: [], skippedOccurrences: [],
    due: null, reminderMinutes: null, window: null
  }
  await seedTimedPlan(userData, {
    start: now - 10 * MIN,
    done: [],
    language: 'zh-CN',
    extraTasks: [plain],
    settings: { widget: { visible: true, alwaysOnTop: false, opacity: 1, shape: 'rounded', animation: 'fade', appearance: 'dark' } }
  })
  const { app, page } = await launch(userData, { LIFE_UNLOCKED_BURST_IDLE_MS: '4000' })
  const card = page.getByTestId('task-card').filter({ has: page.getByTestId('task-title').filter({ hasText: '喝水 · 第1/4次' }) })
  await expect(page.getByTestId('task-title')).toContainText(['喝水 · 第1/4次'])
  await expect(card.getByTestId('task-title')).toHaveAttribute('title', '喝水 · 第1/4次')
  const widget = await widgetPage(app)
  await expect(widget.getByTestId('widget-task-title')).toHaveText(['喝水 · 第1/4次', '买牛奶'])
  await expect.poll(() => quickCompleteLabels(app)).toEqual(['喝水 · 第1/4次', '买牛奶'])

  // Main window: notification and undo toast use the same name; the record keeps the stored title.
  await card.getByRole('button', { name: '完成' }).click()
  await expect(page.getByTestId('undo-toast-title')).toHaveText('喝水 · 第1/4次')
  await expect.poll(async () => (await shown(app)).filter((n) => n.kind === 'achievement').map((n) => n.taskTitle)).toEqual(['喝水 · 第1/4次'])
  // The tray completes the plain task in the same round: the summary names both, as shown.
  expect(await clickTrayItem(app, 'quick-complete:t-plain')).toBe(true)
  await expect
    .poll(async () => (await shown(app)).filter((n) => n.kind === 'summary').map((n) => n.taskTitle), { timeout: 10_000 })
    .toEqual([expect.stringContaining('喝水 · 第1/4次')])
  let data = await readData(userData)
  expect(data.completions.map((c) => c.title)).toEqual(['喝水 (1/4)', '买牛奶'])
  expect(data.tasks.find((t) => t.id === 'w1')?.title).toBe('喝水 (1/4)')

  // Undo the step: record kept but undone, the step is open again, no achievement counted.
  await page.getByTestId('undo-toast').filter({ hasText: '喝水 · 第1/4次' }).getByRole('button', { name: '撤销' }).click()
  await expect.poll(async () => (await readData(userData)).completions.find((c) => c.taskId === 'w1')?.undoneAt).not.toBeNull()
  await expect(card.getByRole('button', { name: '完成' })).toBeVisible()
  await expect(widget.getByTestId('widget-task-title')).toHaveText(['喝水 · 第1/4次', '买牛奶'])
  await page.getByRole('button', { name: '成就', exact: true }).click()
  await expect(page.getByTestId('achievement')).toHaveText([/买牛奶/])

  // The widget completes it again: its own undo toast and the notification use the same name.
  await widget.getByRole('checkbox', { name: /喝水 · 第1\/4次/ }).click()
  await expect(widget.getByTestId('undo-toast-title')).toHaveText('喝水 · 第1/4次')
  await expect.poll(async () => (await shown(app)).filter((n) => n.kind === 'achievement').map((n) => n.taskTitle).at(-1)).toBe('喝水 · 第1/4次')
  const toast = (await widgetOrNotification(app)).getByTestId('achievement-card')
  await expect(toast).toContainText('喝水 · 第1/4次')
  await page.getByRole('button', { name: '成就', exact: true }).click()
  await expect(page.getByTestId('achievement')).toHaveText([/喝水 · 第1\/4次/, /买牛奶/])
  data = await readData(userData)
  expect(data.completions.filter((c) => c.undoneAt === null).map((c) => c.taskId).sort()).toEqual(['t-plain', 'w1'])
  expect(data.plans[0]!.unlocks).toEqual([])
  await page.getByRole('button', { name: '任务', exact: true }).click()
  await page.screenshot({ path: path.join(shots, 'p63-04-names-tasks-zh.png') })
  await widget.screenshot({ path: path.join(shots, 'p63-05-names-widget-zh.png') })
  await app.close()
})

async function widgetOrNotification(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('notification.html'))).toBe(true)
  return app.windows().find((w) => w.url().includes('notification.html')) as Page
}

test('Names (English): "Water · 1 of 4" in the list, widget and tray; ordinary tasks unchanged', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-names-en-'))
  await seedTimedPlan(userData, {
    start: Date.now() - 10 * MIN,
    done: [],
    language: 'en',
    title: 'Water',
    settings: { widget: { visible: true, alwaysOnTop: false, opacity: 1, shape: 'rounded', animation: 'fade', appearance: 'light' } }
  })
  const { app, page } = await launch(userData)
  await expect(page.getByTestId('task-title')).toContainText(['Water · 1 of 4'])
  const widget = await widgetPage(app)
  await expect(widget.getByTestId('widget-task-title')).toHaveText(['Water · 1 of 4'])
  await expect.poll(() => quickCompleteLabels(app)).toEqual(['Water · 1 of 4'])
  expect(await clickTrayItem(app, 'quick-complete:w1')).toBe(true)
  await expect.poll(async () => (await shown(app)).filter((n) => n.kind === 'achievement').map((n) => n.taskTitle)).toEqual(['Water · 1 of 4'])
  expect((await readData(userData)).completions.map((c) => c.title)).toEqual(['Water (1/4)'])
  await app.close()
})

test('重复计划提醒: exact and similar plans, view / create anyway / go back, and no double import', async () => {
  const userData = await fresh('zh-CN', 'lu-duplicates-')
  const { app, page } = await launch(userData)
  await page.getByRole('button', { name: '计划', exact: true }).click()
  const openWizard = async (text: string): Promise<void> => {
    await page.getByTestId('open-plan-wizard').click()
    await page.getByTestId('wizard-input').fill(text)
    await page.getByTestId('wizard-parse').click()
  }
  await openWizard('接下来4个小时内每个小时都喝水')
  await expect(page.getByTestId('wizard-duplicate')).toHaveCount(0)
  // A fast double click imports once.
  await page.getByTestId('wizard-import').dblclick()
  await expect(page.getByTestId('plan-card')).toHaveCount(1)
  await page.waitForTimeout(500)
  expect((await readData(userData)).plans).toHaveLength(1)
  const firstId = (await readData(userData)).plans[0]!.id

  // The same again (other wording): an exact duplicate, nothing created yet.
  await openWizard('未来四个小时每小时喝水')
  await page.getByTestId('wizard-import').click()
  const notice = page.getByTestId('wizard-duplicate')
  await expect(notice).toHaveAttribute('data-level', 'exact')
  await expect(notice).toContainText('已经有一个相同的计划')
  await expect(notice.getByTestId('wizard-duplicate-plan')).toHaveText([/4小时喝水挑战.*完全重复/])
  await expect(page.getByTestId('wizard-import')).toBeDisabled()
  await page.screenshot({ path: path.join(shots, 'p63-06-duplicate-exact-zh.png') })
  // "返回修改": the notice goes, the preview stays for editing.
  await notice.getByTestId('duplicate-edit').click()
  await expect(notice).toHaveCount(0)
  await expect(page.getByTestId('wizard-plan-title')).toBeFocused()
  await expect(page.getByTestId('wizard-import')).toBeEnabled()
  // "查看已有计划": the wizard closes and that plan is outlined.
  await page.getByTestId('wizard-import').click()
  await page.getByTestId('duplicate-view').click()
  await expect(page.getByTestId('wizard-preview')).toHaveCount(0)
  await expect(page.locator(`[data-testid=plan-card][data-plan="${firstId}"]`)).toHaveAttribute('data-highlighted', 'true')
  expect((await readData(userData)).plans).toHaveLength(1)

  // "仍然创建" (clicked twice quickly): exactly one more plan, the old one untouched.
  const before = (await readData(userData)).plans[0]
  await openWizard('接下来4个小时内每个小时都喝水')
  await page.getByTestId('wizard-import').click()
  await page.getByTestId('duplicate-create').dblclick()
  await expect(page.getByTestId('plan-card')).toHaveCount(2)
  await page.waitForTimeout(500)
  let data = await readData(userData)
  expect(data.plans).toHaveLength(2)
  expect(data.tasks).toHaveLength(8)
  expect(data.plans.find((p) => p.id === firstId)).toEqual(before)

  // Same task with other numbers: "可能相似".
  await openWizard('接下来3小时每小时喝水')
  await page.getByTestId('wizard-import').click()
  await expect(page.getByTestId('wizard-duplicate')).toHaveAttribute('data-level', 'similar')
  await expect(page.getByTestId('wizard-duplicate-plan').first()).toContainText('可能相似')
  await page.screenshot({ path: path.join(shots, 'p63-07-duplicate-similar-zh.png') })
  // Editing the plan clears the notice; it is checked again on the next import.
  await page.getByTestId('goal-slots').fill('2')
  await expect(page.getByTestId('wizard-duplicate')).toHaveCount(0)
  await page.getByRole('button', { name: '返回修改' }).click()

  // The same plan name with other content is imported straight away.
  await page.getByTestId('wizard-input').fill('未来7天每天健身')
  await page.getByTestId('wizard-parse').click()
  await page.getByTestId('wizard-plan-title').fill('4小时喝水挑战')
  await page.getByTestId('wizard-import').click()
  await expect(page.getByTestId('wizard-preview')).toHaveCount(0)
  data = await readData(userData)
  expect(data.plans.map((p) => p.title).filter((t) => t === '4小时喝水挑战')).toHaveLength(2)
  expect(data.plans).toHaveLength(3)
  await app.close()
})

test('Duplicate check (English) and a deleted plan is no longer a duplicate', async () => {
  const userData = await fresh('en', 'lu-duplicates-en-', { appearance: 'light' })
  const { app, page } = await launch(userData)
  await page.getByRole('button', { name: 'Plans', exact: true }).click()
  const importText = async (text: string): Promise<void> => {
    await page.getByTestId('open-plan-wizard').click()
    await page.getByTestId('wizard-input').fill(text)
    await page.getByTestId('wizard-parse').click()
    await page.getByTestId('wizard-import').click()
  }
  await importText('Work out every day for the next 7 days')
  await expect(page.getByTestId('plan-card')).toHaveCount(1)
  await importText('Work out every day for the next 7 days')
  const notice = page.getByTestId('wizard-duplicate')
  await expect(notice).toContainText('You already have this plan')
  await expect(notice.getByRole('button')).toHaveText(['View existing plan', 'Create anyway', 'Go back and edit'])
  await page.screenshot({ path: path.join(shots, 'p63-08-duplicate-en-light.png') })
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await expect(page.getByTestId('wizard-preview')).toHaveCount(0)
  await page.getByTestId('plan-card').getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete plan' }).click()
  await page.getByTestId('confirm-delete-plan').click()
  await expect(page.getByTestId('plan-card')).toHaveCount(0)
  await importText('Work out every day for the next 7 days')
  await expect(page.getByTestId('wizard-preview')).toHaveCount(0)
  await expect(page.getByTestId('plan-card')).toHaveCount(1)
  await app.close()
})

test('识别失败提示: each missing number is named at the top and explained once at its field; fixing clears it', async () => {
  const userData = await fresh('zh-CN', 'lu-hints-', { appearance: 'light' })
  const { app, page } = await launch(userData)
  await page.getByRole('button', { name: '计划', exact: true }).click()
  await page.getByTestId('open-plan-wizard').click()
  await page.getByTestId('wizard-input').fill('每天背单词')
  await page.getByTestId('wizard-parse').click()
  const needs = page.getByTestId('wizard-needs')
  await expect(needs.getByTestId('wizard-need')).toHaveText([/缺少「持续天数」/, /缺少「需完成天数」/])
  const goal = page.getByTestId('wizard-goal')
  await expect(goal.getByTestId('goal-problem')).toHaveCount(2)
  await expect(goal.getByTestId('goal-days')).toHaveAttribute('aria-describedby', /goal-days|-days-hint/)
  const hintId = await goal.getByTestId('goal-days').getAttribute('aria-describedby')
  await expect(page.locator(`[id="${hintId}"]`)).toHaveText('没有说要持续多少天。请填写天数，例如 30。')
  await expect(page.getByTestId('wizard-import')).toBeDisabled()
  await expect(page.getByTestId('wizard-import')).toHaveAttribute('aria-describedby', 'wizard-needs')
  await page.screenshot({ path: path.join(shots, 'p63-09-hints-light-zh.png') })
  // The second "去修改" goes straight to its own field (keyboard: Enter on the button).
  await needs.getByRole('button', { name: '去修改' }).nth(1).focus()
  await page.keyboard.press('Enter')
  await expect(goal.getByTestId('goal-required')).toBeFocused()
  await goal.getByTestId('goal-days').fill('30')
  await expect(needs.getByTestId('wizard-need')).toHaveText([/缺少「需完成天数」/])
  await expect(goal.getByTestId('goal-days')).not.toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByTestId('wizard-import')).toBeDisabled()
  await goal.getByTestId('goal-required').fill('40')
  await expect(needs.getByTestId('wizard-need')).toHaveText([/「需完成天数」与其他数字不一致/])
  await expect(goal.getByTestId('goal-problem')).toHaveText('超过了这段时间内可完成的天数。')
  await expect(page.getByTestId('wizard-import')).toBeDisabled()
  await goal.getByTestId('goal-required').fill('20')
  await expect(page.getByTestId('wizard-needs')).toHaveCount(0)
  await expect(goal.getByTestId('goal-problem')).toHaveCount(0)
  await expect(page.getByTestId('wizard-import')).toBeEnabled()
  await app.close()
})
