import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, notificationPage, root, shots } from './helpers'

/**
 * Habit check-in feedback (Phase 6.6.1, 6.6.2, 6.6.2b): every successful check-in gets one card in the
 * notification corner: light for a plain one, gold for a weekly goal, flame for a new record. The
 * newest replaces the one on screen at once, each with its sound; a cancel or a failure is said in the
 * window. Nothing is shown twice: not on a double click, not after cancelling and checking in again, not
 * after switching pages or restarting.
 */

interface Shown {
  heading: string
  taskTitle: string
  variant: string | null
}
const shown = (app: ElectronApplication): Promise<Shown[]> =>
  app.evaluate(
    () => (globalThis as unknown as { __lifeUnlockedTest: { notifications: () => { shown: Shown[] } } }).__lifeUnlockedTest.notifications().shown
  )
const shownFor = async (app: ElectronApplication, name: string): Promise<Shown[]> =>
  (await shown(app))
    .filter((n) => n.taskTitle.startsWith(name))
    .map(({ heading, taskTitle, variant }) => ({ heading, taskTitle, variant }))

const pad = (n: number): string => String(n).padStart(2, '0')
const day = (n: number): { key: string; iso: string } => {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12)
  return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, iso: d.toISOString() }
}

const habit = (id: string, name: string, frequency: Record<string, unknown>, start: number): Record<string, unknown> => ({
  id, name, note: '', frequency, startDate: day(start).key, state: 'active', pauses: [],
  createdAt: day(start).iso, updatedAt: day(start).iso, archivedAt: null
})
const checkin = (id: string, habitId: string, n: number): Record<string, unknown> => ({
  id, habitId, date: day(n).key, checkedAt: day(n).iso, undoneAt: null
})

async function seeded(language: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-habit-feedback-'))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 5,
      tasks: [],
      completions: [],
      plans: [],
      habits: [
        habit('h1', language === 'en' ? 'Drink water' : '喝水', { kind: 'daily' }, -10),
        // Once a week: the first check-in of the week meets the goal.
        habit('h2', language === 'en' ? 'Run' : '跑步', { kind: 'weekly', timesPerWeek: 1 }, -30),
        // Longest 2 (‑5, ‑4), broken, then ‑2, ‑1: today makes 3, a new record.
        habit('h3', language === 'en' ? 'Read' : '读书', { kind: 'daily' }, -6)
      ],
      habitCheckins: [checkin('c1', 'h3', -5), checkin('c2', 'h3', -4), checkin('c3', 'h3', -2), checkin('c4', 'h3', -1)],
      settings: { language }
    }),
    'utf8'
  )
  return userData
}

async function openHabits(page: Page): Promise<void> {
  await page.locator('nav button', { hasText: /Habits|习惯/ }).click()
  await expect(page.getByTestId('habit-new').first()).toBeVisible()
}
const card = (page: Page, name: string) => page.getByTestId('habit-card').filter({ hasText: name })


/** Counts the notes each window starts (one sound = several notes). */
async function countSounds(target: Page): Promise<void> {
  await target.evaluate(() => {
    const w = window as unknown as { soundLog: string[] }
    w.soundLog = []
    const osc = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.soundLog.push(`note@${this.state}`)
      return osc.call(this)
    }
  })
}
const sounds = (target: Page): Promise<string[]> => target.evaluate(() => (window as unknown as { soundLog: string[] }).soundLog.slice())

/** The notification window's place, and the work area of the display it is on. */
const corner = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('notification.html'))
    if (!w) return null
    const bounds = w.getBounds()
    const display = screen.getDisplayMatching(bounds)
    return { visible: w.isVisible(), bounds, area: display.workArea, scale: display.scaleFactor }
  })

/** The notification sits in the bottom-right corner of the work area, entirely on screen, with the card inside it. */
async function expectBottomRight(app: ElectronApplication, notifications: Page): Promise<void> {
  const place = await corner(app)
  expect(place?.visible).toBe(true)
  const { bounds, area } = place as NonNullable<typeof place>
  expect(bounds.x + bounds.width).toBe(area.x + area.width)
  expect(bounds.y + bounds.height).toBe(area.y + area.height)
  expect(bounds.x).toBeGreaterThanOrEqual(area.x)
  expect(bounds.y).toBeGreaterThanOrEqual(area.y)
  const box = await notifications.getByTestId('achievement-card').boundingBox()
  const viewport = await notifications.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  expect(box).not.toBeNull()
  const b = box as NonNullable<typeof box>
  expect(b.x).toBeGreaterThanOrEqual(0)
  expect(b.y).toBeGreaterThanOrEqual(0)
  expect(b.x + b.width).toBeLessThanOrEqual(viewport.w + 0.5)
  expect(b.y + b.height).toBeLessThanOrEqual(viewport.h + 0.5)
}

