import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, globalShortcut, Menu, nativeTheme, Notification, powerMonitor, protocol, safeStorage, screen, shell } from 'electron'
import { resolveAppearance, type ResolvedAppearance } from '../shared/appearance'
import { ASSET_SCHEME, resolveAchievementStyle, type AchievementStyle } from '../shared/themes'
import { dayKey } from '../shared/dates'
import { createTranslator, matchLocale, resolveLocale } from '../shared/i18n'
import { IpcChannels, type AppCommand } from '../shared/ipc'
import { COMPACT_NAME_MAX, shortDisplayName, taskDisplayName } from '../shared/planner/displayName'
import { HABIT_CHECKIN_CARD_MS, habitCheckinSound, habitFeedbackCard } from '../shared/habits/feedback'
import { selectTodayTasks } from '../shared/taskOrder'
import { FOCUS_CARD_LATE_MS, focusCardText } from '../shared/focus/notify'
import type { FocusFinished } from '../shared/focus/types'
import type { AppInfo, CloseAction, Locale, Settings } from '../shared/types'
import { buildMacAppMenu } from './appMenu'
import { AssetStore } from './assets'
import { CompletionBurst, summaryText } from './completionBurst'
import { resolveUserDataDir } from './dataDirectory'
import { registerIpcHandlers } from './ipc/registerHandlers'
import { registerFocusHandlers } from './ipc/focusHandlers'
import { registerAuthHandlers } from './ipc/authHandlers'
import { AuthService } from './auth/authService'
import { AuthSessionStore } from './auth/sessionStore'
import { DevelopmentOtpProvider } from './auth/developmentOtpProvider'
import { FocusService } from './focus/focusService'
import { FocusStore } from './focus/focusStore'
import { registerShortcutHandlers } from './ipc/shortcutHandlers'
import { WidgetShortcut } from './widgetShortcut'
import { startFileLog } from './logger'
import { ReminderService, type ShownReminder } from './reminders'
import { DataStore, type StartupNotice } from './storage/dataStore'
import { readJson, writeJsonAtomic } from './storage/jsonFile'
import { TrayController } from './tray'
import { buildTrayMenu, type QuickCompleteItem, type TrayMenuItem } from './trayMenu'
import { buildWidgetMenu } from './widgetMenu'
import { applyWindowChrome, createMainWindow, keepMainWindowOnScreen } from './windows/mainWindow'
import { NotificationManager } from './windows/notificationWindow'
import { WidgetManager } from './windows/widgetWindow'
import appIconPng from './assets/app/icon.png?asset'

// Must run before anything touches userData (single-instance lock, log, data store, Chromium profile):
// the installed app keeps the pre-Activra folder name; an unpackaged development run (npm run dev,
// npm start, electron .) gets its own "Life Unlocked Dev" folder so it never reads, migrates or backs
// up the user's real data; automated tests and acceptance runs pass an isolated profile instead.
app.setPath('userData', resolveUserDataDir(app.getPath('appData'), process.env['LIFE_UNLOCKED_USER_DATA'], undefined, {
  packaged: app.isPackaged,
  useProduction: process.env['LIFE_UNLOCKED_USE_PRODUCTION_DATA'] === '1'
}))

// Lets the notification window play its sound without a prior click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// Windows groups taskbar entries and toasts by this id.
if (process.platform === 'win32') app.setAppUserModelId('app.lifeunlocked.desktop')

