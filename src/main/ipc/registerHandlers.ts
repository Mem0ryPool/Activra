import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { IpcChannels, type AppCommand } from '../../shared/ipc'
import { THEME_IDS, type ThemeId } from '../../shared/themes'
import type {
  AppInfo,
  AssetKind,
  CompleteTaskResult,
  ImportAssetResult,
  Settings,
  SettingsPatch,
  Task
} from '../../shared/types'
import {
  ValidationError,
  validateBoolean,
  validateDateKey,
  validateId,
  validateSettingsPatch,
  validateTaskInput,
  validateTaskPatch,
  validateWidgetOpacity
} from '../../shared/validation'
import { IMPORT_FILTERS, type AssetStore } from '../assets'
import { isTrustedUrl } from '../paths'
import type { NotificationKind } from '../windows/notificationScheduler'
import type { DataStore } from '../storage/dataStore'
import { validatePlanInput } from '../../shared/planner/validation'
import type { TaskDisplayName } from '../../shared/planner/displayName'
import { validateHabitAction, validateHabitInput, validateHabitPatch } from '../../shared/habits/validation'
import type { HabitFeedback } from '../../shared/habits/feedback'
import type { Habit, HabitCheckin } from '../../shared/habits/types'

export interface HandlerDeps {
  store: DataStore
  assets: AssetStore
  getAppInfo: () => AppInfo
  /**
   * `preview` comes from the Themes page and never interrupts a real achievement.
   * `id` is the completion's id for a real achievement, so it can be shown only once and withdrawn.
   */
  showAchievement: (
    kind: NotificationKind,
    taskTitle: string | null,
    themeId: ThemeId,
    id?: string,
    /** Set for a plan achievement: it is shown like a real one but is not a completion, so it never joins a burst. */
    plan?: { variant: 'goal' | 'plan'; heading: string | null },
    /** The part of `taskTitle` that must stay readable when the card shortens it (" · 第2/4次"). */
    titleSuffix?: string
  ) => void
  /** The name a task is shown with everywhere ("喝水 · 第2/4次" for a timed plan step); display only. */
  displayName: (task: Task) => TaskDisplayName
  /**
   * A completion was undone (or a plan achievement withdrawn): it never shows again and leaves the
   * current burst; one already on screen finishes.
   */
  cancelAchievement: (id: string) => void
  /**
   * Answers a habit check-in (Phase 6.6.1): a weekly goal, a new record or a milestone shows one card
   * on the achievement card (never part of a completion burst), unless that card was shown already;
   * returns the feedback actually given ('checkin' = the window shows its light message). The card's
   * id is the check-in's id, so cancelling the check-in withdraws a card still on screen.
   */
  showHabitFeedback: (habit: Habit, feedback: HabitFeedback, checkin: HabitCheckin) => HabitFeedback
  /** Runs after tasks or completions changed and were broadcast (e.g. to re-plan reminders). */
  onTasksChanged: () => void
  /** Runs after settings were saved and broadcast to every page, e.g. to show or hide the widget. */
  onSettingsChanged: (settings: Settings) => void
  openMainWindow: () => void
  previewWidgetOpacity: (opacity: number) => void
  /** A modal dialog opened or closed in the page `sender` (ignored unless it is the main window). */
  setModalOpen: (sender: WebContents, open: boolean) => void
  takeAppCommand: () => AppCommand | null
}

export interface RegisteredHandlers {
  /** Saves an already validated patch the same way a page would, so every window hears about it. */
  updateSettings: (patch: SettingsPatch) => Promise<Settings>
  /** Completes a task exactly as a page would (used by the tray's "Quick complete task"). */
  completeTask: (id: string, occurrence: string | null) => Promise<CompleteTaskResult>
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedUrl(event.senderFrame?.url)) throw new Error('Untrusted IPC sender')
}

/** Registers a handler that rejects calls from anything but our own pages. */
export function handle<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertTrustedSender(event)
    return handler(event, ...(args as Args))
  })
}

export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && isTrustedUrl(window.webContents.getURL())) {
      window.webContents.send(channel, payload)
    }
  }
}

function validateThemeArg(value: unknown): ThemeId | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !(THEME_IDS as readonly string[]).includes(value)) {
    throw new ValidationError('Unknown theme')
  }
  return value as ThemeId
}

