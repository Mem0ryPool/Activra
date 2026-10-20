import type { ThemeId } from './themes'
import type { Plan, PlanInput } from './planner/types'
import type { Habit, HabitAction, HabitCheckinResult, HabitInput, HabitPatch, HabitUndoResult } from './habits/types'
import type { FocusDurations, FocusPhase, FocusSelection, FocusSnapshot, PlanFocusInput, PlanFocusStart } from './focus/types'
import type { ShortcutChange, ShortcutStatus } from './shortcut'
import type {
  AchievementPayload,
  AssetKind,
  ImportAssetResult,
  AppInfo,
  CompleteTaskResult,
  Settings,
  SettingsPatch,
  Task,
  TaskInput,
  TaskPatch,
  TaskSnapshot,
  UndoCompletionResult
} from './types'

/** Things the tray (or a clicked reminder) asks the main window to do once it is open. */
export type AppCommand = 'new-task' | 'settings' | { kind: 'focus-task'; taskId: string }

/** Every IPC channel lives here so main and preload cannot drift apart. */
export const IpcChannels = {
  tasksList: 'tasks:list',
  tasksCreate: 'tasks:create',
  tasksUpdate: 'tasks:update',
  tasksDelete: 'tasks:delete',
  tasksComplete: 'tasks:complete',
  tasksUndoCompletion: 'tasks:undo-completion',
  tasksSkipOccurrence: 'tasks:skip-occurrence',
  /** Smart plans: create from a confirmed preview, delete (the tasks stay). */
  plansCreate: 'plans:create',
  plansDelete: 'plans:delete',
  /** Habits (Phase 6.6); they arrive with every task snapshot. */
  habitsCreate: 'habits:create',
  habitsUpdate: 'habits:update',
  habitsSetState: 'habits:set-state',
  habitsDelete: 'habits:delete',
  habitsCheckIn: 'habits:check-in',
  habitsUndoCheckin: 'habits:undo-check-in',
  /** Focus timer (Phase 6.7): its own snapshot, kept apart from tasks. */
  focusGet: 'focus:get',
  focusStart: 'focus:start',
  focusPause: 'focus:pause',
  focusResume: 'focus:resume',
  focusEnd: 'focus:end',
  focusReset: 'focus:reset',
  focusSelect: 'focus:select',
  focusSetDurations: 'focus:set-durations',
  focusSetPlan: 'focus:set-plan',
  focusStartPlan: 'focus:start-plan',
  /** Main → every page: the new `FocusSnapshot` after any change of the timer. */
  focusChanged: 'focus:changed',
  tasksSnapshot: 'tasks:snapshot',
  /** Main → every page: the new `TaskSnapshot` after any change. */
  tasksChanged: 'tasks:changed',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',
  appInfo: 'app:info',
  appOpenDataDirectory: 'app:open-data-directory',
  achievementsTest: 'achievements:test',
  assetsImport: 'assets:import',
  notificationShow: 'notification:show',
  /** Notification window → main, once: its page listens for `notification:show` (nothing sent before is lost). */
  notificationReady: 'notification:ready',
  /** Main → notification window: the card was ended (time up or replaced elsewhere); drop it and stop its sound. */
  notificationClear: 'notification:clear',
  /** Main → main window: a tray action is waiting (see `app.takeCommand`). */
  appCommand: 'app:command',
  appTakeCommand: 'app:take-command',
  /** The widget's global shortcut (Phase 6.7): its status, a pause while recording, and main → pages on change. */
  appShortcutStatus: 'app:shortcut-status',
  appSuspendShortcut: 'app:suspend-shortcut',
  appSetShortcut: 'app:set-shortcut',
  appShortcutChanged: 'app:shortcut-changed',
  /** Main window → main: a modal dialog opened or closed (the title bar buttons are dimmed to match). */
  windowSetModalOpen: 'window:set-modal-open',
  widgetClose: 'widget:close',
  widgetPreviewOpacity: 'widget:preview-opacity',
  /** Main → widget: play the show transition (the window just became visible). */
  widgetEnter: 'widget:enter',
  /** Main → widget: play the hide transition; the window closes right after. */
  widgetExit: 'widget:exit',
  widgetOpenMain: 'widget:open-main'
} as const

