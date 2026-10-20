import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, notificationPage } from './helpers'

/**
 * Smart plan achievements and the instant notifications of Phase 5 together: a plan achievement
 * follows the completion that caused it through the same scheduler (newest on screen, never twice,
 * withdrawn on undo), but it is not a completion, so it never joins a burst or its summary.
 */

interface Shown {
  id: string
  kind: string
  heading: string
  taskTitle: string
}
interface Hooks {
  notifications: () => { active: string | null; shown: Shown[] }
  burst: () => { eventId: string }[]
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
const clickTrayItem = (app: ElectronApplication, id: string): Promise<boolean> =>
  app.evaluate(
    (_e, itemId) => (globalThis as unknown as { __lifeUnlockedTest: Hooks }).__lifeUnlockedTest.clickTrayItem(itemId),
    id
  )

interface Unlock {
  id: string
  target: string
  revokedAt: string | null
}
interface Data {
  completions: { id: string; taskId: string; undoneAt: string | null }[]
  plans: { unlocks: Unlock[] }[]
}
const readData = async (userData: string): Promise<Data> =>
  JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as Data
const activeUnlocks = (data: Data): Unlock[] => data.plans[0]!.unlocks.filter((u) => u.revokedAt === null)

const pad = (n: number): string => String(n).padStart(2, '0')
const keyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const day = (n: number): { key: string; iso: string } => {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12)
  return { key: keyOf(d), iso: d.toISOString() }
}
const today = day(0).key

/**
 * A plan one completion away from "All Achievements!": the essay goal is achieved, "Learn 20 words"
 * has 2 of 3 days. "Plain task" belongs to no plan.
 */
async function seedPlan(userData: string): Promise<void> {
  const created = day(-2)
  const task = (id: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
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
        }),
        task('plain', 'Plain task')
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
      settings: { language: 'en', notificationDurationSec: 8 }
    })
  )
}

/** Completes through the same API the pages use, without pausing; returns the completion record ids. */
const completeAll = (page: Page, list: { id: string; occurrence?: string }[]): Promise<string[]> =>
  page.evaluate(async (items) => {
    const events: string[] = []
    for (const { id, occurrence } of items) {
      const result = await window.lifeUnlocked.tasks.complete(id, occurrence)
      if (result.event) events.push(result.event.id)
    }
    return events
  }, list)

/** The unlock ids of the words goal and the plan's master, in the order they were unlocked. */
async function newUnlocks(userData: string, except: string[] = []): Promise<{ goal: string; master: string }> {
  const unlocks = activeUnlocks(await readData(userData)).filter((u) => !except.includes(u.id))
  return {
    goal: unlocks.find((u) => u.target === 'g-words')!.id,
    master: unlocks.find((u) => u.target === 'plan')!.id
  }
}

