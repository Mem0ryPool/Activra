import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launch, notificationPage, shots } from './helpers'

const pad = (n: number): string => String(n).padStart(2, '0')
const keyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Local date key `n` days from today, and an ISO time at noon on it. */
const day = (n: number): { key: string; iso: string } => {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12)
  return { key: keyOf(d), iso: d.toISOString() }
}

interface Data {
  schemaVersion: number
  tasks: { id: string; title: string }[]
  completions: { id: string; taskId: string; undoneAt: string | null }[]
  plans: { goals: { taskId: string | null }[]; unlocks: { target: string; revokedAt: string | null }[] }[]
}
const readData = async (userData: string): Promise<Data> =>
  JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as Data

const card = (page: Page, title: string) => page.getByTestId('task-card').filter({ hasText: title })

/** Presses every "Confirm" on the preview's guesses until none is left. */
async function confirmAll(page: Page): Promise<void> {
  const buttons = page.getByTestId('issue-confirm')
  while ((await buttons.count()) > 0) await buttons.first().click()
}

test('智能生成计划: Chinese text → preview → confirm → import, then a chain step starts after its goal', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-plan-zh-'))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 2, tasks: [], completions: [], settings: { language: 'zh-CN', notificationDurationSec: 3 } })
  )
  const { app, page } = await launch(userData)

  // Entry from the Tasks page.
  await page.getByTestId('tasks-smart-plan').click()
  await expect(page.getByRole('dialog', { name: '智能生成计划' })).toBeVisible()
  await expect(page.getByText('在本机解析，无需联网、注册或 API Key。')).toBeVisible()
  await page.getByTestId('wizard-input').fill('未来30天，每天背20个英语单词，每周健身3次，周五之前完成数学作业，然后学习Python基础。')
  await page.getByTestId('wizard-parse').click()

  const goals = page.getByTestId('wizard-goal')
  await expect(goals).toHaveCount(4)
  await expect(goals.nth(0).getByTestId('goal-title')).toHaveValue('背20个英语单词')
  await expect(goals.nth(0).getByTestId('goal-days')).toHaveValue('30')
  await expect(goals.nth(0).getByTestId('goal-required')).toHaveValue('30')
  await expect(goals.nth(1).getByTestId('goal-title')).toHaveValue('健身')
  await expect(goals.nth(1).getByTestId('goal-per-week')).toHaveValue('3')
  await expect(goals.nth(1).getByTestId('goal-weeks')).toHaveValue('4')
  // 30 days is not whole weeks: the guess is shown and must be confirmed before importing.
  await expect(goals.nth(1).locator('[data-testid=goal-issue][data-code=weeks-rounded]')).toBeVisible()
  await expect(goals.nth(3).getByTestId('goal-after')).toBeChecked()
  await expect(page.getByTestId('wizard-master')).toContainText('全成就！')
  await expect(page.getByTestId('wizard-import')).toBeDisabled()
  await page.screenshot({ path: path.join(shots, 'p6-01-wizard-preview-zh-dark.png') })

  await confirmAll(page)
  await expect(page.getByTestId('wizard-import')).toBeEnabled()
  await page.getByTestId('wizard-import').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The Plans page: three goals running, the chain step waiting, "全成就！" locked.
  const plan = page.getByTestId('plan-card')
  await expect(plan).toHaveCount(1)
  await expect(plan.getByTestId('plan-goal')).toHaveCount(4)
  await expect(plan.getByTestId('plan-goal').nth(3)).toHaveAttribute('data-status', 'waiting')
  await expect(plan.getByTestId('plan-master')).toHaveAttribute('data-unlocked', 'false')
  await expect(plan.getByTestId('plan-progress')).toHaveText('0/4 个目标已达成')
  await expect(plan.getByTestId('plan-progress-bar').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  await page.screenshot({ path: path.join(shots, 'p6-02-plans-zh-dark.png') })

  let data = await readData(userData)
  expect(data.schemaVersion).toBe(5)
  expect(data.tasks.map((t) => t.title)).toEqual(['背20个英语单词', '健身', '完成数学作业'])

  // One day of the 30-day goal is not the goal.
  await page.getByRole('button', { name: '任务', exact: true }).click()
  await card(page, '背20个英语单词').getByRole('button', { name: '完成' }).click()
  await page.getByRole('button', { name: '计划', exact: true }).click()
  await expect(plan.getByTestId('plan-goal').nth(0)).toHaveAttribute('data-status', 'active')
  await expect(plan.getByTestId('plan-goal').nth(0).getByTestId('plan-goal-count')).toHaveText('1/30')

  // Completing the homework achieves its goal: the plan notification shows, and the Python step starts.
  await page.getByRole('button', { name: '任务', exact: true }).click()
  await card(page, '完成数学作业').getByRole('button', { name: '完成' }).click()
  const toast = await notificationPage(app)
  await expect(toast.locator('[data-testid=achievement-toast][data-variant=goal]')).toBeVisible({ timeout: 15_000 })
  await expect(toast.getByTestId('achievement-card')).toContainText('计划成就已解锁！')
  await expect(card(page, '学习Python基础')).toBeVisible()
  await page.getByRole('button', { name: '计划', exact: true }).click()
  await expect(plan.getByTestId('plan-goal').nth(2)).toHaveAttribute('data-status', 'achieved')
  await expect(plan.getByTestId('plan-goal').nth(3)).toHaveAttribute('data-status', 'active')
  await expect(plan.getByTestId('plan-progress')).toHaveText('1/4 个目标已达成')
  await expect(plan.getByTestId('plan-progress-bar').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')

  data = await readData(userData)
  expect(data.plans[0]?.goals[3]?.taskId).toBe(data.tasks.find((t) => t.title === '学习Python基础')?.id)

  // Light appearance.
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.evaluate(() => window.lifeUnlocked.settings.update({ appearance: 'light' }))
  await page.getByRole('button', { name: '计划', exact: true }).click()
  await page.screenshot({ path: path.join(shots, 'p6-03-plans-zh-light.png') })
  await page.getByTestId('open-plan-wizard').click()
  await page.getByTestId('wizard-input').fill('每天喝水')
  await page.getByTestId('wizard-parse').click()
  await page.screenshot({ path: path.join(shots, 'p6-04-wizard-missing-light.png') })
  await app.close()
})

