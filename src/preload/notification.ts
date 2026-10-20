import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannels, type AchievementApi } from '../shared/ipc'
import type { AchievementPayload } from '../shared/types'

let readySent = false

const api: AchievementApi = {
  onShow: (listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: AchievementPayload): void => listener(payload)
    ipcRenderer.on(IpcChannels.notificationShow, wrapped)
    // The page has finished loading before React subscribes; main waits for this before sending.
    if (!readySent) {
      readySent = true
      ipcRenderer.send(IpcChannels.notificationReady)
    }
    return () => ipcRenderer.removeListener(IpcChannels.notificationShow, wrapped)
  },
  onClear: (listener) => {
    const wrapped = (): void => listener()
    ipcRenderer.on(IpcChannels.notificationClear, wrapped)
    return () => ipcRenderer.removeListener(IpcChannels.notificationClear, wrapped)
  }
}

contextBridge.exposeInMainWorld('achievement', api)
