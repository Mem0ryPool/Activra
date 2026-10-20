import path from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'

export const root = path.resolve(__dirname, '../..')
export const shots = path.join(__dirname, 'screenshots')

export async function launch(
  userData: string,
  extraEnv: Record<string, string> = {},
  /** Extra Chromium switches, e.g. --force-device-scale-factor=1.5 for Windows display scaling. */
  switches: string[] = []
): Promise<{ app: ElectronApplication; page: Page }> {
  const args = [...switches, root]
  // Containers run as root, where Chromium requires --no-sandbox. Never needed on a normal desktop.
  if (process.getuid?.() === 0) args.unshift('--no-sandbox')
  const app = await electron.launch({
    args,
    env: { ...process.env, LIFE_UNLOCKED_USER_DATA: userData, LIFE_UNLOCKED_TEST_HOOKS: '1', ...extraEnv } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForSelector('nav')
  return { app, page }
}

export async function notificationPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('notification.html'))).toBe(true)
  return app.windows().find((w) => w.url().includes('notification.html')) as Page
}

export async function widgetPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('widget.html'))).toBe(true)
  const page = app.windows().find((w) => w.url().includes('widget.html')) as Page
  await page.waitForSelector('[data-testid=widget-panel]')
  return page
}

/** Facts about the widget window from the main process, or null when it is not open. */
export function widgetWindow(app: ElectronApplication): Promise<{
  bounds: { x: number; y: number; width: number; height: number }
  visible: boolean
  alwaysOnTop: boolean
  resizable: boolean
  menuBarVisible: boolean
} | null> {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(
      // A closing window can still be listed after its page is gone; skip it rather than throw.
      (x) => !x.isDestroyed() && !x.webContents.isDestroyed() && x.webContents.getURL().includes('widget.html')
    )
    if (!w) return null
    return {
      bounds: w.getBounds(),
      visible: w.isVisible(),
      alwaysOnTop: w.isAlwaysOnTop(),
      resizable: w.isResizable(),
      menuBarVisible: w.isMenuBarVisible()
    }
  })
}

/** Picks `value` in one of the app's Select dropdowns (a combobox button with a list in a portal). */
export async function choose(page: Page, combobox: Locator, value: string): Promise<void> {
  // Marked first: its accessible name may change with the choice (Language → 语言).
  await combobox.evaluate((el) => el.setAttribute('data-choosing', ''))
  const chosen = page.locator('[data-choosing]')
  await chosen.click()
  await page.locator(`[data-testid=select-list] [data-testid=select-option][data-value="${value}"]`).click()
  await expect(chosen).toHaveAttribute('data-value', value)
  await chosen.evaluate((el) => el.removeAttribute('data-choosing'))
}
