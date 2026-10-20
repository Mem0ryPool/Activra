import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, shots } from './helpers'

/**
 * Phase 6.7 focus timer: start / pause / resume / end / reset, the sidebar time, focus mode, durations,
 * a linked task that is never completed, one record per run (also across restarts), the quiet card when
 * a run ends, and the main data file left alone. Seeds use an isolated profile and set the language.
 */

interface FocusFile {
  version: number
  durations: { focusMin: number; shortBreakMin: number; longBreakMin: number }
  state: { run: { id: string; resumedAt: string | null; elapsedMs: number; plannedSec: number } | null; nextPhase: string; taskId: string | null }
  sessions: { id: string; taskId: string | null; taskTitle: string; focusedSec: number; outcome: string }[]
}

const DATA = 'life-unlocked-data.json'
const FOCUS = 'life-unlocked-focus.json'
const readFocus = async (userData: string): Promise<FocusFile> =>
  JSON.parse(await readFile(path.join(userData, FOCUS), 'utf8')) as FocusFile
const readText = (userData: string, name: string): Promise<string> => readFile(path.join(userData, name), 'utf8')

const task = {
  id: 'task-report',
  title: 'Write report',
  description: '',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  completedAt: null,
  status: 'active',
  timerConfig: null,
  themeOverride: null,
  recurrence: null,
  recurrenceHistory: [],
  skippedOccurrences: [],
  due: null,
  reminderMinutes: null,
  window: null
}

const longTask = { ...task, id: 'task-long', title: 'Prepare the quarterly planning review with every team lead and collect their notes' }

async function seed(userData: string, focus?: Record<string, unknown>): Promise<void> {
  await writeFile(
    path.join(userData, DATA),
    JSON.stringify({ schemaVersion: 5, tasks: [task, longTask], completions: [], plans: [], habits: [], habitCheckins: [], settings: { language: 'en' } }),
    'utf8'
  )
  if (focus) await writeFile(path.join(userData, FOCUS), JSON.stringify(focus), 'utf8')
}

/** A focus file whose focus run has `elapsedSec` counted and is still running (or paused). */
function runningFocus(plannedSec: number, elapsedSec: number, taskId: string | null, paused = false): Record<string, unknown> {
  const now = Date.now()
  return {
    version: 1,
    durations: { focusMin: 25, shortBreakMin: 5, longBreakMin: 15 },
    state: {
      run: {
        id: 'seeded-run',
        phase: 'focus',
        taskId,
        taskTitle: taskId ? 'Write report' : '',
        plannedSec,
        startedAt: new Date(now - elapsedSec * 1000).toISOString(),
        resumedAt: paused ? null : new Date(now - elapsedSec * 1000).toISOString(),
        elapsedMs: paused ? elapsedSec * 1000 : 0
      },
      nextPhase: 'focus',
      taskId,
      cycle: 0
    },
    sessions: []
  }
}

async function openFocus(page: Page): Promise<void> {
  await page.locator('nav button', { hasText: /Focus|专注/ }).click()
  await expect(page.getByTestId('focus-page')).toBeVisible()
}

const remaining = async (page: Page, testId = 'focus-countdown'): Promise<number> =>
  Number(await page.getByTestId(testId).getAttribute('data-remaining-sec'))

interface Shown {
  id: string
  kind: string
  heading: string
  taskTitle: string
  variant: string | null
}
const shown = (app: ElectronApplication): Promise<Shown[]> =>
  app.evaluate(
    () => (globalThis as unknown as { __lifeUnlockedTest: { notifications: () => { shown: Shown[] } } }).__lifeUnlockedTest.notifications().shown
  )
const finishedRuns = (app: ElectronApplication): Promise<{ runId: string; carded: boolean }[]> =>
  app.evaluate(
    () => (globalThis as unknown as { __lifeUnlockedTest: { focusFinished: { runId: string; carded: boolean }[] } }).__lifeUnlockedTest.focusFinished
  )