test('plain check-in: the light card in the notification corner, gone after 2 s; cancel is said in the window', async () => {
  const userData = await seeded('en')
  const { app, page } = await launch(userData)
  await openHabits(page)
  const notifications = await notificationPage(app)
  const water = card(page, 'Drink water')
  await water.getByTestId('habit-check-in').dblclick()
  await expect
    .poll(() => shownFor(app, 'Drink water'))
    .toEqual([{ heading: '✓ Check-in complete!', taskTitle: 'Drink water', variant: 'habit-checkin' }])
  await expect(notifications.locator('.ach-wrap')).toHaveAttribute('data-variant', 'habit-checkin')
  await expectBottomRight(app, notifications)
  // Nothing at the bottom of the app window any more.
  await expect(page.getByTestId('habit-notice')).toHaveCount(0)
  await notifications.waitForTimeout(400)
  await notifications.screenshot({ path: path.join(shots, 'habit-feedback-1-checkin.png') })
  // Gone after its 2 s (plus the exit animation).
  await expect.poll(async () => (await corner(app))?.visible, { timeout: 4000 }).toBe(false)

  // The double click recorded one check-in and showed one card.
  const data = JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as {
    habitCheckins: { habitId: string; undoneAt: string | null }[]
  }
  expect(data.habitCheckins.filter((c) => c.habitId === 'h1')).toHaveLength(1)
  expect(await shownFor(app, 'Drink water')).toHaveLength(1)

  // Switching pages and back shows nothing again.
  await page.locator('nav button', { hasText: 'Tasks' }).click()
  await openHabits(page)
  await page.waitForTimeout(300)
  expect(await shownFor(app, 'Drink water')).toHaveLength(1)

  await water.getByTestId('habit-undo').click()
  await expect(page.getByTestId('habit-notice')).toHaveAttribute('data-kind', 'undone')
  await expect(page.getByTestId('habit-notice-text')).toHaveText('Check-in cancelled')
  await expect(water.getByTestId('habit-streak-current')).toHaveAttribute('data-value', '0')
  expect(await shownFor(app, 'Drink water')).toHaveLength(1)
  await app.close()
})

test('weekly goal and new record: gold and flame cards in the corner; after a cancel the goal comes back light; nothing replays', async () => {
  const userData = await seeded('zh-CN')
  const { app, page } = await launch(userData)
  await openHabits(page)
  const notifications = await notificationPage(app)

  // Level 3: the weekly goal (gold), 0 → 1 of 1.
  const run = card(page, '跑步')
  await run.getByTestId('habit-check-in').click()
  await expect.poll(() => shownFor(app, '跑步')).toEqual([{ heading: '🏆 本周目标达成！1/1', taskTitle: '跑步', variant: 'habit-goal' }])
  await expect(notifications.getByTestId('achievement-habit-badge')).toBeVisible()
  await expectBottomRight(app, notifications)
  await notifications.waitForTimeout(1200)
  await notifications.screenshot({ path: path.join(shots, 'habit-feedback-3-weekly-goal.png') })
  await expect(run.getByTestId('habit-week-progress')).toContainText('1/1')

  // Cancel (back to 0/1) and check in again: this week's gold reward was given, so a quiet card says
  // the goal is met and the reward is not given twice (Phase 6.6.2c); no second celebration.
  await run.getByTestId('habit-undo').click()
  await expect(run.getByTestId('habit-week-progress')).toContainText('0/1')
  await run.getByTestId('habit-check-in').click()
  await expect.poll(async () => (await shownFor(app, '跑步')).length).toBe(2)
  expect((await shownFor(app, '跑步'))[1]).toEqual({ heading: '本周目标已达成 1/1', taskTitle: '跑步', variant: 'habit-claimed' })
  await expect(notifications.getByTestId('achievement-detail')).toHaveText('金色奖励已领取 · 本周不重复发放')
  await expectBottomRight(app, notifications)
  await notifications.waitForTimeout(600)
  await notifications.screenshot({ path: path.join(shots, 'habit-feedback-4-claimed.png') })
  await expect(run.getByTestId('habit-week-progress')).toContainText('1/1')

  // Level 2: a new record (flame), which is also the 3-day milestone: one card only.
  const reading = card(page, '读书')
  await expect(reading.getByTestId('habit-streak-longest')).toHaveText('2 天')
  await reading.getByTestId('habit-check-in').click()
  await expect.poll(() => shownFor(app, '读书')).toEqual([{ heading: '🔥 新纪录！连续坚持 3 天！', taskTitle: '读书', variant: 'habit-record' }])
  await expect(notifications.locator('.ach-wrap')).toHaveAttribute('data-variant', 'habit-record')
  await expectBottomRight(app, notifications)
  await notifications.waitForTimeout(900)
  await notifications.screenshot({ path: path.join(shots, 'habit-feedback-2-record.png') })
  await expect(reading.getByTestId('habit-streak-longest')).toHaveText('3 天')
  await app.close()

  // Restarting shows nothing again, and the stored records still know this week's reward was given.
  const again = await launch(userData)
  await openHabits(again.page)
  await again.page.waitForTimeout(800)
  expect(await shown(again.app)).toEqual([])
  const runAgain = card(again.page, '跑步')
  await runAgain.getByTestId('habit-undo').click()
  await runAgain.getByTestId('habit-check-in').click()
  await expect.poll(() => shownFor(again.app, '跑步')).toEqual([{ heading: '本周目标已达成 1/1', taskTitle: '跑步', variant: 'habit-claimed' }])
  await again.app.close()
})

