import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInsideDirectory } from './pathUtils'
import { app } from 'electron'

/** Dev server URL injected by electron-vite in development, undefined in production. */
const devServerUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined

export type RendererPage = 'index' | 'notification' | 'widget'

export function preloadPath(name: RendererPage): string {
  return path.join(__dirname, `../preload/${name}.js`)
}

export function loadRendererPage(
  window: Electron.BrowserWindow,
  page: RendererPage
): Promise<void> {
  if (devServerUrl) return window.loadURL(`${devServerUrl}/${page}.html`)
  return window.loadFile(path.join(__dirname, `../renderer/${page}.html`))
}

/** Only our own pages may call privileged IPC. */
export function isTrustedUrl(url: string | undefined): boolean {
  if (!url) return false
  if (devServerUrl) {
    try {
      if (new URL(url).origin === new URL(devServerUrl).origin) return true
    } catch {
      return false
    }
  }
  if (!url.startsWith('file://')) return false
  try {
    return isInsideDirectory(fileURLToPath(url.split(/[?#]/)[0] as string), path.join(__dirname, '../renderer'))
  } catch {
    return false
  }
}