test('start, pause, resume, end and reset; focus mode; the data file is left alone', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-focus-'))
  await seed(userData)
  const { app, page } = await launch(userData)
  const dataBefore = await readText(userData, DATA)
  await openFocus(page)
  await expect(page.getByTestId('focus-countdown')).toHaveText('25:00')
  await expect(page.getByTestId('focus-nav-time')).toHaveCount(0)

  // Linked task: chosen, started; the task itself is untouched.
  // The task picker: a custom list, "No task" first, chosen by mouse and by keyboard.
  const picker = page.getByTestId('focus-task-picker')
  await expect(picker).toHaveAttribute('role', 'combobox')
  await expect(picker).toHaveAttribute('data-value', '')
  await picker.click()
  await expect(picker).toHaveAttribute('aria-expanded', 'true')
  const list = page.getByTestId('select-list')
  await expect(list.getByRole('option')).toHaveCount(3)
  await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await list.getByRole('option', { name: 'Write report' }).click()
  await expect(list).toHaveCount(0)
  await expect(picker).toHaveAttribute('data-value', 'task-report')
  await expect.poll(async () => (await readFocus(userData)).state.taskId).toBe('task-report')
  await expect(picker).toBeFocused()
  // Keyboard: open on the chosen one, move, Esc closes without a change, Enter chooses.
  await page.keyboard.press('ArrowDown')
  await expect(list.locator('[data-active]')).toHaveAttribute('data-value', 'task-report')
  await page.keyboard.press('Home')
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(picker).toHaveAttribute('data-value', 'task-report')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await expect(picker).toHaveAttribute('data-value', '')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(picker).toHaveAttribute('data-value', 'task-report')
  // A click outside closes the list.
  await picker.click()
  await page.getByTestId('focus-countdown').click()
  await expect(list).toHaveCount(0)
  await page.getByTestId('focus-start').click()
  await expect(page.getByTestId('focus-countdown')).toHaveAttribute('data-state', 'running')
  await expect(page.getByTestId('focus-run-task')).toHaveText(/Write report/)
  await expect(page.getByTestId('focus-run-task')).toHaveAttribute('data-linked', 'true')
  await expect(page.getByTestId('focus-task-picker')).toHaveCount(0)
  await expect.poll(() => remaining(page), { timeout: 5000 }).toBeLessThan(1500)
  const focus = await readFocus(userData)
  expect(focus.state.run?.plannedSec).toBe(1500)
  expect(focus.sessions).toEqual([])

  // Paused: the time stands still (also in the sidebar).
  await page.getByTestId('focus-pause').click()
  await expect(page.getByTestId('focus-countdown')).toHaveAttribute('data-state', 'paused')
  const pausedAt = await remaining(page)
  await page.waitForTimeout(1500)
  expect(await remaining(page)).toBe(pausedAt)
  await expect(page.getByTestId('focus-nav-time')).toHaveAttribute('data-state', 'paused')
  await page.getByTestId('focus-resume').click()
  await expect(page.getByTestId('focus-countdown')).toHaveAttribute('data-state', 'running')

  // Another page: the sidebar keeps the time.
  await page.locator('nav button', { hasText: 'Tasks' }).click()
  await expect(page.getByTestId('focus-nav-time')).toHaveAttribute('data-state', 'running')
  await openFocus(page)

  // Focus mode: big countdown and controls; leaving it (button, Esc) never stops the timer.
  await page.getByTestId('focus-enter-mode').click()
  await expect(page.getByTestId('focus-mode')).toBeVisible()
  await expect(page.getByTestId('focus-mode-task')).toHaveText('Write report')
  await page.getByTestId('focus-exit-mode').click()
  await expect(page.getByTestId('focus-mode')).toHaveCount(0)
  await expect(page.getByTestId('focus-countdown')).toHaveAttribute('data-state', 'running')
  await page.getByTestId('focus-enter-mode').click()
  await page.getByTestId('focus-mode').getByTestId('focus-pause').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('focus-mode')).toHaveCount(0)
  await expect(page.getByTestId('focus-countdown')).toHaveAttribute('data-state', 'paused')

  // Ended within the first minute: no record, back to idle.
  await page.getByTestId('focus-end').click()
  await expect(page.getByTestId('focus-countdown')).toHaveAttribute('data-state', 'idle')
  await expect(page.getByTestId('focus-record')).toHaveCount(0)
  expect((await readFocus(userData)).sessions).toEqual([])

  // Reset: no record either.
  await page.getByTestId('focus-start').click()
  await page.getByTestId('focus-reset').click()
  await expect(page.getByTestId('focus-countdown')).toHaveText('25:00')
  expect((await readFocus(userData)).sessions).toEqual([])

  // Durations: invalid input is refused; a valid one applies to the next start.
  await page.getByTestId('focus-durations').click()
  await page.getByTestId('focus-duration-focusMin').fill('0')
  await page.getByTestId('focus-durations-save').click()
  await expect(page.getByTestId('focus-durations-error')).toBeVisible()
  await page.getByTestId('focus-duration-focusMin').fill('50')
  await page.getByTestId('focus-durations-save').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('focus-countdown')).toHaveText('50:00')
  await page.getByTestId('focus-phase-short-break').click()
  await expect(page.getByTestId('focus-countdown')).toHaveText('5:00')
  await expect(page.getByTestId('focus-task-picker')).toHaveCount(0)

  // Tasks, completions and settings were never written by the timer.
  expect(await readText(userData, DATA)).toBe(dataBefore)
  await app.close()
})