test('quick check-ins in a row: each card replaces the one before at once, each with its sound', async () => {
  const userData = await seeded('en')
  const { app, page } = await launch(userData)
  await openHabits(page)
  const notifications = await notificationPage(app)
  await countSounds(notifications)
  const notes = async (): Promise<number> => (await sounds(notifications)).length
  const active = (): Promise<string | null> =>
    app.evaluate(
      () =>
        (globalThis as unknown as { __lifeUnlockedTest: { notifications: () => { active: string | null } } }).__lifeUnlockedTest.notifications()
          .active
    )
  const variant = (): Promise<string | null> => notifications.locator('.ach-wrap').getAttribute('data-variant')

  // Record (flame) → plain (light) → weekly goal (gold), each clicked while the one before is still on.
  await card(page, 'Read').getByTestId('habit-check-in').click()
  await expect.poll(variant).toBe('habit-record')
  await expect.poll(notes).toBeGreaterThan(0)
  let before = await notes()
  const first = await active()
  await card(page, 'Drink water').getByTestId('habit-check-in').click()
  await expect.poll(variant).toBe('habit-checkin')
  expect(await active()).not.toBe(first)
  await expect.poll(notes).toBeGreaterThan(before)
  before = await notes()
  await card(page, 'Run').getByTestId('habit-check-in').click()
  await expect.poll(variant).toBe('habit-goal')
  await expect.poll(notes).toBeGreaterThan(before)
  expect((await sounds(notifications)).every((s) => s === 'note@running')).toBe(true)
  await expect(notifications.getByTestId('achievement-card')).toHaveCount(1)
  // The light card's 2 s are over, the gold card is still there.
  await page.waitForTimeout(2600)
  expect(await variant()).toBe('habit-goal')
  expect((await corner(app))?.visible).toBe(true)

  // Each habit has exactly one counted check-in for today.
  const data = JSON.parse(await readFile(path.join(userData, 'life-unlocked-data.json'), 'utf8')) as {
    habitCheckins: { habitId: string; date: string; undoneAt: string | null }[]
  }
  const today = day(0).key
  for (const id of ['h1', 'h2', 'h3']) {
    expect(data.habitCheckins.filter((c) => c.habitId === id && c.date === today && c.undoneAt === null)).toHaveLength(1)
  }

  // Cancelling the goal's check-in takes its card away and plays no tone.
  before = await notes()
  await card(page, 'Run').getByTestId('habit-undo').click()
  await expect(page.getByTestId('habit-notice')).toHaveAttribute('data-kind', 'undone')
  await expect.poll(async () => (await corner(app))?.visible).toBe(false)
  await page.waitForTimeout(300)
  expect(await notes()).toBe(before)
  await app.close()
})

test('three plain check-ins in a row end on the third card with its full time; volume 0 stays silent', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-habit-feedback-'))
  await writeFile(
    path.join(userData, 'life-unlocked-data.json'),
    JSON.stringify({
      schemaVersion: 5,
      tasks: [],
      completions: [],
      plans: [],
      habits: [habit('p1', 'One', { kind: 'daily' }, -1), habit('p2', 'Two', { kind: 'daily' }, -1), habit('p3', 'Three', { kind: 'daily' }, -1)],
      habitCheckins: [],
      settings: { language: 'en', notificationVolume: 0 }
    }),
    'utf8'
  )
  const { app, page } = await launch(userData)
  await openHabits(page)
  const notifications = await notificationPage(app)
  await countSounds(notifications)
  const title = (): Promise<string | null> => notifications.locator('.ach-title').textContent()
  await card(page, 'One').getByTestId('habit-check-in').click()
  await expect.poll(title).toBe('One')
  await page.waitForTimeout(1500)
  await card(page, 'Two').getByTestId('habit-check-in').click()
  await card(page, 'Three').getByTestId('habit-check-in').click()
  await expect.poll(title).toBe('Three')
  // When the first card's time is over, the third is still there…
  await page.waitForTimeout(1000)
  expect(await title()).toBe('Three')
  expect((await corner(app))?.visible).toBe(true)
  // …and it goes on its own afterwards.
  await expect.poll(async () => (await corner(app))?.visible, { timeout: 4000 }).toBe(false)
  // Volume 0: no tone at all.
  expect(await sounds(notifications)).toEqual([])
  await app.close()
})

