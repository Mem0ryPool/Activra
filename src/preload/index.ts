import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannels, type LifeUnlockedApi } from '../shared/ipc'
import type { Settings, TaskSnapshot } from '../shared/types'
import type { FocusSnapshot } from '../shared/focus/types'
import type { ShortcutStatus } from '../shared/shortcut'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

// Only these narrow, typed functions cross into the page; ipcRenderer itself is never exposed.
const api: LifeUnlockedApi = {
  platform: process.platform,
  tasks: {
    list: () => ipcRenderer.invoke(IpcChannels.tasksList),
    create: (input) => ipcRenderer.invoke(IpcChannels.tasksCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IpcChannels.tasksUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IpcChannels.tasksDelete, id),
    complete: (id, occurrence) => ipcRenderer.invoke(IpcChannels.tasksComplete, id, occurrence ?? null),
    skipOccurrence: (id, date, skip) => ipcRenderer.invoke(IpcChannels.tasksSkipOccurrence, id, date, skip),
    undoCompletion: (eventId) => ipcRenderer.invoke(IpcChannels.tasksUndoCompletion, eventId),
    snapshot: () => ipcRenderer.invoke(IpcChannels.tasksSnapshot),
    onChanged: (listener) => subscribe<TaskSnapshot>(IpcChannels.tasksChanged, listener)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    update: (patch) => ipcRenderer.invoke(IpcChannels.settingsUpdate, patch),
    onChanged: (listener) => subscribe<Settings>(IpcChannels.settingsChanged, listener)
  },
  plans: {
    create: (input) => ipcRenderer.invoke(IpcChannels.plansCreate, input),
    remove: (id) => ipcRenderer.invoke(IpcChannels.plansDelete, id)
  },
  habits: {
    create: (input) => ipcRenderer.invoke(IpcChannels.habitsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IpcChannels.habitsUpdate, id, patch),
    setState: (id, action) => ipcRenderer.invoke(IpcChannels.habitsSetState, id, action),
    remove: (id) => ipcRenderer.invoke(IpcChannels.habitsDelete, id),
    checkIn: (id, date) => ipcRenderer.invoke(IpcChannels.habitsCheckIn, id, date),
    undoCheckin: (checkinId) => ipcRenderer.invoke(IpcChannels.habitsUndoCheckin, checkinId)
  },
  focus: {
    get: () => ipcRenderer.invoke(IpcChannels.focusGet),
    start: (phase, taskId) => ipcRenderer.invoke(IpcChannels.focusStart, phase, taskId),
    pause: (runId) => ipcRenderer.invoke(IpcChannels.focusPause, runId),
    resume: (runId) => ipcRenderer.invoke(IpcChannels.focusResume, runId),
    end: (runId) => ipcRenderer.invoke(IpcChannels.focusEnd, runId),
    reset: (runId) => ipcRenderer.invoke(IpcChannels.focusReset, runId),
    select: (selection) => ipcRenderer.invoke(IpcChannels.focusSelect, selection),
    setDurations: (durations) => ipcRenderer.invoke(IpcChannels.focusSetDurations, durations),
    setPlan: (input) => ipcRenderer.invoke(IpcChannels.focusSetPlan, input),
    startPlan: (input) => ipcRenderer.invoke(IpcChannels.focusStartPlan, input),
    onChanged: (listener) => subscribe<FocusSnapshot>(IpcChannels.focusChanged, listener)
  },
  app: {
    info: () => ipcRenderer.invoke(IpcChannels.appInfo),
    openDataDirectory: () => ipcRenderer.invoke(IpcChannels.appOpenDataDirectory),
    takeCommand: () => ipcRenderer.invoke(IpcChannels.appTakeCommand),
    onCommand: (listener) => subscribe<void>(IpcChannels.appCommand, () => listener()),
    shortcutStatus: () => ipcRenderer.invoke(IpcChannels.appShortcutStatus),
    suspendShortcut: (on) => ipcRenderer.invoke(IpcChannels.appSuspendShortcut, on),
    setShortcut: (accelerator) => ipcRenderer.invoke(IpcChannels.appSetShortcut, accelerator),
    onShortcutChanged: (listener) => subscribe<ShortcutStatus>(IpcChannels.appShortcutChanged, listener)
  },
  widget: {
    previewOpacity: (opacity) => ipcRenderer.invoke(IpcChannels.widgetPreviewOpacity, opacity)
  },
  window: {
    setModalOpen: (open) => ipcRenderer.invoke(IpcChannels.windowSetModalOpen, open)
  },
  auth: {
    status: () => ipcRenderer.invoke(IpcChannels.authStatus),
    requestCode: (email) => ipcRenderer.invoke(IpcChannels.authRequestCode, email),
    verifyCode: (code) => ipcRenderer.invoke(IpcChannels.authVerifyCode, code),
    cancel: () => ipcRenderer.invoke(IpcChannels.authCancel),
    signOut: () => ipcRenderer.invoke(IpcChannels.authSignOut)
  },
  achievements: {
    test: (themeId) => ipcRenderer.invoke(IpcChannels.achievementsTest, themeId),
    importAsset: (kind) => ipcRenderer.invoke(IpcChannels.assetsImport, kind)
  }
}

contextBridge.exposeInMainWorld('lifeUnlocked', api)