test('a run that ends records once, shows the quiet card and never completes the task', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-focus-done-'))
  // 59 of 60 seconds done: it ends a moment after launch.
  await seed(userData, runningFocus(60, 59, 'task-report'))
  const { app, page } = await launch(userData)
  await expect.poll(async () => (await readFocus(userData)).sessions.length, { timeout: 10_000 }).toBe(1)
  const focus = await readFocus(userData)
  expect(focus.sessions[0]).toMatchObject({ id: 'seeded-run', taskId: 'task-report', taskTitle: 'Write report', focusedSec: 60, outcome: 'completed' })
  expect(focus.state).toMatchObject({ run: null, nextPhase: 'short-break', taskId: 'task-report' })
  await expect.poll(async () => (await shown(app)).filter((s) => s.variant === 'focus')).toHaveLength(1)
  const card = (await shown(app)).find((s) => s.variant === 'focus') as Shown
  expect(card).toMatchObject({ heading: 'Focus complete', taskTitle: 'Write report · 1 min' })

  // The task stays in progress, with no completion record.
  const data = JSON.parse(await readText(userData, DATA)) as { tasks: { status: string }[]; completions: unknown[] }
  expect(data.tasks[0]?.status).toBe('active')
  expect(data.completions).toEqual([])

  await openFocus(page)
  await expect(page.getByTestId('focus-record')).toHaveCount(1)
  await expect(page.getByTestId('focus-record')).toHaveAttribute('data-outcome', 'completed')
  await expect(page.getByTestId('focus-today-completed')).toHaveAttribute('data-value', '1')
  await expect(page.getByTestId('focus-phase-short-break')).toHaveAttribute('aria-checked', 'true')
  // Extra ticks change nothing.
  await app.evaluate(() => (globalThis as unknown as { __lifeUnlockedTest: { runFocusCheck: () => Promise<void> } }).__lifeUnlockedTest.runFocusCheck())
  await app.close()

  // Restart: still one record, no second card.
  const again = await launch(userData)
  await again.app.evaluate(() => (globalThis as unknown as { __lifeUnlockedTest: { runFocusCheck: () => Promise<void> } }).__lifeUnlockedTest.runFocusCheck())
  expect((await readFocus(userData)).sessions).toHaveLength(1)
  expect((await shown(again.app)).filter((s) => s.variant === 'focus')).toHaveLength(0)
  await again.app.close()
})

test('restart: a running timer keeps counting, a paused one stays paused; a long-finished run is recorded quietly', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-focus-restart-'))
  await seed(userData, runningFocus(1500, 120, null))
  let { app, page } = await launch(userData)
  await openFocus(page)
  await expect(page.getByTestId('focus-countdown')).toHaveAttribute('data-state', 'running')
  const first = await remaining(page)
  expect(first).toBeLessThanOrEqual(1380)
  expect(first).toBeGreaterThan(1360)
  await app.close()
  await new Promise((resolve) => setTimeout(resolve, 2000))
  ;({ app, page } = await launch(userData))
  await openFocus(page)
  // Closed for about two seconds plus start-up: counted from the timestamps, not frozen.
  expect(await remaining(page)).toBeLessThanOrEqual(first - 2)

  // Ending early after two minutes records the time focused.
  await page.getByTestId('focus-end').click()
  await expect(page.getByTestId('focus-record')).toHaveAttribute('data-outcome', 'ended-early')
  const session = (await readFocus(userData)).sessions[0]
  expect(session?.outcome).toBe('ended-early')
  expect(session?.focusedSec).toBeGreaterThanOrEqual(122)
  expect(session?.focusedSec).toBeLessThan(200)
  await app.close()

  await seed(userData, runningFocus(1500, 300, null, true))
  ;({ app, page } = await launch(userData))
  await openFocus(page)
  await expect(page.getByTestId('focus-countdown')).toHaveAttribute('data-state', 'paused')
  await expect(page.getByTestId('focus-countdown')).toHaveText('20:00')
  await app.close()

  // Ran out an hour ago while the app was closed: recorded, but no stale card.
  await seed(userData, runningFocus(1500, 1500 + 3600, null))
  ;({ app } = await launch(userData))
  await expect.poll(async () => (await readFocus(userData)).sessions.length).toBe(1)
  await expect.poll(() => finishedRuns(app)).toEqual([{ runId: 'seeded-run', phase: 'focus', carded: false }])
  expect((await shown(app)).filter((s) => s.variant === 'focus')).toHaveLength(0)
  await app.close()
})

