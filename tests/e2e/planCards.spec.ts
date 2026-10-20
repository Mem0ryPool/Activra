import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launch, shots } from './helpers'

/**
 * Phase 6.5 plan cards: plan status, the big total, a next step picked by fixed rules, today vs total
 * for a daily goal, a Complete button only where a goal can be done now (the same completion as
 * everywhere else), achieved goals folded but openable, everything secondary under "Show details".
 */

interface Data {
  completions: { id: string; taskId: string; occurrence: string | null; undoneAt: string | null }[]
}
interface FocusData {
  state: { run: { id: string; taskId: string | null; resumedAt: string | null } | null }
  sessions: { id: string; taskId: string | null; focusedSec: number }[]
}
const readData = async (userData: string): Promise<Data> =>
  JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as Data
const readFocus = async (userData: string): Promise<FocusData> =>
  JSON.parse(await readFile(path.join(userData, 'life-unlocked-focus.json'), 'utf8')) as FocusData

const pad = (n: number): string => String(n).padStart(2, '0')
const keyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const day = (n: number): { key: string; iso: string } => {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12)
  return { key: keyOf(d), iso: d.toISOString() }
}
const today = day(0).key

/** "Exam week": the essay is achieved; "Learn 20 words" every day for 7 days has 2 days and today still to do. */
async function seed(userData: string, language: 'zh-CN' | 'en'): Promise<void> {
  const zh = language === 'zh-CN'
  const created = day(-2)
  const task = (id: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, title, description: '', createdAt: created.iso, updatedAt: created.iso, completedAt: null, status: 'active', timerConfig: null,
    themeOverride: null, recurrence: null, recurrenceHistory: [], skippedOccurrences: [], due: null, reminderMinutes: null, ...extra
  })
  const ach = (name: string, rarity = 'rare'): Record<string, unknown> => ({ name, description: `${name}!`, icon: 'target', rarity })
  const essay = zh ? '写完论文' : 'Write the essay'
  const words = zh ? '每天背 20 个单词' : 'Learn 20 words'
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 3,
      tasks: [
        task('essay', essay, { status: 'completed', completedAt: created.iso }),
        task('words', words, { recurrence: { preset: 'daily', unit: 'day', interval: 1, weekdays: [], startDate: day(-2).key, endDate: day(4).key } })
      ],
      completions: [
        { id: 'c-essay', taskId: 'essay', occurrence: null, completedAt: created.iso, undoneAt: null, title: essay },
        { id: 'c-1', taskId: 'words', occurrence: day(-2).key, completedAt: day(-2).iso, undoneAt: null, title: words },
        { id: 'c-2', taskId: 'words', occurrence: day(-1).key, completedAt: day(-1).iso, undoneAt: null, title: words }
      ],
      plans: [
        {
          id: 'plan-exam', title: zh ? '考试周计划' : 'Exam week', sourceText: zh ? '写完论文，并且接下来 7 天每天背 20 个单词' : 'Write the essay and learn 20 words a day for 7 days',
          createdAt: created.iso, updatedAt: created.iso,
          goals: [
            { id: 'g-essay', title: essay, category: 'writing', quantity: null, condition: { kind: 'once', due: null, onTime: false }, after: null, taskId: 'essay', startedOn: created.key, achievement: ach(zh ? '文字工匠' : 'Wordsmith') },
            { id: 'g-words', title: words, category: 'vocabulary', quantity: { amount: 20, unit: 'words' }, condition: { kind: 'count', startDate: day(-2).key, days: 7, every: 1, required: 7 }, after: null, taskId: 'words', startedOn: created.key, achievement: ach(zh ? '词汇收藏家' : 'Word Collector') }
          ],
          master: { name: zh ? '全成就！' : 'All Achievements!', description: zh ? '达成这个计划的全部 2 个目标' : 'Achieve all 2 goals of this plan', icon: 'crown', rarity: 'epic' },
          unlocks: [{ id: 'u-essay', target: 'g-essay', unlockedAt: created.iso, revokedAt: null }]
        }
      ],
      settings: { language, notificationDurationSec: 2 }
    })
  )
}

const shownTitles = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() =>
    (globalThis as unknown as { __lifeUnlockedTest: { notifications: () => { shown: { taskTitle: string }[] } } }).__lifeUnlockedTest
      .notifications()
      .shown.map((n) => n.taskTitle)
  )