for (const scale of [1.25, 1.5]) {
  test(`display scaling ${scale * 100}%: plain, record and goal cards sit fully in the bottom-right corner`, async () => {
    const userData = await seeded('zh-CN')
    const app = await electron.launch({
      args: [`--force-device-scale-factor=${scale}`, root],
      env: { ...process.env, LIFE_UNLOCKED_USER_DATA: userData, LIFE_UNLOCKED_TEST_HOOKS: '1' } as Record<string, string>
    })
    const page = await app.firstWindow()
    await page.waitForSelector('nav')
    await openHabits(page)
    const notifications = await notificationPage(app)
    for (const [name, variant] of [
      ['喝水', 'habit-checkin'],
      ['读书', 'habit-record'],
      ['跑步', 'habit-goal']
    ] as const) {
      await card(page, name).getByTestId('habit-check-in').click()
      await expect(notifications.locator('.ach-wrap')).toHaveAttribute('data-variant', variant)
      await expectBottomRight(app, notifications)
    }
    // The quiet "already given" card, with its third line, fits too (not cut off).
    await card(page, '跑步').getByTestId('habit-undo').click()
    await card(page, '跑步').getByTestId('habit-check-in').click()
    await expect(notifications.locator('.ach-wrap')).toHaveAttribute('data-variant', 'habit-claimed')
    await expectBottomRight(app, notifications)
    const detail = notifications.getByTestId('achievement-detail')
    expect(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    const inside = await notifications.evaluate(() => {
      const cardBox = document.querySelector('[data-testid=achievement-card]')?.getBoundingClientRect()
      const lines = Array.from(document.querySelectorAll('.ach-heading, .ach-title, .ach-detail')).map((el) => el.getBoundingClientRect())
      return !!cardBox && lines.every((r) => r.top >= cardBox.top && r.bottom <= cardBox.bottom)
    })
    expect(inside).toBe(true)
    expect((await corner(app))?.scale).toBe(scale)
    await notifications.waitForTimeout(900)
    await notifications.screenshot({ path: path.join(shots, `habit-feedback-scale-${scale * 100}.png`) })
    await app.close()
  })
}

test('reduced motion: the card still shows, without particles', async () => {
  const userData = await seeded('en')
  const { app, page } = await launch(userData)
  await openHabits(page)
  const notifications = await notificationPage(app)
  await notifications.emulateMedia({ reducedMotion: 'reduce' })
  await card(page, 'Read').getByTestId('habit-check-in').click()
  await expect(notifications.getByTestId('achievement-card')).toBeVisible()
  await expect(notifications.locator('.ach-particles')).toBeHidden()
  await app.close()
})

for (const appearance of ['light', 'dark'] as const) {
  test(`${appearance} appearance: the habit page after a goal met again, and the quiet card in the corner`, async () => {
    const userData = await seeded('zh-CN')
    const { app, page } = await launch(userData)
    await page.evaluate(
      (value) =>
        (window as unknown as { lifeUnlocked: { settings: { update: (p: unknown) => Promise<unknown> } } }).lifeUnlocked.settings.update({
          appearance: value
        }),
      appearance
    )
    await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance)
    await openHabits(page)
    const notifications = await notificationPage(app)
    const run = card(page, '跑步')
    await run.getByTestId('habit-check-in').click()
    await expect(notifications.locator('.ach-wrap')).toHaveAttribute('data-variant', 'habit-goal')
    await run.getByTestId('habit-undo').click()
    await run.getByTestId('habit-check-in').click()
    await expect(notifications.locator('.ach-wrap')).toHaveAttribute('data-variant', 'habit-claimed')
    await expect(run.getByTestId('habit-checked')).toBeVisible()
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(shots, `habit-feedback-page-${appearance}.png`) })
    await notifications.screenshot({ path: path.join(shots, `habit-feedback-claimed-${appearance}.png`) })
    await app.close()
  })
}