test('The wizard never imports a guess: missing lengths must be filled in', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-plan-missing-'))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({ schemaVersion: 3, tasks: [], completions: [], plans: [], settings: { language: 'en' } })
  )
  const { app, page } = await launch(userData)
  await page.getByRole('button', { name: 'Plans', exact: true }).click()
  await page.getByTestId('open-plan-wizard').click()
  await page.getByTestId('wizard-input').fill('Drink water every day')
  await page.getByTestId('wizard-parse').click()
  const goal = page.getByTestId('wizard-goal')
  await expect(goal.getByTestId('goal-days')).toHaveValue('')
  await expect(goal.getByTestId('goal-problem').first()).toHaveText('The text does not say for how many days. Enter the length, e.g. 30.')
  await expect(page.getByTestId('wizard-import')).toBeDisabled()
  await goal.getByTestId('goal-days').fill('14')
  await expect(goal.getByTestId('goal-required')).toHaveValue('')
  await goal.getByTestId('goal-required').fill('14')
  await expect(page.getByTestId('wizard-import')).toBeEnabled()
  await page.getByTestId('wizard-import').click()
  await expect(page.getByTestId('plan-card')).toHaveCount(1)
  await expect(page.getByTestId('plan-master')).toHaveCount(0)
  const data = await readData(userData)
  expect(data.tasks).toHaveLength(1)
  await app.close()
})