test('light and dark at 100/125/150 % display scaling, smallest window: nothing overflows', async () => {
  for (const scale of [1, 1.25, 1.5]) {
    const userData = await mkdtemp(path.join(tmpdir(), 'lu-focus-layout-'))
    await seed(userData, runningFocus(1500, 90, 'task-report'))
    // Windows display scaling: the page keeps its CSS size and is drawn with more pixels.
    const { app, page } = await launch(userData, {}, [`--force-device-scale-factor=${scale}`])
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'))?.setSize(900, 560)
    })
    await openFocus(page)
    expect(await page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(scale, 2)
    // Nothing is cut off: no sideways scrolling, and every control sits inside the window.
    const fits = (): Promise<{ x: boolean; outside: string[] }> =>
      page.evaluate(() => {
        const root = document.querySelector('[data-testid=focus-mode]') ?? document.querySelector('[data-testid=focus-page]')
        const outside = Array.from(root?.querySelectorAll('button, select, [role=timer]') ?? [])
          .filter((el) => {
            const box = el.getBoundingClientRect()
            return box.width > 0 && (box.left < 0 || box.right > window.innerWidth + 0.5 || el.scrollWidth > el.clientWidth + 1)
          })
          .map((el) => el.getAttribute('data-testid') ?? el.textContent ?? '')
        return { x: document.documentElement.scrollWidth > document.documentElement.clientWidth, outside }
      })
    for (const appearance of ['light', 'dark'] as const) {
      await page.evaluate((a) => window.lifeUnlocked.settings.update({ appearance: a }), appearance)
      await page.waitForTimeout(200)
      expect(await fits()).toEqual({ x: false, outside: [] })
      await page.screenshot({ path: path.join(shots, `focus-${appearance}-${scale * 100}.png`) })
      await page.getByTestId('focus-enter-mode').click()
      await page.waitForTimeout(400)
      expect(await fits()).toEqual({ x: false, outside: [] })
      await page.screenshot({ path: path.join(shots, `focus-mode-${appearance}-${scale * 100}.png`) })
      await page.getByTestId('focus-exit-mode').click()
    }
    // Idle: the task list opens inside the window, long names shortened, also near the bottom edge.
    await page.getByTestId('focus-reset').click()
    for (const height of [560, 900]) {
      await app.evaluate(({ BrowserWindow }, h) => {
        BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'))?.setSize(900, h)
      }, height)
      await page.waitForTimeout(200)
      await page.getByTestId('focus-task-picker').click()
      const box = await page.getByTestId('select-list').evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: window.innerWidth, h: window.innerHeight, overflowX: el.scrollWidth > el.clientWidth }
      })
      expect(box.top).toBeGreaterThanOrEqual(0)
      expect(box.bottom).toBeLessThanOrEqual(box.h)
      expect(box.right).toBeLessThanOrEqual(box.w)
      expect(box.overflowX).toBe(false)
      // Drawn above the buttons under it: the last option is what a click there hits.
      await page.waitForTimeout(250)
      expect(
        await page.getByTestId('select-option').last().evaluate((el) => {
          const r = el.getBoundingClientRect()
          return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
        })
      ).toBe(true)
      await page.screenshot({ path: path.join(shots, `focus-picker-dark-${scale * 100}-${height}.png`) })
      await page.evaluate(() => window.lifeUnlocked.settings.update({ appearance: 'light' }))
      await page.waitForTimeout(200)
      await page.screenshot({ path: path.join(shots, `focus-picker-light-${scale * 100}-${height}.png`) })
      await page.evaluate(() => window.lifeUnlocked.settings.update({ appearance: 'dark' }))
      await page.keyboard.press('Escape')
    }
    await app.close()
  }
})