// Imported Custom-theme icons and sounds are served from the app's data folder through this scheme,
// so pages never receive file paths.
protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let mainWindow: BrowserWindow | null = null
let mainWindowOpening: Promise<void> | null = null
const notifications = new NotificationManager({
  // Tests only: simulates a notification window that takes a while to load (as on a busy Windows PC).
  readyDelayMs:
    process.env['LIFE_UNLOCKED_TEST_HOOKS'] === '1' ? Number(process.env['LIFE_UNLOCKED_NOTIFICATION_READY_DELAY_MS'] ?? 0) || 0 : 0
})
/** The round of quick completions being counted for a summary; created once settings are loaded. */
let burst: CompletionBurst | null = null
const tray = new TrayController(() => void openMainWindow())
/** True once a real quit has started (tray menu, app.quit, OS shutdown): windows then close for real. */
let quitting = false
/** Main window light/dark, resolved against the OS when set to 'system'. Replaced once settings are loaded. */
let mainAppearance = (): ResolvedAppearance => 'dark'
/** A modal dialog is open in the main window: its title bar buttons are dimmed to match the scrim. */
let mainModalOpen = false
let lastTitleBarColors: { color: string; symbolColor: string } | null = null
let closeAction = (): CloseAction => 'quit'
/** Called whenever the main window hides to the tray; explains where the app went, once. */
let onHiddenToTray = (): void => {}
/** A tray action the main window performs once it is open; the page fetches it with `app.takeCommand`. */
let pendingCommand: AppCommand | null = null
let reminders: ReminderService | null = null
/** Where the main process log is written (see logger.ts); shown when the app cannot start. */
let logFile = ''
/** A clicked deadline reminder opens the main window on that task. */
const onReminderClick = (taskId: string | null): void => {
  if (taskId) void runCommand({ kind: 'focus-task', taskId })
  else void openMainWindow()
}

// Test-only window into main-process state, never enabled in normal runs.
const testHooks =
  process.env['LIFE_UNLOCKED_TEST_HOOKS'] === '1'
    ? ((globalThis as unknown as { __lifeUnlockedTest: unknown }).__lifeUnlockedTest = {
        tray: () => tray.state,
        clickTray: () => tray.click(),
        clickTrayItem: (id: string) => tray.clickItem(id),
        hints: [] as { title: string; body: string }[],
        notifications: () => notifications.state,
        burst: () => burst?.current ?? [],
        reminders: [] as ShownReminder[],
        withdrawnReminders: [] as string[][],
        runReminders: () => reminders?.check(),
        clickReminder: (taskId: string | null) => onReminderClick(taskId),
        titleBar: () => ({ modalOpen: mainModalOpen, colors: lastTitleBarColors }),
        dataNotices: [] as { message: string; detail: string }[],
        widgetBounds: () => widgetForTests?.bounds ?? null,
        widgetMenu: () => widgetForTests?.menuState ?? { shown: 0, items: [] },
        clickWidgetMenuItem: (id: string) => widgetForTests?.clickMenuItem(id) ?? false,
        keepOnScreen: () => keepWindowsOnScreen(),
        runFocusCheck: () => focusForTests?.check(),
        widgetShortcut: () => shortcutForTests?.status ?? null,
        pressWidgetShortcut: () => pressWidgetShortcut(),
        focusFinished: [] as { runId: string; phase: string; carded: boolean }[]
      })
    : null

/** The widget's global shortcut (Phase 6.7); test hooks read it and press it. */
let shortcutForTests: WidgetShortcut | null = null
let pressWidgetShortcut = (): void => {}
/** Set once the focus timer runs; test hooks can run its tick at once. */
let focusForTests: FocusService | null = null
/** Set once the widget manager exists; test hooks read the widget's bounds through it. */
let widgetForTests: WidgetManager | null = null
/** Moves windows back onto a connected display after monitors were unplugged or rearranged. */
let keepWindowsOnScreen = (): void => {}

/** Repaints the main window's native chrome for the current appearance and dialog state. */
function applyMainChrome(): void {
  if (mainWindow && !mainWindow.isDestroyed()) lastTitleBarColors = applyWindowChrome(mainWindow, mainAppearance(), mainModalOpen)
}

async function openMainWindow(): Promise<void> {
  if (mainWindowOpening) return mainWindowOpening
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }
  mainWindowOpening = createMainWindow(app.getPath('userData'), mainAppearance())
    .then((window) => {
      mainWindow = window
      // A reload or crash drops the page's dialogs without telling us: undim the title bar.
      const resetModal = (): void => {
        if (!mainModalOpen) return
        mainModalOpen = false
        applyMainChrome()
      }
      window.webContents.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument) resetModal()
      })
      window.webContents.on('render-process-gone', resetModal)
      window.on('close', (event) => {
        // The close button hides to the tray unless the user chose to quit, or a quit is already under way.
        if (quitting || closeAction() !== 'tray' || !tray.state.exists) return
        event.preventDefault()
        window.hide()
        onHiddenToTray()
      })
      window.on('closed', () => {
        if (mainWindow === window) {
          mainWindow = null
          mainModalOpen = false
        }
        // "Quit the app" on close: the widget must not keep the process alive.
        if (!quitting) app.quit()
      })
    })
    .finally(() => {
      mainWindowOpening = null
    })
  return mainWindowOpening
}

