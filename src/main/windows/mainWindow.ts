import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'
import { readJson, writeJsonAtomic } from '../storage/jsonFile'
import { isTrustedUrl, loadRendererPage, preloadPath } from '../paths'
import { WINDOW_CHROME, titleBarColors, type ResolvedAppearance } from '../../shared/appearance'
import { parseSavedWindowState, resolveWindowBounds, type SavedWindowState } from './windowBounds'
import appIconIco from '../assets/app/icon.ico?asset'
import appIconPng from '../assets/app/icon.png?asset'

const LIMITS = { defaultWidth: 1100, defaultHeight: 680, minWidth: 900, minHeight: 560 }
const STATE_FILE = 'window-state.json'
const TITLE_BAR_HEIGHT = 40

/**
 * Repaints the parts of the window the page cannot: the pre-paint background and the Windows title bar buttons.
 * `modalOpen` dims the buttons to match the page's dialog scrim (they stay clickable).
 * Returns the title bar colors applied, or null when there is no overlay (macOS).
 */
export function applyWindowChrome(
  window: BrowserWindow,
  appearance: ResolvedAppearance,
  modalOpen = false
): { color: string; symbolColor: string } | null {
  if (window.isDestroyed()) return null
  window.setBackgroundColor(WINDOW_CHROME[appearance].background)
  if (process.platform === 'darwin') return null
  const colors = titleBarColors(appearance, modalOpen)
  try {
    window.setTitleBarOverlay({ ...colors, height: TITLE_BAR_HEIGHT })
    return colors
  } catch (error) {
    console.warn('[MainWindow] Title bar overlay not supported', error)
    return null
  }
}

/** Puts the window back on a connected display if it is no longer reachable (e.g. its monitor was unplugged). */
export function keepMainWindowOnScreen(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return
  const current = window.getNormalBounds()
  const next = resolveWindowBounds(
    { ...current, isMaximized: false },
    screen.getAllDisplays().map((d) => d.workArea),
    screen.getPrimaryDisplay().workArea,
    LIMITS
  )
  if (next.x !== current.x || next.y !== current.y || next.width !== current.width || next.height !== current.height) {
    window.setBounds(next)
  }
}

export async function createMainWindow(userDataDir: string, appearance: ResolvedAppearance): Promise<BrowserWindow> {
  const chrome = WINDOW_CHROME[appearance]
  const stateFile = path.join(userDataDir, STATE_FILE)
  const saved = await readJson(stateFile).then((r) => (r.kind === 'ok' ? parseSavedWindowState(r.value) : null))
  const bounds = resolveWindowBounds(
    saved,
    screen.getAllDisplays().map((d) => d.workArea),
    screen.getPrimaryDisplay().workArea,
    LIMITS
  )

  const isMac = process.platform === 'darwin'
  const window = new BrowserWindow({
    ...bounds,
    minWidth: LIMITS.minWidth,
    minHeight: LIMITS.minHeight,
    show: false,
    title: 'Activra',
    // The installed app takes its icon from the .exe; this covers development runs and Linux.
    icon: process.platform === 'win32' ? appIconIco : appIconPng,
    backgroundColor: chrome.background,
    // Frameless look, but native window controls so Windows snap layouts and macOS traffic lights keep working.
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 13 } }
      : { titleBarOverlay: { color: chrome.background, symbolColor: chrome.symbol, height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: preloadPath('index'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  // Maximizing a hidden window shows it on Windows before the page has painted, so wait for the page.
  window.once('ready-to-show', () => {
    if (saved?.isMaximized) window.maximize()
    window.show()
  })

  // Keep the window on our own pages; open http(s) links in the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })

  let saveTimer: NodeJS.Timeout | undefined
  const currentState = (): SavedWindowState => ({ ...window.getNormalBounds(), isMaximized: window.isMaximized() })
  const saveState = (): Promise<void> => {
    if (window.isDestroyed() || window.isMinimized()) return Promise.resolve()
    return writeJsonAtomic(stateFile, currentState()).catch((error) =>
      console.error('[MainWindow] Save state failed', error)
    )
  }
  const scheduleSave = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void saveState(), 500)
  }
  window.on('resize', scheduleSave)
  window.on('move', scheduleSave)
  window.on('maximize', scheduleSave)
  window.on('unmaximize', scheduleSave)
  window.on('close', () => {
    clearTimeout(saveTimer)
    // Synchronous so the state is on disk even if the app quits right after.
    try {
      writeFileSync(stateFile, JSON.stringify(currentState()), 'utf8')
    } catch (error) {
      console.error('[MainWindow] Save state failed', error)
    }
  })

  await loadRendererPage(window, 'index')
  return window
}