test('tray quick complete unlocks the plan: task, goal, then "All Achievements!" on screen; no summary for one completion', async () => {
  test.setTimeout(60_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-plan-tray-'))
  await seedPlan(userData)
  const { app, page } = await launch(userData)

  expect(await clickTrayItem(app, `quick-complete:words@${today}`)).toBe(true)
  await expect.poll(async () => (await shownOf(app, 'achievement')).length, { timeout: 8000 }).toBe(3)
  const data = await readData(userData)
  const completion = data.completions.find((e) => e.taskId === 'words' && !['c-1', 'c-2'].includes(e.id))!.id
  const { goal, master } = await newUnlocks(userData, ['u-essay'])

  // Same scheduler as every completion: in order, each replacing the one before, the newest stays.
  expect((await shownOf(app, 'achievement')).map(({ id, heading, taskTitle }) => ({ id, heading, taskTitle }))).toEqual([
    { id: completion, heading: 'Achievement Unlocked!', taskTitle: 'Learn 20 words' },
    { id: goal, heading: 'Plan Achievement Unlocked!', taskTitle: 'Word Collector' },
    { id: master, heading: 'All Achievements!', taskTitle: 'Exam week' }
  ])
  expect((await state(app)).active).toBe(master)
  // Only the completion counts towards a burst.
  expect((await state(app)).burst).toEqual([completion])
  const toast = await notificationPage(app)
  await expect(toast.locator('[data-testid=achievement-toast][data-variant=plan]')).toBeVisible()
  await expect(toast.getByTestId('achievement-master-badge')).toBeVisible()

  // One completion: no summary, and the gold card is not replaced.
  await page.waitForTimeout(3500)
  expect(await shownOf(app, 'summary')).toEqual([])
  expect((await state(app)).active).toBe(master)
  await app.close()
})

test('a burst with a plan completion: the summary counts the two completions, not the plan achievements', async () => {
  test.setTimeout(60_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-plan-burst-'))
  await seedPlan(userData)
  const { app, page } = await launch(userData)

  const events = await completeAll(page, [{ id: 'plain' }, { id: 'words', occurrence: today }])
  expect(events).toHaveLength(2)
  const { goal, master } = await newUnlocks(userData, ['u-essay'])
  expect((await state(app)).burst).toEqual(events)
  await expect.poll(async () => (await state(app)).shown.map((n) => n.id)).toEqual([...events, goal, master])

  await expect.poll(async () => (await shownOf(app, 'summary')).length, { timeout: 5000 }).toBe(1)
  expect((await shownOf(app, 'summary'))[0]).toMatchObject({
    heading: '2 tasks completed in a row!',
    taskTitle: 'Plain task, Learn 20 words'
  })
  const toast = await notificationPage(app)
  await expect(toast.getByTestId('achievement-toast')).toHaveAttribute('data-variant', 'summary')
  // Every notification reached the screen exactly once.
  const ids = (await state(app)).shown.map((n) => n.id)
  expect(new Set(ids).size).toBe(ids.length)
  await app.close()
})

test('undo inside a round withdraws the plan achievements and leaves the round; completing again unlocks anew', async () => {
  test.setTimeout(60_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-plan-undo-'))
  await seedPlan(userData)
  // A longer round so the undo surely lands inside it.
  const { app, page } = await launch(userData, { LIFE_UNLOCKED_BURST_IDLE_MS: '5000' })

  const [plain, words] = await completeAll(page, [{ id: 'plain' }, { id: 'words', occurrence: today }])
  const first = await newUnlocks(userData, ['u-essay'])
  // `active` is set as soon as a notification is asked for, before the window has shown it; wait until
  // all four reached the screen, or the undo below would withdraw some while still waiting (by design).
  await expect.poll(async () => (await state(app)).shown.map((n) => n.id), { timeout: 8000 }).toEqual([
    plain,
    words,
    first.goal,
    first.master
  ])
  expect((await state(app)).active).toBe(first.master)
  expect((await state(app)).burst).toEqual([plain, words])

  // Undo the plan task's completion: its record leaves the round, the plan achievements are revoked.
  const undone = await page.evaluate((id) => window.lifeUnlocked.tasks.undoCompletion(id), words!)
  expect(undone.undone).toBe(true)
  expect((await state(app)).burst).toEqual([plain])
  const revoked = (await readData(userData)).plans[0]!.unlocks.filter((u) => u.revokedAt !== null).map((u) => u.id)
  expect(revoked.sort()).toEqual([first.goal, first.master].sort())
  expect(activeUnlocks(await readData(userData)).map((u) => u.id)).toEqual(['u-essay'])
  // The card already on screen finishes (it is not pulled away), as for any undone completion.
  expect((await state(app)).active).toBe(first.master)

  // Only one completion is left in the round: no summary.
  await page.waitForTimeout(6500)
  expect(await shownOf(app, 'summary')).toEqual([])

  // Completing again is a new record with new plan achievements, each shown once.
  const [again] = await completeAll(page, [{ id: 'words', occurrence: today }])
  const second = await newUnlocks(userData, ['u-essay'])
  expect([second.goal, second.master]).not.toContain(first.goal)
  expect([second.goal, second.master]).not.toContain(first.master)
  await expect.poll(async () => (await state(app)).shown.map((n) => n.id)).toEqual([
    plain,
    words,
    first.goal,
    first.master,
    again,
    second.goal,
    second.master
  ])
  expect((await state(app)).burst).toEqual([again])
  await app.close()
})

test('plan achievements unlocked while the notification window is still loading still show, in order', async () => {
  test.setTimeout(60_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-plan-slow-window-'))
  await seedPlan(userData)
  const { app, page } = await launch(userData, { LIFE_UNLOCKED_NOTIFICATION_READY_DELAY_MS: '3000' })

  const [words] = await completeAll(page, [{ id: 'words', occurrence: today }])
  const { goal, master } = await newUnlocks(userData, ['u-essay'])
  // Not ready yet: nothing on screen, but the newest (the plan's master) is the active one.
  expect((await state(app)).shown).toEqual([])
  expect((await state(app)).active).toBe(master)
  await expect.poll(async () => (await state(app)).shown.map((n) => n.id), { timeout: 8000 }).toEqual([words, goal, master])
  const toast = await notificationPage(app)
  await expect(toast.locator('[data-testid=achievement-toast][data-variant=plan]')).toBeVisible()
  await app.close()
})