async function runCommand(command: AppCommand): Promise<void> {
  pendingCommand = command
  await openMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcChannels.appCommand)
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  const store = new DataStore({ directory: userData })
  await store.load()
  // The focus timer keeps its own file (Phase 6.7); the data file above is not touched by it.
  const focus = new FocusStore({ directory: userData })
  await focus.load()
  // A quit waits (briefly) for changes still being written, so the last click is never lost.
  let flushedForQuit = false
  app.on('before-quit', (event) => {
    if (flushedForQuit) return
    flushedForQuit = true
    event.preventDefault()
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000))
    void Promise.race([Promise.all([store.flush(), focus.flush()]), timeout]).finally(() => app.quit())
  })

  const systemLocale: Locale = matchLocale(app.getPreferredSystemLanguages()[0] ?? app.getLocale())
  const getAppInfo = (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron,
    systemLocale,
    dataDirectory: userData
  })

  const assets = new AssetStore(path.join(userData, 'assets'))
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url)
    const resolved = url.hostname === 'asset' ? assets.resolve(url.pathname.slice(1)) : null
    if (!resolved) return new Response(null, { status: 404 })
    try {
      const data = await fs.readFile(resolved.filePath)
      return new Response(data, { headers: { 'content-type': resolved.mime } })
    } catch {
      return new Response(null, { status: 404 })
    }
  })

  let handlers: ReturnType<typeof registerIpcHandlers> | null = null
  /** The widget's right-click menu; set below, next to the tray menu it shares its actions with. */
  let widgetMenu = (): TrayMenuItem[] => []
  const widget = new WidgetManager({
    userDataDir: userData,
    onClosedByUser: () => {
      void handlers
        ?.updateSettings({ widget: { ...store.getSettings().widget, visible: false } })
        .catch((error) => console.error('[Widget] Could not save visibility', error))
    },
    contextMenu: () => widgetMenu()
  })
  app.on('before-quit', () => widget.prepareQuit())
  widgetForTests = widget
  keepWindowsOnScreen = () => {
    widget.keepOnScreen()
    if (mainWindow && !mainWindow.isDestroyed()) keepMainWindowOnScreen(mainWindow)
  }
  // Unplugging a monitor, changing resolution or scaling can leave a window where it cannot be reached.
  for (const event of ['display-removed', 'display-added', 'display-metrics-changed'] as const) {
    screen.on(event as 'display-removed', () => keepWindowsOnScreen())
  }
  mainAppearance = () => resolveAppearance(store.getSettings().appearance, nativeTheme.shouldUseDarkColors)
  nativeTheme.on('updated', applyMainChrome)
  const applyWidget = (settings: Settings): void => {
    widget.apply(settings.widget).catch((error) => console.error('[Widget] Could not update window', error))
  }

  // Each completion shows its own achievement at once (replacing the one on screen). When the
  // completions stop for a moment, a round of two or more is settled with one summary.
  // Tests may stretch the idle time so slow steps (clicking Undo) land inside one round.
  const testIdleMs = testHooks ? Number(process.env['LIFE_UNLOCKED_BURST_IDLE_MS']) : NaN
  burst = new CompletionBurst((entries) => {
    const settings = store.getSettings()
    const locale = resolveLocale(settings.language, systemLocale)
    const { heading, names } = summaryText(entries, createTranslator(locale), locale === 'zh-CN' ? '、' : ', ')
    notifications.enqueue({
      kind: 'summary',
      payload: {
        id: `summary-${randomUUID()}`,
        heading,
        taskTitle: names,
        style: resolveAchievementStyle(settings.achievementTheme, settings, settings.customTheme),
        variant: 'summary'
      }
    })
  }, Number.isFinite(testIdleMs) && testIdleMs > 0 ? testIdleMs : undefined)

  /**
   * The habit card last sent to the screen (Phase 6.6.2). Habit feedback is "latest wins" across the
   * card and the window's light message: a newer plain check-in or a cancel ends this card at once
   * (only this one; a task's achievement card on screen is never ended by a habit).
   */
  let habitCard: string | null = null
  const translate = (): ReturnType<typeof createTranslator> =>
    createTranslator(resolveLocale(store.getSettings().language, systemLocale))
  handlers = registerIpcHandlers({
    store,
    assets,
    getAppInfo,
    showAchievement: (kind, taskTitle, themeId, id, plan, titleSuffix) => {
      const settings = store.getSettings()
      const t = createTranslator(resolveLocale(settings.language, systemLocale))
      const payloadId = id ?? randomUUID()
      const title = taskTitle ?? t('themes.testTaskTitle')
      notifications.enqueue({
        kind,
        payload: {
          id: payloadId,
          heading: plan?.heading ?? (plan?.variant === 'goal' ? t('plan.notify.goal') : t('achievement.unlocked')),
          taskTitle: title,
          ...(titleSuffix ? { titleSuffix } : {}),
          style: resolveAchievementStyle(themeId, settings, settings.customTheme),
          ...(plan ? { variant: plan.variant } : {})
        }
      })
      // Only task completions make up a burst; a plan achievement shows like one but is not a completion.
      if (kind === 'achievement' && !plan) burst?.add({ eventId: payloadId, name: title })
    },
    showHabitFeedback: (habit, feedback, checkin) => {
      // Every successful check-in gets one card in the notification corner; the newest replaces the one on
      // screen. Reaching a goal again after a cancel is 'claimed' (decided from the stored records): a
      // quiet card, never a second celebration.
      const card = habitFeedbackCard(habit.name, feedback, translate())
      habitCard = checkin.id
      const settings = store.getSettings()
      const theme = resolveAchievementStyle(settings.achievementTheme, settings, settings.customTheme)
      // A habit card stays below a real unlock: at most the light particles of the theme. The plain and
      // the "already given" cards are quieter still: a slight pop, no particles, the calm tone; the plain
      // one is short, the "already given" one stays as long as the notification setting says.
      const quiet = { ...theme, ...habitCheckinSound(theme), animation: 'pop' as const, particles: 'none' as const }
      const style: AchievementStyle =
        card.variant === 'habit-checkin'
          ? { ...quiet, durationMs: HABIT_CHECKIN_CARD_MS }
          : card.variant === 'habit-claimed'
            ? quiet
            : { ...theme, particles: theme.particles === 'heavy' ? 'light' : theme.particles }
      notifications.enqueue({
        kind: 'achievement',
        payload: {
          id: checkin.id,
          heading: card.heading,
          taskTitle: card.taskTitle,
          ...(card.titleSuffix ? { titleSuffix: card.titleSuffix } : {}),
          ...(card.detail ? { detail: card.detail } : {}),
          style,
          variant: card.variant
        }
      })
      return feedback
    },
    displayName: (task) => taskDisplayName(task, store.listPlans(), translate()),
    cancelAchievement: (id) => {
      notifications.cancel(id)
      // A cancelled habit check-in takes its card off the screen with it (and its sound).
      if (id === habitCard) {
        notifications.dismiss(id)
        habitCard = null
      }
      burst?.remove(id)
    },
    onTasksChanged: () => {
      reminders?.schedule()
      for (const listener of tasksListeners) listener()
    },
    onSettingsChanged: (settings) => {
      applyWidget(settings)
      applyMainChrome()
      reminders?.schedule()
      for (const listener of settingsListeners) listener()
    },
    openMainWindow: () => void openMainWindow(),
    previewWidgetOpacity: (opacity) => widget.previewOpacity(opacity),
    setModalOpen: (sender, open) => {
      if (!mainWindow || mainWindow.isDestroyed() || sender !== mainWindow.webContents) return
      if (mainModalOpen === open) return
      mainModalOpen = open
      applyMainChrome()
    },
    takeAppCommand: () => {
      const command = pendingCommand
      pendingCommand = null
      return command
    }
  })

  // Focus timer (Phase 6.7): runs in the main process, so it goes on with every window closed. When a
  // run's time is up it is recorded once and announced with the quiet card in the notification corner
  // (same window, scheduler, theme and volume as achievements; never a burst, never a task completion).
  const showFocusCard = (finished: FocusFinished): void => {
    const late = Date.now() - Date.parse(finished.endedAt) > FOCUS_CARD_LATE_MS
    testHooks?.focusFinished.push({ runId: finished.run.id, phase: finished.run.phase, carded: !late })
    if (late) return
    const settings = store.getSettings()
    const theme = resolveAchievementStyle(settings.achievementTheme, settings, settings.customTheme)
    const text = focusCardText(finished, translate())
    notifications.enqueue({
      kind: 'achievement',
      payload: {
        id: `focus-${finished.run.id}`,
        heading: text.heading,
        taskTitle: text.taskTitle,
        ...(text.titleSuffix ? { titleSuffix: text.titleSuffix } : {}),
        // Calm: the soft tone at the user's volume (silent when muted), a slight pop, no particles.
        style: { ...theme, ...habitCheckinSound(theme), animation: 'pop', particles: 'none' },
        variant: 'focus'
      }
    })
  }
  let focusChanged = (): void => {}
  const focusService = new FocusService({
    store: focus,
    onChanged: () => focusChanged(),
    onFinished: showFocusCard
  })
  focusForTests = focusService
  focusChanged = registerFocusHandlers({
    plans: () => store.listPlans(),
    tasks: () => store.listTasks(),
    completions: () => store.listCompletions(),
    focus,
    service: focusService,
    findTask: (id) => store.listTasks().find((task) => task.id === id),
    taskName: (task) => taskDisplayName(task, store.listPlans(), translate()).full
  }).changed
  powerMonitor.on('suspend', () => focusService.noteSuspend())
  powerMonitor.on('resume', () => void focusService.noteResume())
  powerMonitor.on('unlock-screen', () => void focusService.noteResume())
  app.on('before-quit', () => focusService.stop())

  // Optional sign-in (Phase 5C). Nothing here runs at startup: the session file is read when the
  // Settings page asks. Hosted Supabase is not configured yet, so installed builds are guest-only; a
  // development run gets the local mock (no email is sent). A failure never blocks the app.
  let devOtp: DevelopmentOtpProvider | null = null
  if (!app.isPackaged) {
    try {
      devOtp = new DevelopmentOtpProvider()
    } catch {
      devOtp = null
    }
  }
  registerAuthHandlers({
    auth: new AuthService({
      mode: devOtp ? 'development-mock' : 'unavailable',
      provider: devOtp,
      sessions: new AuthSessionStore(userData, safeStorage),
      takeDevelopmentCode: () => devOtp?.delivery.takeAll().at(-1)?.token
    }),
    isMainWindow: (sender) => !!mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents
  })

  closeAction = () => store.getSettings().closeAction
  const setWidget = (patch: Partial<Settings['widget']>): void => {
    void handlers
      ?.updateSettings({ widget: { ...store.getSettings().widget, ...patch } })
      .catch((error) => console.error('[Tray] Could not update the widget', error))
  }
  // Global shortcut that shows or hides the widget (Phase 6.7): the same change as the tray's
  // "Show desktop widget", so visibility, always-on-top and appearance behave exactly as before. One
  // accelerator is held at a time; a conflict is reported in Settings and never stops startup.
  pressWidgetShortcut = () => setWidget({ visible: !store.getSettings().widget.visible })
  let shortcutChanged = (): void => {}
  const shortcut = new WidgetShortcut(
    {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: (accelerator) => globalShortcut.unregister(accelerator)
    },
    () => pressWidgetShortcut(),
    () => shortcutChanged()
  )
  shortcutForTests = shortcut
  shortcutChanged = registerShortcutHandlers(shortcut, (accelerator) => {
    if (!handlers) throw new Error('Settings are not ready')
    return handlers.updateSettings({ widgetShortcut: accelerator })
  }).changed
  settingsListeners.push(() => shortcut.apply(store.getSettings().widgetShortcut))
  app.on('will-quit', () => shortcut.dispose())

  /** Today's tasks still to do, in the order the Today list shows them. */
  const todayToDo = (): QuickCompleteItem[] => {
    const { tasks, completions, plans } = store.snapshot()
    const t = translate()
    // The same name as the task list ("喝水 · 第2/4次"), shortened for the menu; the step stays visible.
    return selectTodayTasks(tasks, completions, Date.now())
      .items.filter((item) => !item.done)
      .map((item) => ({
        taskId: item.task.id,
        occurrence: item.occurrence,
        title: shortDisplayName(taskDisplayName(item.task, plans, t), COMPACT_NAME_MAX)
      }))
  }
  // What the submenu shows: the day, and which tasks are to do (a timed plan step joins when its
  // window opens and leaves when it closes, with no other change).
  const menuKey = (): string => `${dayKey(new Date())}|${todayToDo().map((i) => `${i.taskId}@${i.occurrence ?? ''}`).join(',')}`
  let shownMenuKey = menuKey()
  // "Quick complete task" from the tray or the widget's right-click menu: the same path as the main
  // window and the widget list. A stale entry (task deleted, day changed, window closed) is refused by
  // the store and only refreshes the tray menu (the widget's menu is built again on every right click).
  const quickComplete = (taskId: string, occurrence: string | null): void => {
    void handlers
      ?.completeTask(taskId, occurrence)
      .then((result) => {
        if (!result.unlocked) refreshTrayMenu()
      })
      .catch((error) => {
        console.warn('[QuickComplete] Could not complete task', error)
        refreshTrayMenu()
      })
  }
  widgetMenu = () =>
    buildWidgetMenu(translate(), { openMain: () => void openMainWindow(), completeTask: quickComplete }, todayToDo())
  const refreshTrayMenu = (): void => {
    shownMenuKey = menuKey()
    tray.setMenu(
      buildTrayMenu(
        store.getSettings(),
        translate(),
        {
          openMain: () => void openMainWindow(),
          setWidgetVisible: (visible) => setWidget({ visible }),
          setWidgetAlwaysOnTop: (alwaysOnTop) => setWidget({ alwaysOnTop }),
          quickAddTask: () => void runCommand('new-task'),
          completeTask: quickComplete,
          openSettings: () => void runCommand('settings'),
          quit: () => app.quit()
        },
        todayToDo()
      )
    )
  }
  settingsListeners.push(refreshTrayMenu)
  tasksListeners.push(refreshTrayMenu)

  // macOS: the menu bar at the top of the screen (Edit shortcuts, ⌘, Settings, ⌘Q); rebuilt when the language changes.
  if (process.platform === 'darwin') {
    let menuLocale = ''
    const refreshAppMenu = (): void => {
      const locale = resolveLocale(store.getSettings().language, systemLocale)
      if (locale === menuLocale) return
      menuLocale = locale
      Menu.setApplicationMenu(
        Menu.buildFromTemplate(buildMacAppMenu(translate(), { openSettings: () => void runCommand('settings') }, !app.isPackaged))
      )
    }
    refreshAppMenu()
    settingsListeners.push(refreshAppMenu)
    // The installed app takes its Dock icon from the bundle; a development run would show Electron's.
    if (!app.isPackaged) app.dock?.setIcon(appIconPng)
  }
  // The submenu lists today's tasks: rebuild it when the date changes (also after sleep) or a timed
  // step's window opens or closes.
  const dayCheck = setInterval(() => {
    if (menuKey() !== shownMenuKey) refreshTrayMenu()
  }, 15_000)
  app.on('before-quit', () => clearInterval(dayCheck))

  // The tray explains itself the first time the window hides; remembered in its own small file.
  const trayStateFile = path.join(userData, 'tray-state.json')
  let hintShown = await readJson(trayStateFile).then(
    (r) => r.kind === 'ok' && (r.value as { closeHintShown?: unknown })?.closeHintShown === true
  )
  onHiddenToTray = () => {
    if (hintShown) return
    hintShown = true
    const t = translate()
    const title = t('tray.hint.title')
    const body = t(process.platform === 'darwin' ? 'tray.hint.bodyMac' : 'tray.hint.body')
    testHooks?.hints.push({ title, body })
    if (!tray.showHint(title, body) && Notification.isSupported()) new Notification({ title, body }).show()
    void writeJsonAtomic(trayStateFile, { closeHintShown: true }).catch((error) =>
      console.error('[Tray] Could not save hint state', error)
    )
  }

  reminders = new ReminderService({
    userDataDir: userData,
    getTasks: () => store.snapshot(),
    getSettings: () => store.getSettings(),
    getLocale: () => resolveLocale(store.getSettings().language, systemLocale),
    onClick: onReminderClick,
    onShown: (reminder) => testHooks?.reminders.push(reminder),
    onWithdrawn: (keys) => testHooks?.withdrawnReminders.push(keys)
  })
  app.on('before-quit', () => reminders?.stop())

  await openMainWindow()
  notifications.prepare()
  const notice = store.startupNotice
  if (notice) showDataNotice(notice, translate(), userData)
  void reminders.start().catch((error) => console.error('[Reminders] Could not start', error))
  // After the notification window is prepared: a run that ran out while the app was closed is recorded now.
  void focusService.start()
  shortcut.apply(store.getSettings().widgetShortcut)
  tray.create(translate()('app.name'))
  refreshTrayMenu()
  applyWidget(store.getSettings())
}

