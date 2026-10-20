import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannels, type WidgetApi } from '../shared/ipc'
import type { Settings, TaskSnapshot } from '../shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

// The widget can read tasks, complete them and undo a completion, nothing else: no editing, deleting or settings writes.
const api: WidgetApi = {
  platform: process.platform,
  tasks: {
    list: () => ipcRenderer.invoke(IpcChannels.tasksList),
    complete: (id, occurrence) => ipcRenderer.invoke(IpcChannels.tasksComplete, id, occurrence ?? null),
    undoCompletion: (eventId) => ipcRenderer.invoke(IpcChannels.tasksUndoCompletion, eventId),
    snapshot: () => ipcRenderer.invoke(IpcChannels.tasksSnapshot),
    onChanged: (listener) => subscribe<TaskSnapshot>(IpcChannels.tasksChanged, listener)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    onChanged: (listener) => subscribe<Settings>(IpcChannels.settingsChanged, listener)
  },
  app: {
    info: () => ipcRenderer.invoke(IpcChannels.appInfo)
  },
  widget: {
    close: () => ipcRenderer.invoke(IpcChannels.widgetClose),
    openMain: () => ipcRenderer.invoke(IpcChannels.widgetOpenMain),
    onEnter: (listener) => subscribe<void>(IpcChannels.widgetEnter, () => listener()),
    onExit: (listener) => subscribe<void>(IpcChannels.widgetExit, () => listener())
  }
}

contextBridge.exposeInMainWorld('lifeUnlockedWidget', api)