/** API exposed to the main window as `window.lifeUnlocked`. */
export interface LifeUnlockedApi {
  platform: string
  tasks: {
    list(): Promise<Task[]>
    create(input: TaskInput): Promise<Task>
    update(id: string, patch: TaskPatch): Promise<Task>
    remove(id: string): Promise<void>
    /** `occurrence`: the date of the repeating-task occurrence shown on the page (today). */
    complete(id: string, occurrence?: string | null): Promise<CompleteTaskResult>
    /** "Skip this time" for one occurrence of a repeating task (`skip` false undoes it). */
    skipOccurrence(id: string, date: string, skip: boolean): Promise<Task>
    /** Undoes one completion by its id (from the Undo toast or "Restore to not completed"). */
    undoCompletion(eventId: string): Promise<UndoCompletionResult>
    /** Tasks plus completion records. */
    snapshot(): Promise<TaskSnapshot>
    onChanged(listener: (snapshot: TaskSnapshot) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
    onChanged(listener: (settings: Settings) => void): () => void
  }
  plans: {
    /** Creates the plan and its goals' tasks. Plans arrive with every task snapshot. */
    create(input: PlanInput): Promise<Plan>
    /** Deletes the plan and its achievements; its tasks are kept. */
    remove(id: string): Promise<void>
  }
  habits: {
    create(input: HabitInput): Promise<Habit>
    update(id: string, patch: HabitPatch): Promise<Habit>
    /** Pause, resume, archive or unarchive. */
    setState(id: string, action: HabitAction): Promise<Habit>
    /** Deletes the habit and its check-ins for good. */
    remove(id: string): Promise<void>
    /** `date`: the day the page showed (today); the main process decides whether it can be checked in. */
    checkIn(id: string, date: string): Promise<HabitCheckinResult>
    /** Cancels one check-in by its id (only today's). */
    undoCheckin(checkinId: string): Promise<HabitUndoResult>
  }
  /**
   * Focus timer (Phase 6.7). The main process owns it and counts time from timestamps; every call
   * answers with the new snapshot. Calls naming a run that is no longer current change nothing.
   */
  focus: {
    get(): Promise<FocusSnapshot>
    /** Starts `phase` (lengths from the saved durations); `taskId` null focuses without a task. */
    start(phase: FocusPhase, taskId: string | null): Promise<FocusSnapshot>
    pause(runId: string): Promise<FocusSnapshot>
    resume(runId: string): Promise<FocusSnapshot>
    /** Ends before the time is up (a focus of 1 minute or more is recorded as ended early). */
    end(runId: string): Promise<FocusSnapshot>
    /** Throws the run away, no record. */
    reset(runId: string): Promise<FocusSnapshot>
    /** Next phase or task while no run exists. */
    select(selection: FocusSelection): Promise<FocusSnapshot>
    setDurations(durations: FocusDurations): Promise<FocusSnapshot>
    setPlan(input: PlanFocusInput): Promise<FocusSnapshot>
    startPlan(input: PlanFocusStart): Promise<FocusSnapshot>
    onChanged(listener: (snapshot: FocusSnapshot) => void): () => void
  }
  app: {
    info(): Promise<AppInfo>
    openDataDirectory(): Promise<void>
    /** Returns and clears the action the tray asked the main window to perform, if any. */
    takeCommand(): Promise<AppCommand | null>
    onCommand(listener: () => void): () => void
    /** Whether the widget shortcut works, is off, or is taken by another program. */
    shortcutStatus(): Promise<ShortcutStatus>
    /** Releases the shortcut while Settings records a new one (true), then takes it back (false). */
    suspendShortcut(on: boolean): Promise<ShortcutStatus>
    /**
     * Changes the widget shortcut and saves it only if it could be registered. On 'conflict' nothing
     * changes: the previous shortcut keeps working.
     */
    setShortcut(accelerator: string): Promise<ShortcutChange>
    onShortcutChanged(listener: (status: ShortcutStatus) => void): () => void
  }
  widget: {
    /** Applies an opacity to the open widget while a slider is dragged, without saving it. */
    previewOpacity(opacity: number): Promise<void>
  }
  window: {
    /** Tells the main process whether a modal dialog is open, so it can dim the native title bar buttons. */
    setModalOpen(open: boolean): Promise<void>
  }
  achievements: {
    /** Shows a preview notification for a theme (the current one if omitted). No task is created. */
    test(themeId?: ThemeId): Promise<void>
    /** Opens a file picker in the main process and stores the chosen file for the Custom theme. */
    importAsset(kind: AssetKind): Promise<ImportAssetResult>
  }
}

/** API exposed to the achievement notification window as `window.achievement`. */
export interface AchievementApi {
  onShow(listener: (payload: AchievementPayload) => void): () => void
  onClear(listener: () => void): () => void
}

/** API exposed to the desktop task widget as `window.lifeUnlockedWidget`. Narrower than the main window's. */
export interface WidgetApi {
  platform: string
  tasks: Pick<LifeUnlockedApi['tasks'], 'list' | 'snapshot' | 'complete' | 'undoCompletion' | 'onChanged'>
  settings: Pick<LifeUnlockedApi['settings'], 'get' | 'onChanged'>
  app: Pick<LifeUnlockedApi['app'], 'info'>
  widget: {
    /** Hides the widget and remembers that choice; the app keeps running. */
    close(): Promise<void>
    /** Brings the main window to the front. */
    openMain(): Promise<void>
    onEnter(listener: () => void): () => void
    onExit(listener: () => void): () => void
  }
}