/** Tells the user, once at startup, that the data file had to be recovered or comes from a newer version. */
function showDataNotice(notice: StartupNotice, t: ReturnType<typeof createTranslator>, userData: string): void {
  const message =
    notice.kind === 'recovered'
      ? t('data.notice.recovered')
      : notice.kind === 'unrecoverable'
        ? t('data.notice.unrecoverable')
        : t('data.notice.newer', { version: notice.version })
  const detail =
    notice.kind === 'recovered'
      ? t('data.notice.recoveredDetail', { quarantined: notice.quarantined, restoredFrom: notice.restoredFrom })
      : notice.kind === 'unrecoverable'
        ? t('data.notice.unrecoverableDetail', { quarantined: notice.quarantined })
        : t('data.notice.newerDetail', { backup: notice.backup ?? '-' })
  if (testHooks) {
    testHooks.dataNotices.push({ message, detail })
    return
  }
  const options: Electron.MessageBoxOptions = {
    type: notice.kind === 'newer-version' ? 'info' : 'warning',
    title: t('data.notice.title'),
    message,
    detail,
    buttons: [t('data.notice.ok'), t('data.notice.openFolder')],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const shown = mainWindow && !mainWindow.isDestroyed() ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options)
  void shown.then(({ response }) => {
    if (response === 1) void shell.openPath(userData)
  })
}