test('计划卡片: status, today vs total, next step with Complete, folded achieved goal, details', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-plan-cards-zh-'))
  await seed(userData, 'zh-CN')
  const { app, page } = await launch(userData)
  await page.getByRole('button', { name: '计划', exact: true }).click()
  const plan = page.getByTestId('plan-card')

  await expect(plan.getByTestId('plan-title')).toHaveText('考试周计划')
  await expect(plan.getByTestId('plan-status')).toHaveText('进行中')
  await expect(plan.getByTestId('plan-progress')).toHaveText('1/2 个目标已达成')
  await expect(plan.getByTestId('plan-progress-bar').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')

  // The daily goal keeps "today" apart from its total.
  const words = plan.getByTestId('plan-goal').nth(1)
  await expect(words.getByTestId('plan-goal-today')).toHaveText('今天：待完成')
  await expect(words.getByTestId('plan-goal-count')).toHaveText('2/7')
  await expect(words).toContainText('累计 2/7 天')
  await expect(words.getByTestId('plan-goal-status')).toHaveText('进行中')

  // The next step is today's word day, with the only Complete button on the card.
  await expect(plan.getByTestId('plan-next')).toHaveAttribute('data-kind', 'now')
  await expect(plan.getByTestId('plan-next-text')).toHaveText('现在可以完成：每天背 20 个单词')
  await expect(plan.getByTestId('plan-complete')).toHaveCount(1)

  // The achieved essay goal is folded to one line and opens with the keyboard.
  const essay = plan.getByTestId('plan-goal').nth(0)
  await expect(essay).toHaveAttribute('data-folded', 'true')
  await expect(essay.getByTestId('plan-goal-status')).toHaveText('已达成')
  await expect(essay).not.toContainText('成就：文字工匠')
  const expand = essay.getByTestId('plan-goal-expand')
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expand.focus()
  await page.keyboard.press('Enter')
  await expect(expand).toHaveAttribute('aria-expanded', 'true')
  await expect(essay).toContainText('成就：文字工匠')

  // Secondary information stays available under 查看详情.
  const toggle = plan.getByTestId('plan-details-toggle')
  await expect(toggle).toHaveText('查看详情')
  await expect(plan.getByTestId('plan-details')).toHaveCount(0)
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(plan.getByTestId('plan-source')).toHaveText('写完论文，并且接下来 7 天每天背 20 个单词')
  await expect(plan.getByTestId('plan-details').getByTestId('rarity')).toHaveText(['稀有', '稀有', '史诗'])
  await expect(plan.getByTestId('plan-details')).toContainText('词汇收藏家!')
  await page.screenshot({ path: path.join(shots, 'p65-01-plan-card-todo-zh.png') })

  // Complete from the card: one record for today, the achievement shows, the card moves on.
  await plan.getByTestId('plan-complete').click()
  await expect.poll(async () => (await readData(userData)).completions.filter((c) => c.taskId === 'words' && c.occurrence === today).length).toBe(1)
  await expect.poll(() => shownTitles(app)).toContain('每天背 20 个单词')
  await expect(page.getByTestId('undo-toast')).toBeVisible()
  await expect(words.getByTestId('plan-goal-today')).toHaveText('今天：已完成')
  await expect(words.getByTestId('plan-goal-count')).toHaveText('3/7')
  await expect(plan.getByTestId('plan-next')).toHaveAttribute('data-kind', 'doneToday')
  await expect(plan.getByTestId('plan-next-text')).toHaveText('今天的目标都已完成，明天继续')
  // Nothing left to complete today: no button anywhere on the card.
  await expect(plan.getByTestId('plan-complete')).toHaveCount(0)
  await page.screenshot({ path: path.join(shots, 'p65-02-plan-card-done-zh.png') })

  // Undo from the toast puts it back the same way it does everywhere.
  await page.getByTestId('undo-toast').getByRole('button').first().click()
  await expect(words.getByTestId('plan-goal-today')).toHaveText('今天：待完成')
  await expect(plan.getByTestId('plan-complete')).toHaveCount(1)
  await app.close()
})

