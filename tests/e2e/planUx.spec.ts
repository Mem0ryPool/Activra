import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launch, shots } from './helpers'

/**
 * Phase 6.2: plan names from the goals, examples that fill in the text, timed nodes shown as
 * "喝水 · 第2/4次" with their window and state, plan progress at a glance, and plain feedback when
 * the text leaves out how long. Stored data keeps the Phase 6.1 shape.
 */

interface Data {
  schemaVersion: number
  tasks: { id: string; title: string; description: string; window: { start: string; end: string } | null }[]
  completions: { id: string; taskId: string; undoneAt: string | null }[]
  plans: { title: string; goals: { nodeTaskIds: string[] }[]; unlocks: { target: string; revokedAt: string | null }[] }[]
}
const readData = async (userData: string): Promise<Data> =>
  JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as Data

const card = (page: Page, title: string) => page.getByTestId('task-card').filter({ has: page.getByTestId('task-title').getByText(title, { exact: true }) })

async function fresh(language: 'zh-CN' | 'en', prefix: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), prefix))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 4, tasks: [], completions: [], plans: [], settings: { language, notificationDurationSec: 3 } })
  )
  return userData
}

const MIN = 60_000
const HOUR = 60 * MIN

test('示例「4小时喝水挑战」: fills the text, names the plan, shows compact timed tasks and plan progress', async () => {
  test.setTimeout(90_000)
  const userData = await fresh('zh-CN', 'lu-plan-ux-zh-')
  const { app, page } = await launch(userData)

  // An ordinary task and a daily one, to check they look as before.
  await page.evaluate(async () => {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    await window.lifeUnlocked.tasks.create({ title: '买牛奶', description: '全脂', timerDurationSec: null, themeOverride: null })
    await window.lifeUnlocked.tasks.create({
      title: '背单词',
      description: '',
      timerDurationSec: null,
      themeOverride: null,
      recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: today, endDate: null }
    })
  })

  await page.getByTestId('tasks-smart-plan').click()
  const chips = page.getByTestId('wizard-example')
  await expect(chips).toHaveText(['4小时喝水挑战', '7天健身挑战', '本周学习计划'])
  await chips.nth(1).click()
  await expect(page.getByTestId('wizard-input')).toHaveValue('未来7天每天健身')
  await chips.nth(0).click()
  const input = page.getByTestId('wizard-input')
  await expect(input).toHaveValue('接下来4个小时内每个小时都喝水')
  await expect(input).toBeFocused()
  // Still the user's text: it can be edited before the preview.
  await input.press('End')
  await input.pressSequentially('。')
  await expect(input).toHaveValue('接下来4个小时内每个小时都喝水。')
  await page.screenshot({ path: path.join(shots, 'p62-01-wizard-examples-zh.png') })
  await page.getByTestId('wizard-parse').click()

  await expect(page.getByTestId('wizard-plan-title')).toHaveValue('4小时喝水挑战')
  await expect(page.getByTestId('wizard-needs')).toHaveCount(0)
  // The name stays the user's choice.
  await page.getByTestId('wizard-plan-title').fill('下午喝水挑战')
  await page.getByTestId('goal-slots').fill('4')
  await expect(page.getByTestId('wizard-plan-title')).toHaveValue('下午喝水挑战')
  await page.getByTestId('wizard-import').click()

  const plan = page.getByTestId('plan-card')
  await expect(plan.getByTestId('plan-title')).toHaveText('下午喝水挑战')
  await expect(plan.getByTestId('plan-progress')).toHaveText('0/4 个时段已完成')
  // Phase 6.3: one block per slot instead of a bar; the count stays as text.
  await expect(plan.getByTestId('plan-goal').getByRole('progressbar')).toHaveCount(0)
  await expect(plan.getByTestId('plan-node')).toHaveCount(4)
  await expect(plan.getByTestId('plan-goal-count')).toHaveText('0/4')
  await plan.getByTestId('plan-details-toggle').click()
  await expect(plan.getByTestId('plan-current-slot')).toContainText('当前时段：第 1 段')
  await expect(plan.getByTestId('plan-next-slot')).toContainText(/下一个时段 .*\d{2}:\d{2} 开始/)
  await expect(plan.getByTestId('plan-missed-slots')).toHaveCount(0)
  await expect(plan.getByTestId('plan-node').nth(0)).toHaveAttribute('aria-label', /^第 1 段 · .* · 当前可完成$/)
  await expect(plan.getByTestId('plan-node').nth(1)).toHaveAttribute('aria-label', /^第 2 段 · .* · 等待开放$/)

  await page.getByRole('button', { name: '任务', exact: true }).click()
  await expect(page.getByTestId('task-card')).toHaveCount(6)
  const first = card(page, '喝水 · 第1/4次')
  await expect(first.getByTestId('window-state')).toHaveText('· 当前可完成')
  await expect(first.getByRole('button', { name: '完成' })).toBeVisible()
  for (const n of [2, 3, 4]) {
    const node = card(page, `喝水 · 第${n}/4次`)
    await expect(node.getByTestId('window-state')).toHaveText('· 等待开放')
    await expect(node.getByTestId('window-badge')).toContainText(/\d{2}:\d{2} – .*\d{2}:\d{2}/)
    await expect(node.getByRole('button', { name: '完成' })).toHaveCount(0)
  }
  // The plan's long text is not repeated on every node card.
  await expect(page.getByTestId('task-card').filter({ hasText: '下午喝水挑战' })).toHaveCount(0)
  // Ordinary and daily tasks are shown as before.
  await expect(card(page, '买牛奶')).toContainText('全脂')
  await expect(card(page, '买牛奶').getByTestId('window-badge')).toHaveCount(0)
  await expect(card(page, '背单词').getByTestId('repeat-badge')).toBeVisible()
  await expect(card(page, '背单词').getByTestId('window-badge')).toHaveCount(0)
  await page.screenshot({ path: path.join(shots, 'p62-02-tasks-nodes-zh.png') })

  // Stored records keep their meaning and shape.
  let data = await readData(userData)
  expect(data.schemaVersion).toBe(5)
  expect(data.tasks.filter((t) => t.window).map((t) => t.title)).toEqual(['喝水 (1/4)', '喝水 (2/4)', '喝水 (3/4)', '喝水 (4/4)'])
  expect(data.tasks.find((t) => t.title === '喝水 (2/4)')?.description).toContain('下午喝水挑战')

  await first.getByRole('button', { name: '完成' }).click()
  await expect.poll(async () => (await readData(userData)).completions.length).toBe(1)
  await expect(page.getByTestId('task-card')).toHaveCount(5)
  await page.getByRole('tab', { name: /已完成/ }).click()
  const done = card(page, '喝水 · 第1/4次')
  await expect(done.getByTestId('window-badge')).toContainText('已完成')

  await page.getByRole('button', { name: '计划', exact: true }).click()
  await expect(plan.getByTestId('plan-progress')).toHaveText('1/4 个时段已完成')
  await expect(plan.getByTestId('plan-goal-count')).toHaveText('1/4')
  await expect(plan.getByTestId('plan-node').nth(0)).toHaveAttribute('data-state', 'done')
  await expect(plan.getByTestId('plan-node').nth(0)).toHaveAttribute('aria-label', /已完成$/)
  await plan.getByTestId('plan-details-toggle').click()
  await expect(plan.getByTestId('plan-current-slot')).toHaveText('当前没有开放的时段')
  await expect(plan.getByTestId('plan-master')).toHaveAttribute('data-unlocked', 'false')
  await page.screenshot({ path: path.join(shots, 'p62-03-plan-progress-zh.png') })

  // Undo: the record is marked undone, the node can be completed again, progress goes back.
  data = await readData(userData)
  await page.evaluate(async (id) => void (await window.lifeUnlocked.tasks.undoCompletion(id)), data.completions[0]!.id)
  await expect(plan.getByTestId('plan-progress')).toHaveText('0/4 个时段已完成')
  data = await readData(userData)
  expect(data.completions).toHaveLength(1)
  expect(data.completions[0]!.undoneAt).not.toBeNull()
  await page.getByRole('button', { name: '任务', exact: true }).click()
  await expect(card(page, '喝水 · 第1/4次').getByRole('button', { name: '完成' })).toBeVisible()

  // A restart shows the same.
  await app.close()
  const again = await launch(userData)
  await expect(card(again.page, '喝水 · 第1/4次').getByTestId('window-state')).toHaveText('· 当前可完成')
  await expect(card(again.page, '喝水 · 第2/4次').getByTestId('window-state')).toHaveText('· 等待开放')
  await again.app.close()
})

