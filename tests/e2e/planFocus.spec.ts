import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launch } from './helpers'

const DATA = 'life-unlocked-data.json'
const FOCUS = 'life-unlocked-focus.json'

test('plan focus: review, one-click execution, pause/restart, independent progress and duplicate prevention', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'activra-plan-focus-ui-'))
  await writeFile(path.join(directory, DATA), JSON.stringify({ schemaVersion: 5, tasks: [], completions: [], plans: [], habits: [], habitCheckins: [], settings: { language: 'zh-CN', appearance: 'light', closeAction: 'quit' } }))
  let { app, page } = await launch(directory)
  try {
    const plan = await page.evaluate(async () => {
      const achievement = { name: '测试达成', description: '仅测试数据', icon: 'target' as const, rarity: 'common' as const }
      return window.lifeUnlocked.plans.create({ title: '隔离专注计划', sourceText: '完成作业，然后阅读', master: null, goals: [
        { key: 'first', title: '完成测试作业', category: 'homework', quantity: null, condition: { kind: 'once', due: null, onTime: false }, afterKey: null, achievement },
        { key: 'second', title: '阅读测试资料', category: 'reading', quantity: null, condition: { kind: 'once', due: null, onTime: false }, afterKey: 'first', achievement }
      ] })
    })
    await page.getByRole('button', { name: '计划', exact: true }).click()
    const card = page.locator(`[data-plan="${plan.id}"]`)
    await card.getByTestId('plan-focus-configure').click()
    const review = page.getByRole('dialog')
    await expect(review.getByTestId('plan-focus-estimate')).toContainText('50 分钟')
    await review.getByTestId(`plan-focus-budget-${plan.goals[0]!.id}`).click()
    await page.getByRole('option', { name: '2 次专注', exact: true }).click()
    await expect(review.getByTestId('plan-focus-estimate')).toContainText('75 分钟')
    await page.screenshot({ path: path.join(directory, 'plan-focus-review.png') })
    await review.getByTestId('plan-focus-confirm').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(card.getByTestId('plan-focus')).toHaveCount(1) // Waiting step cannot launch.
    await card.getByTestId('plan-focus').click()
    await expect(page.getByTestId('focus-mode')).toBeVisible()
    await expect(page.getByTestId('focus-mode-task')).toContainText('完成测试作业')
    await page.getByTestId('focus-mode').getByTestId('focus-pause').click()
    await expect(page.getByTestId('focus-countdown')).toHaveAttribute('data-state', 'paused')
    const stored = JSON.parse(await readFile(path.join(directory, FOCUS), 'utf8'))
    expect(stored.state.run.origin).toEqual({ planId: plan.id, goalId: plan.goals[0]!.id })
    const runId = stored.state.run.id
    await app.close()
    ;({ app, page } = await launch(directory))
    await page.getByRole('button', { name: '计划', exact: true }).click()
    await expect(page.locator(`[data-focus-goal="${plan.goals[0]!.id}"]`)).toHaveAttribute('data-focus-state', 'paused')
    await page.getByTestId('plan-focus').click()
    await expect(page.getByTestId('focus-countdown')).toHaveAttribute('data-state', 'running')
    expect((await page.evaluate(() => window.lifeUnlocked.focus.get())).state.run!.id).toBe(runId)
    await page.evaluate(async input => { await Promise.all([window.lifeUnlocked.focus.startPlan(input), window.lifeUnlocked.focus.startPlan(input)]) }, { planId: plan.id, goalId: plan.goals[0]!.id, taskId: plan.goals[0]!.taskId! })
    expect((await page.evaluate(() => window.lifeUnlocked.focus.get())).sessions).toHaveLength(0)
    // Seed only our closed test profile to simulate time-up; never alter a live or real user file.
    await page.getByTestId('focus-mode').getByTestId('focus-pause').click()
    await app.close()
    const completed = JSON.parse(await readFile(path.join(directory, FOCUS), 'utf8'))
    completed.state.run.elapsedMs = completed.state.run.plannedSec * 1000 - 1000
    completed.state.run.resumedAt = new Date(Date.now() - 3000).toISOString()
    await writeFile(path.join(directory, FOCUS), JSON.stringify(completed))
    ;({ app, page } = await launch(directory))
    await expect.poll(async () => (await page.evaluate(() => window.lifeUnlocked.focus.get())).sessions.length).toBe(1)
    await page.getByRole('button', { name: '计划', exact: true }).click()
    await expect(page.getByTestId('plan-focus-progress').first()).toHaveAttribute('data-completed', '1')
    await expect(page.getByTestId('plan-focus-progress').first()).toHaveAttribute('data-remaining', '1')
    await expect(page.getByTestId('plan-focus-progress').first()).toHaveAttribute('data-seconds', '1500')
    const data = await page.evaluate(() => window.lifeUnlocked.tasks.snapshot())
    expect(data.completions).toHaveLength(0)
    expect(data.plans[0]!.unlocks).toHaveLength(0)
    expect(data.tasks).toHaveLength(1)
    await page.screenshot({ path: path.join(directory, 'plan-focus-progress.png') })
    await page.getByTestId('plan-focus').click()
    await expect(page.getByTestId('focus-phase-short-break')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('focus-countdown')).toHaveAttribute('data-state', 'idle')
    await page.screenshot({ path: path.join(directory, 'plan-focus-acceptance.png') })
    console.log(`Isolated plan-focus QA profile: ${directory}`)
  } finally { await app.close() }
})

test('plan focus Chinese budget and controls fit the minimum window in light/dark/system', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'activra-plan-focus-layout-'))
  await writeFile(path.join(directory, DATA), JSON.stringify({ schemaVersion: 5, tasks: [], completions: [], plans: [], habits: [], habitCheckins: [], settings: { language: 'zh-CN', appearance: 'system', closeAction: 'quit' } }))
  const { app, page } = await launch(directory, {}, ['--force-device-scale-factor=1.5'])
  try {
    await page.evaluate(() => window.lifeUnlocked.plans.create({ title: '最小窗口专注测试', sourceText: '', master: null, goals: [{ key: 'one', title: '完成一项需要持续专注并检查结果的测试任务', category: 'work', quantity: null, condition: { kind: 'once', due: null, onTime: false }, afterKey: null, achievement: { name: '测试', description: '测试', icon: 'target', rarity: 'common' } }] }))
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))?.setSize(900, 560) })
    await page.getByRole('button', { name: '计划', exact: true }).click()
    for (const appearance of ['light', 'dark', 'system'] as const) {
      await page.evaluate(value => window.lifeUnlocked.settings.update({ appearance: value }), appearance)
      if (appearance === 'system') await page.emulateMedia({ colorScheme: 'dark' })
      await page.getByTestId('plan-focus-configure').click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByText('确认专注安排', { exact: true })).toBeVisible()
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await dialog.getByTestId('plan-focus-confirm').scrollIntoViewIfNeeded()
      await expect(dialog.getByTestId('plan-focus-confirm')).toBeInViewport()
      await page.screenshot({ path: path.join(directory, `review-${appearance}.png`) })
      await dialog.getByTestId('plan-focus-confirm').click()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.getByTestId('plan-focus').scrollIntoViewIfNeeded()
      await expect(page.getByTestId('plan-focus')).toBeInViewport()
    }
    console.log(`Isolated minimum-window QA: ${directory}`)
  } finally { await app.close() }
})