test('plan cards in English at the smallest window: same layout, no horizontal scroll, keyboard Complete', async () => {
  test.setTimeout(90_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-plan-cards-en-'))
  await seed(userData, 'en')
  const { app, page } = await launch(userData)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))?.setSize(900, 560))
  await page.getByRole('button', { name: 'Plans', exact: true }).click()
  const plan = page.getByTestId('plan-card')
  await expect(plan.getByTestId('plan-status')).toHaveText('In progress')
  await expect(plan.getByTestId('plan-progress')).toHaveText('1/2 goals achieved')
  await expect(plan.getByTestId('plan-next-text')).toHaveText('Ready now: Learn 20 words')
  await expect(plan.getByTestId('plan-goal').nth(1)).toContainText('Total 2/7 days')
  await expect(plan.getByTestId('plan-goal').nth(1).getByTestId('plan-goal-today')).toHaveText('Today: to do')
  await expect(plan.getByTestId('plan-details-toggle')).toHaveText('Show details')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect.poll(() => plan.evaluate((c) => c.scrollWidth <= c.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: path.join(shots, 'p65-03-plan-card-en-900.png') })

  const complete = plan.getByTestId('plan-complete')
  await expect(complete).toHaveAccessibleName('Complete "Learn 20 words"')
  await complete.focus()
  await page.keyboard.press('Enter')
  await expect(plan.getByTestId('plan-next-text')).toHaveText('Everything for today is done. Keep going tomorrow.')
  await expect.poll(async () => (await readData(userData)).completions.filter((c) => c.taskId === 'words' && c.occurrence === today).length).toBe(1)
  await app.close()
})

test('计划任务可直接开始并恢复专注，专注记录与任务完成进度分开', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-plan-focus-zh-'))
  await seed(userData, 'zh-CN')
  const prior = (id: string, taskId: string, title: string, focusedSec: number): Record<string, unknown> => ({
    id,
    taskId,
    taskTitle: title,
    plannedSec: 1500,
    focusedSec,
    startedAt: day(-1).iso,
    endedAt: day(-1).iso,
    outcome: 'ended-early'
  })
  await writeFile(
    path.join(userData, 'life-unlocked-focus.json'),
    JSON.stringify({
      version: 1,
      durations: { focusMin: 25, shortBreakMin: 5, longBreakMin: 15 },
      state: { run: null, nextPhase: 'focus', taskId: null, cycle: 0 },
      sessions: [prior('focus-essay', 'essay', '写完论文', 60), prior('focus-words', 'words', '每天背 20 个单词', 120), prior('focus-other', 'other', '其他任务', 600)]
    }),
    'utf8'
  )
  const dataBefore = await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')
  const { app, page } = await launch(userData)
  await page.getByRole('button', { name: '计划', exact: true }).click()
  const plan = page.getByTestId('plan-card')

  // Existing linked records are visible on the plan, but do not change its completion total.
  await expect(plan.getByTestId('plan-focus-summary')).toHaveText('已专注 3 分钟 · 2 次')
  await expect(plan.getByTestId('plan-progress')).toHaveText('1/2 个目标已达成')
  const start = plan.getByTestId('plan-focus')
  await expect(start).toHaveText('开始专注')
  await expect(start).toHaveAccessibleName('为「每天背 20 个单词」开始专注')

  // One click starts a persisted run linked to the actionable plan task and opens focus mode.
  await start.click()
  await expect(page.getByTestId('focus-mode')).toBeVisible()
  await expect(page.getByTestId('focus-mode-task')).toHaveText('每天背 20 个单词')
  await expect.poll(async () => (await readFocus(userData)).state.run?.taskId).toBe('words')
  const runId = (await readFocus(userData)).state.run?.id
  expect(runId).toBeTruthy()
  expect(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')).toBe(dataBefore)

  // Pause, leave, then resume from the same plan button; the persisted run is reused.
  await page.getByTestId('focus-mode').getByTestId('focus-pause').click()
  await expect.poll(async () => (await readFocus(userData)).state.run?.resumedAt).toBeNull()
  await page.getByTestId('focus-exit-mode').click()
  await page.getByRole('button', { name: '计划', exact: true }).click()
  const resume = page.getByTestId('plan-card').getByTestId('plan-focus')
  await expect(resume).toHaveText('继续专注')
  await resume.click()
  await expect(page.getByTestId('focus-mode')).toBeVisible()
  await expect(page.getByTestId('focus-mode').getByTestId('focus-pause')).toBeVisible()
  await expect.poll(async () => (await readFocus(userData)).state.run?.id).toBe(runId)
  await expect.poll(async () => (await readFocus(userData)).state.run?.resumedAt).not.toBeNull()

  // Ending this short run records nothing and still cannot complete or reward the task.
  await page.getByTestId('focus-mode').getByTestId('focus-end').click()
  await expect.poll(async () => (await readFocus(userData)).state.run).toBeNull()
  expect((await readFocus(userData)).sessions).toHaveLength(3)
  expect(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')).toBe(dataBefore)
  await app.close()
})