/** Extra reactions to settings changes that are set up after the IPC handlers. */
const settingsListeners: (() => void)[] = []
/** Extra reactions to task and completion changes that are set up after the IPC handlers. */
const tasksListeners: (() => void)[] = []

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  logFile = startFileLog(app.getPath('userData'))
  console.info(`[App] Activra ${app.getVersion()} (Electron ${process.versions.electron}, ${process.platform})`)
  // A second launch (e.g. from the Start menu while hidden in the tray) brings back the one window.
  app.on('second-instance', () => void openMainWindow())
  // macOS: clicking the Dock icon brings the window back (it may be hidden in the menu bar, or closed).
  app.on('activate', () => void openMainWindow())

  app.on('before-quit', () => {
    quitting = true
    // Every completion is already saved; only the pending summary is dropped.
    burst?.destroy()
    notifications.destroy()
  })
  app.on('will-quit', () => tray.destroy())

  // Only reached when no window is left at all (hidden windows still count as open).
  app.on('window-all-closed', () => app.quit())

  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      console.error('[App] Failed to start', error)
      // Never disappear without a word: say why, and that the data was left alone.
      const systemLocale = matchLocale(app.getPreferredSystemLanguages()[0] ?? app.getLocale())
      const t = createTranslator(systemLocale)
      if (!testHooks) {
        dialog.showErrorBox(
          t('data.startFailed.title'),
          t('data.startFailed.body', { log: logFile, error: error instanceof Error ? error.message : String(error) })
        )
      }
      app.quit()
    })
}