test('missed slots: the task says 已错过, the plan counts them, and nothing unlocks without every slot', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-plan-ux-missed-'))
  const now = Date.now()
  const iso = (t: number): string => new Date(t).toISOString()
  // Started 90 minutes ago: slot 1 missed, slot 2 open, slots 3–4 later.
  const start = now - 90 * MIN
  const tasks = [1, 2, 3, 4].map((n) => ({
    id: `n${n}`,
    title: `喝水 (${n}/4)`,
    description: '喝水挑战 · 4 小时内每小时完成一次「喝水」，共 4 次',
    createdAt: iso(start),
    updatedAt: iso(start),
    completedAt: null,
    status: 'active',
    timerConfig: null,
    themeOverride: null,
    recurrence: null,
    recurrenceHistory: [],
    skippedOccurrences: [],
    due: null,
    reminderMinutes: null,
    window: { start: iso(start + (n - 1) * HOUR), end: iso(start + n * HOUR) }
  }))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 4,
      tasks,
      completions: [],
      plans: [
        {
          id: 'p1',
          title: '喝水挑战',
          sourceText: '接下来4个小时内每个小时都喝水',
          createdAt: iso(start),
          updatedAt: iso(start),
          goals: [
            {
              id: 'g1',
              title: '喝水',
              category: 'health',
              quantity: null,
              condition: { kind: 'interval', start: iso(start), minutes: 60, count: 4 },
              after: null,
              taskId: 'n1',
              nodeTaskIds: ['n1', 'n2', 'n3', 'n4'],
              startedOn: null,
              achievement: { name: '自律饮食', description: '4 小时内每小时完成一次「喝水」，共 4 次', icon: 'heart-pulse', rarity: 'uncommon' }
            }
          ],
          master: { name: '全成就！', description: '按时完成本计划全部 4 个时段', icon: 'crown', rarity: 'rare' },
          unlocks: []
        }
      ],
      settings: { language: 'zh-CN', notificationDurationSec: 3 }
    })
  )
  const { app, page } = await launch(userData)
  await expect(card(page, '喝水 · 第1/4次').getByTestId('window-state')).toHaveText('· 已错过')
  await expect(card(page, '喝水 · 第1/4次').getByTestId('window-badge')).toHaveAttribute('data-state', 'closed')
  await expect(card(page, '喝水 · 第1/4次').getByRole('button', { name: '完成' })).toHaveCount(0)
  await expect(card(page, '喝水 · 第2/4次').getByTestId('window-state')).toHaveText('· 当前可完成')
  // The generated plan text is not repeated on the node cards.
  await expect(page.getByTestId('task-card').filter({ hasText: '4 小时内每小时' })).toHaveCount(0)

  await card(page, '喝水 · 第2/4次').getByRole('button', { name: '完成' }).click()
  await expect.poll(async () => (await readData(userData)).completions.length).toBe(1)
  await page.getByRole('button', { name: '计划', exact: true }).click()
  const plan = page.getByTestId('plan-card')
  await expect(plan.getByTestId('plan-title')).toHaveText('喝水挑战')
  await expect(plan.getByTestId('plan-progress')).toHaveText('1/4 个时段已完成')
  await plan.getByTestId('plan-details-toggle').click()
  await expect(plan.getByTestId('plan-missed-slots')).toHaveText('已错过 1 个时段')
  await expect(plan.getByTestId('plan-goal')).toHaveAttribute('data-status', 'failed')
  await expect(plan.getByTestId('plan-master')).toHaveAttribute('data-unlocked', 'false')
  expect((await readData(userData)).plans[0]!.unlocks).toEqual([])
  await page.screenshot({ path: path.join(shots, 'p62-04-plan-missed-zh.png') })
  await app.close()
})