test('全成就 unlocks from local records only, is withdrawn by undo, and survives a restart', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-plan-master-'))
  const created = day(-2)
  const task = (id: string, title: string, extra: Record<string, unknown>): Record<string, unknown> => ({
    id,
    title,
    description: '',
    createdAt: created.iso,
    updatedAt: created.iso,
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
  })
  const achievement = (name: string): Record<string, unknown> => ({ name, description: name, icon: 'target', rarity: 'rare' })
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 3,
      tasks: [
        task('essay', 'Write the essay', { status: 'completed', completedAt: created.iso }),
        task('words', 'Learn 20 words', {
          recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: day(-2).key, endDate: day(0).key }
        })
      ],
      completions: [
        { id: 'c-essay', taskId: 'essay', occurrence: null, completedAt: created.iso, undoneAt: null, title: 'Write the essay' },
        { id: 'c-1', taskId: 'words', occurrence: day(-2).key, completedAt: day(-2).iso, undoneAt: null, title: 'Learn 20 words' },
        { id: 'c-2', taskId: 'words', occurrence: day(-1).key, completedAt: day(-1).iso, undoneAt: null, title: 'Learn 20 words' }
      ],
      plans: [
        {
          id: 'plan-1',
          title: 'Exam week',
          sourceText: 'Write the essay and learn 20 words every day for 3 days',
          createdAt: created.iso,
          updatedAt: created.iso,
          goals: [
            {
              id: 'g-essay', title: 'Write the essay', category: 'writing', quantity: null,
              condition: { kind: 'once', due: null, onTime: false }, after: null, taskId: 'essay', startedOn: created.key,
              achievement: achievement('Wordsmith')
            },
            {
              id: 'g-words', title: 'Learn 20 words', category: 'vocabulary', quantity: { amount: 20, unit: 'words' },
              condition: { kind: 'count', startDate: day(-2).key, days: 3, every: 1, required: 3 }, after: null, taskId: 'words',
              startedOn: created.key, achievement: achievement('Word Collector')
            }
          ],
          master: { name: 'All Achievements!', description: 'Achieve all 2 goals of this plan', icon: 'crown', rarity: 'epic' },
          unlocks: [{ id: 'u-essay', target: 'g-essay', unlockedAt: created.iso, revokedAt: null }]
        }
      ],
      settings: { language: 'en', notificationDurationSec: 3 }
    })
  )
  let { app, page } = await launch(userData)
  await page.getByRole('button', { name: 'Plans', exact: true }).click()
  const plan = page.getByTestId('plan-card')
  await expect(plan.getByTestId('plan-goal').nth(1).getByTestId('plan-goal-count')).toHaveText('2/3')
  await expect(plan.getByTestId('plan-master')).toHaveAttribute('data-unlocked', 'false')

  // The last day: task achievement, then the goal, then "All Achievements!" with its own frame.
  await page.getByRole('button', { name: 'Tasks' }).click()
  await card(page, 'Learn 20 words').getByRole('button', { name: 'Complete' }).click()
  const toast = await notificationPage(app)
  await expect(toast.locator('[data-testid=achievement-toast][data-variant=plan]')).toBeVisible({ timeout: 20_000 })
  await expect(toast.getByTestId('achievement-card')).toContainText('All Achievements!')
  await expect(toast.getByTestId('achievement-card')).toContainText('Exam week')
  await expect(toast.getByTestId('achievement-master-badge')).toBeVisible()
  await toast.screenshot({ path: path.join(shots, 'p6-05-master-toast.png') })

  await page.getByRole('button', { name: 'Plans', exact: true }).click()
  await expect(plan.getByTestId('plan-master')).toHaveAttribute('data-unlocked', 'true')
  await page.getByRole('button', { name: 'Achievements' }).click()
  await expect(page.locator('[data-testid=plan-achievement][data-master=true]')).toContainText('All Achievements!')
  await expect(page.getByTestId('plan-achievement')).toHaveCount(3)
  await page.screenshot({ path: path.join(shots, 'p6-06-achievements-en-dark.png') })

  // Undo today's completion (from the task's menu): the goal and "All Achievements!" are withdrawn.
  await page.getByRole('button', { name: 'Tasks' }).click()
  await card(page, 'Learn 20 words').getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Restore to not completed' }).click()
  await page.getByRole('button', { name: 'Plans', exact: true }).click()
  await expect(plan.getByTestId('plan-master')).toHaveAttribute('data-unlocked', 'false')
  await expect(plan.getByTestId('plan-goal').nth(1)).toHaveAttribute('data-status', 'active')
  let data = await readData(userData)
  expect(data.plans[0]?.unlocks.filter((u) => u.revokedAt === null).map((u) => u.target)).toEqual(['g-essay'])
  expect(data.plans[0]?.unlocks.filter((u) => u.revokedAt !== null).map((u) => u.target).sort()).toEqual(['g-words', 'plan'])

  // Restart: same state, nothing re-announced.
  await app.close()
  ;({ app, page } = await launch(userData))
  await page.getByRole('button', { name: 'Plans', exact: true }).click()
  await expect(page.getByTestId('plan-master')).toHaveAttribute('data-unlocked', 'false')
  await expect(page.getByTestId('plan-goal').nth(0)).toHaveAttribute('data-status', 'achieved')
  await page.getByRole('button', { name: 'Tasks' }).click()
  await card(page, 'Learn 20 words').getByRole('button', { name: 'Complete' }).click()
  await page.getByRole('button', { name: 'Plans', exact: true }).click()
  await expect(page.getByTestId('plan-master')).toHaveAttribute('data-unlocked', 'true')
  data = await readData(userData)
  expect(data.plans[0]?.unlocks.filter((u) => u.revokedAt === null).map((u) => u.target).sort()).toEqual(['g-essay', 'g-words', 'plan'])
  expect(data.completions.filter((e) => e.taskId === 'words' && e.undoneAt === null)).toHaveLength(3)
  await app.close()
})