function validateAssetKind(value: unknown): AssetKind {
  if (value !== 'icon' && value !== 'sound') throw new ValidationError('Unknown asset kind')
  return value
}

export function registerIpcHandlers({
  store,
  assets,
  getAppInfo,
  showAchievement,
  showHabitFeedback,
  displayName,
  cancelAchievement,
  onTasksChanged,
  onSettingsChanged,
  openMainWindow,
  previewWidgetOpacity,
  setModalOpen,
  takeAppCommand
}: HandlerDeps): RegisteredHandlers {
  const tasksChanged = (): void => {
    broadcast(IpcChannels.tasksChanged, store.snapshot())
    onTasksChanged()
  }
  /**
   * Plan achievements follow the change that caused them (after the task's own achievement): newly
   * unlocked ones are shown, withdrawn ones are dropped if still waiting. The rules decide, never the text.
   */
  const announcePlanEvents = (): void => {
    const { unlocked, revoked } = store.takePlanEvents()
    for (const id of revoked) cancelAchievement(id)
    const theme = store.getSettings().achievementTheme
    for (const event of unlocked) {
      if (event.kind === 'goal') showAchievement('achievement', event.name, theme, event.unlockId, { variant: 'goal', heading: null })
      else showAchievement('achievement', event.planTitle, theme, event.unlockId, { variant: 'plan', heading: event.name })
    }
  }
  const settingsChanged = (settings: Settings): void => {
    broadcast(IpcChannels.settingsChanged, settings)
    onSettingsChanged(settings)
  }
  const updateSettings = async (patch: SettingsPatch): Promise<Settings> => {
    const settings = await store.updateSettings(patch)
    settingsChanged(settings)
    return settings
  }
  const themeFor = (task: Task): ThemeId => task.themeOverride ?? store.getSettings().achievementTheme
  // One path for every window and the tray: the record is saved first, then its achievement is shown,
  // then the plan achievements it unlocked (newest on screen, so a plan's "All achievements!" ends up there).
  const completeTask = async (id: string, occurrence: string | null): Promise<CompleteTaskResult> => {
    const result = await store.completeTask(id, occurrence)
    if (result.unlocked && result.event) {
      tasksChanged()
      // Same name as the task lists, widget, tray and undo toast; the record keeps the stored title.
      const name = displayName(result.task)
      showAchievement('achievement', name.full, themeFor(result.task), result.event.id, undefined, name.suffix || undefined)
      announcePlanEvents()
    }
    return result
  }

  handle(IpcChannels.tasksList, () => store.listTasks())

  handle(IpcChannels.tasksSnapshot, () => store.snapshot())

  handle(IpcChannels.tasksCreate, async (_e, input: unknown) => {
    const task = await store.createTask(validateTaskInput(input))
    tasksChanged()
    return task
  })

  handle(IpcChannels.tasksUpdate, async (_e, id: unknown, patch: unknown) => {
    const task = await store.updateTask(validateId(id), validateTaskPatch(patch))
    tasksChanged()
    announcePlanEvents()
    return task
  })

  handle(IpcChannels.tasksDelete, async (_e, id: unknown) => {
    await store.deleteTask(validateId(id))
    tasksChanged()
    announcePlanEvents()
  })

  handle(IpcChannels.tasksComplete, async (_e, id: unknown, occurrence: unknown) => {
    const date = occurrence === undefined || occurrence === null ? null : validateDateKey(occurrence, 'occurrence')
    return completeTask(validateId(id), date)
  })

  handle(IpcChannels.tasksUndoCompletion, async (_e, eventId: unknown) => {
    const id = validateId(eventId)
    // Withdraw a queued achievement first, so it cannot reach the screen while the undo is saved.
    cancelAchievement(id)
    const result = await store.undoCompletion(id)
    if (result.undone) {
      tasksChanged()
      announcePlanEvents()
    }
    return result
  })

  handle(IpcChannels.tasksSkipOccurrence, async (_e, id: unknown, date: unknown, skip: unknown) => {
    if (typeof skip !== 'boolean') throw new ValidationError('skip must be a boolean')
    const task = await store.skipOccurrence(validateId(id), validateDateKey(date), skip)
    tasksChanged()
    announcePlanEvents()
    return task
  })

  handle(IpcChannels.plansCreate, async (_e, input: unknown) => {
    const plan = await store.createPlan(validatePlanInput(input))
    tasksChanged()
    announcePlanEvents()
    return plan
  })

  handle(IpcChannels.plansDelete, async (_e, id: unknown) => {
    const withdrawn = await store.deletePlan(validateId(id))
    for (const unlockId of withdrawn) cancelAchievement(unlockId)
    tasksChanged()
  })

  handle(IpcChannels.habitsCreate, async (_e, input: unknown) => {
    const habit = await store.createHabit(validateHabitInput(input))
    tasksChanged()
    return habit
  })

  handle(IpcChannels.habitsUpdate, async (_e, id: unknown, patch: unknown) => {
    const habit = await store.updateHabit(validateId(id), validateHabitPatch(patch))
    tasksChanged()
    return habit
  })

  handle(IpcChannels.habitsSetState, async (_e, id: unknown, action: unknown) => {
    const habit = await store.setHabitState(validateId(id), validateHabitAction(action))
    tasksChanged()
    return habit
  })

  handle(IpcChannels.habitsDelete, async (_e, id: unknown) => {
    const removed = await store.deleteHabit(validateId(id))
    for (const checkinId of removed) cancelAchievement(checkinId)
    tasksChanged()
  })

  // Habit check-ins are not task completions: no task achievement, no burst, no statistics. Only a
  // weekly goal, a new record or a milestone shows a card; anything else gets the window's light message.
  handle(IpcChannels.habitsCheckIn, async (_e, id: unknown, date: unknown) => {
    const day = date === undefined || date === null ? null : validateDateKey(date, 'date')
    const result = await store.checkInHabit(validateId(id), day)
    if (!result.checkedIn || !result.checkin || !result.feedback) return result
    tasksChanged()
    return { ...result, feedback: showHabitFeedback(result.habit, result.feedback, result.checkin) }
  })

  handle(IpcChannels.habitsUndoCheckin, async (_e, checkinId: unknown) => {
    const id = validateId(checkinId)
    cancelAchievement(id)
    const result = await store.undoHabitCheckin(id)
    if (result.undone) tasksChanged()
    return result
  })

  handle(IpcChannels.settingsGet, () => store.getSettings())

  handle(IpcChannels.settingsUpdate, (_e, patch: unknown) => updateSettings(validateSettingsPatch(patch)))

  handle(IpcChannels.achievementsTest, (_e, themeId: unknown) => {
    showAchievement('preview', null, validateThemeArg(themeId) ?? store.getSettings().achievementTheme)
  })

  handle(IpcChannels.assetsImport, async (event, kindArg: unknown): Promise<ImportAssetResult> => {
    const kind = validateAssetKind(kindArg)
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openFile' as const], filters: [IMPORT_FILTERS[kind]] }
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    const sourcePath = picked.filePaths[0]
    if (picked.canceled || !sourcePath) return { status: 'cancelled' }

    const outcome = await assets.import(kind, sourcePath)
    if (!outcome.ok) return { status: 'rejected', reason: outcome.reason }

    const custom = store.getSettings().customTheme
    const previous = kind === 'icon' ? custom.iconAssetId : custom.soundAssetId
    const next =
      kind === 'icon'
        ? { ...custom, icon: 'imported' as const, iconAssetId: outcome.assetId }
        : { ...custom, sound: 'imported' as const, soundAssetId: outcome.assetId }
    const settings = await store.updateSettings(validateSettingsPatch({ customTheme: next }))
    await assets.remove(previous).catch((error) => console.warn('[Assets] Could not remove old asset', error))
    settingsChanged(settings)
    return { status: 'imported', settings }
  })

  handle(IpcChannels.appInfo, () => getAppInfo())

  handle(IpcChannels.appOpenDataDirectory, async () => {
    // The path is decided here in the main process, never by the renderer.
    await shell.openPath(getAppInfo().dataDirectory)
  })

  handle(IpcChannels.widgetClose, async () => {
    await updateSettings({ widget: { ...store.getSettings().widget, visible: false } })
  })

  handle(IpcChannels.widgetOpenMain, () => openMainWindow())

  handle(IpcChannels.appTakeCommand, () => takeAppCommand())

  handle(IpcChannels.widgetPreviewOpacity, (_e, opacity: unknown) => previewWidgetOpacity(validateWidgetOpacity(opacity)))
  handle(IpcChannels.windowSetModalOpen, (event, open: unknown) =>
    setModalOpen(event.sender, validateBoolean(open, 'open'))
  )

  return { updateSettings, completeTask }
}
