import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, notificationPage } from './helpers'

declare global {
  interface Window {
    __lu: { shown: string[]; variants: string[]; liveOscillators: number; audio: string[] }
  }
}

/** Records every card that appears, how many synthesized notes are still sounding and which audio files played. */
async function instrument(toast: Page): Promise<void> {
  await toast.evaluate(() => {
    const state = { shown: [] as string[], variants: [] as string[], liveOscillators: 0, audio: [] as string[] }
    window.__lu = state
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const result = play.call(this)
      result.then(
        () => state.audio.push(`played ${this.src}`),
        () => state.audio.push(`failed ${this.src}`)
      )
      return result
    }
    const start = OscillatorNode.prototype.start
    OscillatorNode.prototype.start = function (this: OscillatorNode, ...args: Parameters<OscillatorNode['start']>) {
      state.liveOscillators += 1
      this.addEventListener('ended', () => (state.liveOscillators -= 1))
      return start.apply(this, args)
    }
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of Array.from(r.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue
          const wrap = node.matches('.ach-wrap') ? node : node.querySelector('.ach-wrap')
          if (wrap instanceof HTMLElement) {
            state.shown.push(`${wrap.dataset['theme']}:${wrap.querySelector('[data-testid=achievement-card]')?.textContent ?? ''}`)
            state.variants.push(wrap.dataset['variant'] ?? 'single')
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
}

async function toastWindowState(app: ElectronApplication): Promise<{ windows: number; notificationWindows: number; visible: boolean }> {
  return app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows()
    const toasts = all.filter((w) => w.webContents.getURL().includes('notification.html'))
    return { windows: all.length, notificationWindows: toasts.length, visible: toasts.some((w) => w.isVisible()) }
  })
}

const preview = (page: Page, id: string) => page.getByTestId(`theme-${id}`).getByRole('button', { name: 'Preview' }).click()

test('previews replace each other at once; real achievements replace at once and are summarized', async () => {
  test.setTimeout(120_000)
  const userData = await mkdtemp(path.join(tmpdir(), 'lu-notify-'))
  const { app, page } = await launch(userData)
  // 3 s notifications: the window hides 3.4 s after a toast starts.
  await page.evaluate(() => window.lifeUnlocked.settings.update({ notificationDurationSec: 3, language: 'en' }))
  await page.locator('aside').getByRole('button', { name: 'Themes' }).click()

  await preview(page, 'classic')
  const toast = await notificationPage(app)
  const card = toast.getByTestId('achievement-toast')
  await expect(card).toHaveAttribute('data-theme', 'classic', { timeout: 8000 })
  await instrument(toast)

  // Classic → Legendary while Classic plays: Legendary at once, Classic gone
  await preview(page, 'legendary')
  await expect(card).toHaveAttribute('data-theme', 'legendary', { timeout: 1000 })
  await expect(toast.getByTestId('achievement-card')).toHaveCount(1)

  // Same theme again restarts from the beginning: the old card element is replaced
  await toast.locator('.ach-wrap').evaluate((el) => el.setAttribute('data-old', 'true'))
  await preview(page, 'legendary')
  await expect(toast.locator('.ach-wrap[data-old]')).toHaveCount(0, { timeout: 1000 })
  await expect(toast.getByTestId('achievement-card')).toHaveCount(1)

  // A stale timer from an earlier preview must not hide the newest one
  await toast.waitForTimeout(2000)
  await preview(page, 'enhanced')
  await expect(card).toHaveAttribute('data-theme', 'enhanced', { timeout: 1000 })
  await toast.waitForTimeout(2000) // past when the Legendary preview would have ended
  expect((await toastWindowState(app)).visible).toBe(true)
  await expect(card).toHaveAttribute('data-theme', 'enhanced')

  // Rapid clicking: one window, one card, only the last preview's sound still playing
  const order = ['classic', 'enhanced', 'legendary', 'custom', 'classic', 'classic', 'enhanced', 'custom', 'legendary', 'legendary']
  for (const id of order) await preview(page, id)
  await toast.evaluate(() => (window.__lu.audio = []))
  await page.getByRole('button', { name: 'Test achievement' }).click() // current global theme: Legendary
  await expect(card).toHaveAttribute('data-theme', 'legendary', { timeout: 1500 })
  await expect(toast.getByTestId('achievement-card')).toHaveCount(1)
  // Legendary plays the synthesized bright chime; no audio file is played for a built-in theme
  expect(await toast.evaluate(() => window.__lu.audio.filter((a) => a.startsWith('played ')))).toEqual([])
  expect(await toastWindowState(app)).toEqual({ windows: 2, notificationWindows: 1, visible: true })
  // ...and it hides once, on time, after the last request
  await expect.poll(async () => (await toastWindowState(app)).visible, { timeout: 6000 }).toBe(false)
  expect(await toast.evaluate(() => window.__lu.liveOscillators)).toBe(0)

  // Preview → real achievement: the achievement replaces the preview at once
  const taskIds = await page.evaluate(async () => {
    const api = window.lifeUnlocked.tasks
    const first = await api.create({ title: 'First real', themeOverride: 'classic' })
    const second = await api.create({ title: 'Second real', themeOverride: 'enhanced' })
    return [first.id, second.id] as const
  })
  await preview(page, 'custom')
  await expect(card).toHaveAttribute('data-theme', 'custom', { timeout: 1500 })
  await toast.evaluate(() => {
    window.__lu.shown = []
    window.__lu.variants = []
  })
  await page.evaluate(async ([first, second]) => {
    await window.lifeUnlocked.tasks.complete(first)
    await window.lifeUnlocked.tasks.complete(second)
  }, taskIds)
  // Each completion shows the moment it happens: the second replaces the first at once, no waiting.
  await expect(toast.getByTestId('achievement-card')).toContainText('Second real', { timeout: 1000 })

  // Real → preview: previews wait behind real notifications and never interrupt them.
  await preview(page, 'classic')
  await preview(page, 'legendary')
  await preview(page, 'enhanced')
  // Checked on the history of what reached the screen (below), not on the card at one moment: the
  // clicks above can take seconds on a busy PC, by which time the summary (2 s after the last
  // completion) and even the waiting preview after it are rightly on screen already.
  // About 2 s after the last completion, the burst settles: one summary replaces the card on screen;
  // it plays its full time, then only the latest waiting preview, then the window hides.
  await expect.poll(() => toast.evaluate(() => window.__lu.shown.length), { timeout: 10_000 }).toBe(4)
  await expect.poll(async () => (await toastWindowState(app)).visible, { timeout: 6000 }).toBe(false)
  expect(await toast.evaluate(() => window.__lu.variants)).toEqual(['single', 'single', 'summary', 'single'])
  const shown = await toast.evaluate(() => window.__lu.shown)
  expect(shown.map((s) => s.split(':')[0])).toEqual(['classic', 'enhanced', 'legendary', 'enhanced'])
  expect(shown[0]).toContain('First real')
  expect(shown[1]).toContain('Second real')
  expect(shown[2]).toContain('2 tasks completed in a row!')
  expect(shown[2]).toContain('First real, Second real')
  expect(shown[3]).not.toContain('real')

  expect((await toastWindowState(app)).windows).toBe(2)
  await app.close()
})