test('识别失败反馈: "每小时喝水" asks how long in plain words, never imports an endless task, and the name follows the fix', async () => {
  const userData = await fresh('zh-CN', 'lu-plan-ux-needs-')
  const { app, page } = await launch(userData)
  await page.getByRole('button', { name: '计划', exact: true }).click()
  await page.getByTestId('open-plan-wizard').click()
  await page.getByTestId('wizard-input').fill('每小时喝水')
  await page.getByTestId('wizard-parse').click()

  const needs = page.getByTestId('wizard-needs')
  await expect(needs).toBeVisible()
  // Phase 6.3: the summary names the field; the exact requirement is said once, right below that field.
  await expect(needs.getByTestId('wizard-need')).toHaveText([/^目标 1「喝水」：缺少「时段数」去修改$/])
  const goal = page.getByTestId('wizard-goal')
  await expect(goal.getByTestId('goal-problem')).toHaveCount(1)
  await expect(goal.getByTestId('goal-problem')).toHaveAttribute('data-field', 'slots')
  await expect(goal.getByTestId('goal-problem')).toContainText('请填写要做几个时段（每段 60 分钟）')
  await expect(goal.getByTestId('goal-slots')).toHaveAttribute('aria-invalid', 'true')
  await expect(goal.getByTestId('goal-slot-minutes')).not.toHaveAttribute('aria-invalid', 'true')
  await expect(goal.getByTestId('goal-slots')).toHaveValue('')
  await expect(page.getByTestId('wizard-plan-title')).toHaveValue('喝水计划')
  await expect(page.getByTestId('wizard-import')).toBeDisabled()
  await page.screenshot({ path: path.join(shots, 'p62-05-wizard-needs-zh.png') })

  // "去修改" goes to the field to fill in.
  await needs.getByRole('button', { name: '去修改' }).click()
  await expect(goal.getByTestId('goal-slots')).toBeFocused()
  await goal.getByTestId('goal-slots').fill('3')
  await expect(page.getByTestId('wizard-needs')).toHaveCount(0)
  await expect(page.getByTestId('wizard-plan-title')).toHaveValue('3小时喝水挑战')
  await expect(page.getByTestId('wizard-import')).toBeEnabled()
  await page.getByTestId('wizard-import').click()
  await expect(page.getByTestId('plan-card').getByTestId('plan-title')).toHaveText('3小时喝水挑战')
  const data = await readData(userData)
  expect(data.plans.map((p) => p.title)).toEqual(['3小时喝水挑战'])
  expect(data.tasks).toHaveLength(3)

  // The same text again: the name is not repeated as is.
  await page.getByTestId('open-plan-wizard').click()
  await page.getByTestId('wizard-input').fill('接下来3小时每小时喝水')
  await page.getByTestId('wizard-parse').click()
  await expect(page.getByTestId('wizard-plan-title')).toHaveValue('3小时喝水挑战 2')

  // Nothing recognized: a plain hint with an example, no plan.
  await page.getByRole('button', { name: '返回修改' }).click()
  await page.getByTestId('wizard-input').fill('今天')
  await page.getByTestId('wizard-parse').click()
  await expect(page.getByTestId('wizard-nothing')).toContainText('未来7天每天健身')
  await expect(page.getByTestId('wizard-import')).toBeDisabled()
  await app.close()
})

test('English: example chips, generated names and the missing-length message', async () => {
  const userData = await fresh('en', 'lu-plan-ux-en-')
  const { app, page } = await launch(userData)
  await page.getByRole('button', { name: 'Plans', exact: true }).click()
  await page.getByTestId('open-plan-wizard').click()
  const chips = page.getByTestId('wizard-example')
  await expect(chips).toHaveText(['4-hour water challenge', '7-day workout challenge', "This week's study plan"])
  await chips.nth(1).click()
  await expect(page.getByTestId('wizard-input')).toHaveValue('Work out every day for the next 7 days')
  await page.getByTestId('wizard-parse').click()
  await expect(page.getByTestId('wizard-plan-title')).toHaveValue('Work out: 7-day challenge')
  await expect(page.getByTestId('wizard-import')).toBeEnabled()
  await page.getByRole('button', { name: 'Back' }).click()

  await chips.nth(0).click()
  await page.getByTestId('wizard-parse').click()
  await expect(page.getByTestId('wizard-plan-title')).toHaveValue('Drink water: 4-hour challenge')
  await page.getByTestId('wizard-import').click()
  await expect(page.getByTestId('plan-card').getByTestId('plan-progress')).toHaveText('0/4 slots done')
  await page.getByTestId('plan-details-toggle').click()
  await expect(page.getByTestId('plan-current-slot')).toContainText('Current slot: 1')
  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  await expect(card(page, 'Drink water · 1 of 4').getByTestId('window-state')).toHaveText('· Open now')
  await expect(card(page, 'Drink water · 2 of 4').getByTestId('window-state')).toHaveText('· Not open yet')

  await page.getByRole('button', { name: 'Plans', exact: true }).click()
  await page.getByTestId('open-plan-wizard').click()
  await page.getByTestId('wizard-input').fill('drink water every hour')
  await page.getByTestId('wizard-parse').click()
  await expect(page.getByTestId('wizard-needs').getByTestId('wizard-need')).toHaveText([/^Goal 1 "Drink water": "Slots" missingFix$/])
  await expect(page.getByTestId('wizard-goal').getByTestId('goal-problem')).toHaveCount(1)
  await expect(page.getByTestId('wizard-goal').getByTestId('goal-problem')).toContainText('To avoid a task that never ends')
  await expect(page.getByTestId('wizard-plan-title')).toHaveValue('Drink water plan')
  await expect(page.getByTestId('wizard-import')).toBeDisabled()
  await app.close()
})
