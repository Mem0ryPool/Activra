import { create } from 'zustand'
import { createTranslator, resolveLocale, type Translate } from '../../../shared/i18n'
import type {
  AppInfo,
  CompletionEvent,
  Locale,
  Settings,
  SettingsPatch,
  Task,
  TaskInput,
  TaskPatch,
  TaskSnapshot
} from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/constants'
import type { CustomTheme } from '../../../shared/themes'
import type { Plan, PlanInput } from '../../../shared/planner/types'
import type { Habit, HabitAction, HabitCheckin, HabitInput, HabitPatch } from '../../../shared/habits/types'
import type { FocusDurations, FocusPhase, FocusSelection, FocusSnapshot, PlanFocusInput, PlanFocusStart } from '../../../shared/focus/types'
import { undoToastFor } from '../lib/undoToast'
import { LatestNotice } from '../lib/latestNotice'

export type PageId = 'tasks' | 'plans' | 'habits' | 'focus' | 'calendar' | 'achievements' | 'themes' | 'statistics' | 'settings'

/** What the focus buttons ask the main process to do with the current run. */
export type FocusRunAction = 'pause' | 'resume' | 'end' | 'reset'

interface AppState {
  ready: boolean
  page: PageId
  tasks: Task[]
  completions: CompletionEvent[]
  /** Smart plans; their progress is computed from `tasks` and `completions` (src/shared/planner/progress.ts). */
  plans: Plan[]
  /** Set by "Smart plan" on the Tasks page: the Plans page opens the plan wizard while true. */
  planWizardRequested: boolean
  /** Habits (Phase 6.6) and their check-ins, from the same snapshot as the tasks. */
  habits: Habit[]
  habitCheckins: HabitCheckin[]
  /** Habit ids with a check-in request in flight, so a double click cannot send twice. */
  checkingIn: Record<string, true>
  habitNotice: HabitNotice | null
  /** The focus timer (Phase 6.7), owned by the main process; null until loaded. */
  focus: FocusSnapshot | null
  /** The Statistics page's tab, kept while moving between pages. */
  statsTab: 'overview' | 'weekly'
  /** The full-window focus view is shown. Leaving it never stops the timer. */
  focusMode: boolean
  /** A focus request is in flight, so a double click cannot send twice. */
  focusBusy: boolean
  settings: Settings
  appInfo: AppInfo | null
  locale: Locale
  t: Translate
  /** Task ids with a completion request in flight, so a double click cannot send twice. */
  completing: Record<string, true>
  /** Set by the tray's "Quick add task"; the Tasks page opens its create dialog while true. */
  newTaskRequested: boolean
  /** Completions made in this window that can still be undone from the toast, oldest first. */
  undoToasts: UndoToastItem[]
  /** Set by a clicked deadline reminder: the Tasks page scrolls to this task and highlights it. */
  focusTaskId: string | null

  init(): Promise<void>
  setPage(page: PageId): void
  setNewTaskRequested(requested: boolean): void
  setPlanWizardRequested(requested: boolean): void
  createPlan(input: PlanInput): Promise<Plan>
  deletePlan(id: string): Promise<void>
  clearFocusTask(): void
  /** Opens the Tasks page on one task (scrolled to and highlighted). */
  openTask(taskId: string): void
  createHabit(input: HabitInput): Promise<void>
  updateHabit(id: string, patch: HabitPatch): Promise<void>
  setHabitState(id: string, action: HabitAction): Promise<void>
  deleteHabit(id: string): Promise<void>
  /** `date`: the day the page shows (today). */
  checkInHabit(id: string, date: string): Promise<void>
  undoHabitCheckin(checkinId: string): Promise<void>
  /** Shows the light habit message for HABIT_NOTICE_MS (a newer one replaces it). */
  showHabitNotice(kind: HabitNotice['kind'], habitName: string): void
  startFocus(phase: FocusPhase, taskId: string | null): Promise<void>
  savePlanFocus(input: PlanFocusInput): Promise<void>
  launchPlanFocus(input: PlanFocusStart): Promise<void>
  focusRun(action: FocusRunAction, runId: string): Promise<void>
  selectFocus(selection: FocusSelection): Promise<void>
  setFocusDurations(durations: FocusDurations): Promise<void>
  setFocusMode(open: boolean): void
  setStatsTab(tab: 'overview' | 'weekly'): void
  createTask(input: TaskInput): Promise<void>
  updateTask(id: string, patch: TaskPatch): Promise<void>
  deleteTask(id: string): Promise<void>
  /** `occurrence`: today's date for a repeating task. */
  completeTask(id: string, occurrence?: string | null): Promise<void>
  skipOccurrence(id: string, date: string, skip: boolean): Promise<void>
  undoCompletion(eventId: string): Promise<void>
  dismissUndoToast(eventId: string): void
  updateSettings(patch: SettingsPatch): Promise<void>
  updateCustomTheme(patch: Partial<CustomTheme>): Promise<void>
}

export interface UndoToastItem {
  eventId: string
  /** The task's display name ("喝水 · 第2/4次"), as on the card that was completed. */
  title: string
  /** The end of `title` kept visible when it is shortened; empty for a plain task. */
  suffix?: string
  /** When the toast appeared (Date.now()); it disappears UNDO_WINDOW_MS later. */
  shownAt: number
}

const api = (): Window['lifeUnlocked'] => window.lifeUnlocked

/** The plan being saved right now, so an identical request in the meantime does not create a copy. */
let pendingPlan: { key: string; promise: Promise<Plan> } | null = null

const fromSnapshot = (
  snapshot: TaskSnapshot
): Pick<AppState, 'tasks' | 'completions' | 'plans' | 'habits' | 'habitCheckins'> => ({
  tasks: snapshot.tasks,
  completions: snapshot.completions,
  plans: snapshot.plans,
  habits: snapshot.habits,
  habitCheckins: snapshot.habitCheckins
})

/**
 * The window's message after a cancelled habit check-in, or when a check-in failed (a successful
 * check-in is answered by a card in the notification corner since Phase 6.6.2b). One at a time: a newer one replaces it. It comes only from the
 * answer to a request made in this window, never from a snapshot, so nothing is replayed on reload.
 */
export interface HabitNotice {
  id: number
  kind: 'undone' | 'error'
  habitName: string
}
export const HABIT_NOTICE_MS = 2000
// Newest wins: a newer message, or a card for a newer check-in, replaces the one on screen (Phase 6.6.2).
const habitNotices = new LatestNotice<Omit<HabitNotice, 'id'>>(
  (habitNotice) => useAppStore.setState({ habitNotice }),
  HABIT_NOTICE_MS
)

const replaceHabit = (habits: Habit[], habit: Habit): Habit[] =>
  habits.some((h) => h.id === habit.id) ? habits.map((h) => (h.id === habit.id ? habit : h)) : [...habits, habit]

function localeState(settings: Settings, info: AppInfo | null): Pick<AppState, 'locale' | 't'> {
  const locale = resolveLocale(settings.language, info?.systemLocale ?? 'en')
  document.documentElement.lang = locale
  return { locale, t: createTranslator(locale) }
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  page: 'tasks',
  tasks: [],
  completions: [],
  plans: [],
  planWizardRequested: false,
  habits: [],
  habitCheckins: [],
  checkingIn: {},
  habitNotice: null,
  focus: null,
  focusMode: false,
  statsTab: 'overview',
  focusBusy: false,
  settings: DEFAULT_SETTINGS,
  appInfo: null,
  locale: 'en',
  t: createTranslator('en'),
  completing: {},
  newTaskRequested: false,
  undoToasts: [],
  focusTaskId: null,

  async init() {
    const [snapshot, settings, appInfo, focus] = await Promise.all([
      api().tasks.snapshot(),
      api().settings.get(),
      api().app.info(),
      api().focus.get()
    ])
    set({ ...fromSnapshot(snapshot), settings, appInfo, focus, ready: true, ...localeState(settings, appInfo) })
    api().focus.onChanged((next) => set({ focus: next }))
    api().tasks.onChanged((next) => set(fromSnapshot(next)))
    api().settings.onChanged((next) => set({ settings: next, ...localeState(next, get().appInfo) }))
    // Tray actions: one may already be waiting if the tray opened this window.
    const runCommand = async (): Promise<void> => {
      const command = await api().app.takeCommand()
      // A tray action or a clicked reminder leaves focus mode (the timer keeps running).
      if (command === 'new-task') set({ page: 'tasks', newTaskRequested: true, focusMode: false })
      else if (command === 'settings') set({ page: 'settings', focusMode: false })
      else if (command?.kind === 'focus-task') set({ page: 'tasks', focusTaskId: command.taskId, focusMode: false })
    }
    api().app.onCommand(() => void runCommand())
    await runCommand()
  },

  setPage(page) {
    set({ page })
  },

  setNewTaskRequested(requested) {
    set({ newTaskRequested: requested })
  },

  setPlanWizardRequested(requested) {
    set({ planWizardRequested: requested })
  },

  createPlan(input) {
    // The same plan sent again while the first request is still saving (a double click, Enter pressed
    // twice) gets that request's result instead of creating a second copy.
    const key = JSON.stringify(input)
    if (pendingPlan?.key === key) return pendingPlan.promise
    const promise = (async () => {
      const plan = await api().plans.create(input)
      // The broadcast snapshot brings the plan and its tasks; this keeps the page from waiting on it.
      set(fromSnapshot(await api().tasks.snapshot()))
      return plan
    })().finally(() => {
      if (pendingPlan?.promise === promise) pendingPlan = null
    })
    pendingPlan = { key, promise }
    return promise
  },

  async deletePlan(id) {
    await api().plans.remove(id)
    set((s) => ({ plans: s.plans.filter((p) => p.id !== id) }))
  },

  clearFocusTask() {
    set({ focusTaskId: null })
  },

  openTask(taskId) {
    set({ page: 'tasks', focusTaskId: taskId })
  },

  async createHabit(input) {
    const habit = await api().habits.create(input)
    set((s) => ({ habits: replaceHabit(s.habits, habit) }))
  },

  async updateHabit(id, patch) {
    const habit = await api().habits.update(id, patch)
    set((s) => ({ habits: replaceHabit(s.habits, habit) }))
  },

  async setHabitState(id, action) {
    const habit = await api().habits.setState(id, action)
    set((s) => ({ habits: replaceHabit(s.habits, habit) }))
  },

  async deleteHabit(id) {
    await api().habits.remove(id)
    set((s) => ({
      habits: s.habits.filter((h) => h.id !== id),
      habitCheckins: s.habitCheckins.filter((c) => c.habitId !== id)
    }))
  },

  showHabitNotice(kind, habitName) {
    habitNotices.show({ kind, habitName })
  },

  async checkInHabit(id, date) {
    if (get().checkingIn[id]) return
    set((s) => ({ checkingIn: { ...s.checkingIn, [id]: true } }))
    const habitName = get().habits.find((h) => h.id === id)?.name ?? ''
    const request = habitNotices.begin()
    try {
      const { checkin, feedback } = await api().habits.checkIn(id, date)
      // Every recorded check-in is answered by one card in the notification corner (light, flame, gold
      // or milestone; shown and sounded by the notification window). It replaces a cancel or error
      // message still in this window, unless a newer request was answered already.
      if (checkin && feedback && !habitNotices.isStale(request)) {
        habitNotices.settle(request)
        habitNotices.clear()
      }
      // The broadcast snapshot brings the same record; adding it here keeps the button from waiting on it.
      if (checkin) {
        set((s) => ({
          habitCheckins: s.habitCheckins.some((c) => c.id === checkin.id) ? s.habitCheckins : [...s.habitCheckins, checkin]
        }))
      }
    } catch (error) {
      // A failed check-in never shows success: no card, no tone, the save error here.
      if (!habitNotices.isStale(request)) {
        habitNotices.settle(request)
        get().showHabitNotice('error', habitName)
      }
      throw error
    } finally {
      set((s) => {
        const checkingIn = { ...s.checkingIn }
        delete checkingIn[id]
        return { checkingIn }
      })
    }
  },

  async undoHabitCheckin(checkinId) {
    let result
    try {
      result = await api().habits.undoCheckin(checkinId)
    } catch (error) {
      get().showHabitNotice('error', '')
      throw error
    }
    if (!result.undone) return
    // Cancelling is not a success: main ends that check-in's card (and its sound); the window says so.
    habitNotices.settle(habitNotices.begin())
    get().showHabitNotice('undone', result.habit?.name ?? '')
    const now = new Date().toISOString()
    set((s) => ({
      habitCheckins: s.habitCheckins.map((c) => (c.id === checkinId && !c.undoneAt ? { ...c, undoneAt: now } : c))
    }))
  },

  async startFocus(phase, taskId) {
    await focusRequest(() => api().focus.start(phase, taskId))
  },

  async savePlanFocus(input) {
    await focusRequest(() => api().focus.setPlan(input))
  },

  async launchPlanFocus(input) {
    if (get().focusBusy) return
    await focusRequest(() => api().focus.startPlan(input))
    set({ page: 'focus', focusMode: false })
  },

  async focusRun(action, runId) {
    await focusRequest(() => api().focus[action](runId))
  },

  async selectFocus(selection) {
    await focusRequest(() => api().focus.select(selection))
  },

  async setFocusDurations(durations) {
    await focusRequest(() => api().focus.setDurations(durations))
  },

  setFocusMode(open) {
    set({ focusMode: open })
  },

  setStatsTab(statsTab) {
    set({ statsTab })
  },

  async createTask(input) {
    const task = await api().tasks.create(input)
    set((s) => ({ tasks: s.tasks.some((t) => t.id === task.id) ? s.tasks : [...s.tasks, task] }))
  },

  async updateTask(id, patch) {
    const task = await api().tasks.update(id, patch)
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }))
  },

  async deleteTask(id) {
    await api().tasks.remove(id)
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      completions: s.completions.filter((e) => e.taskId !== id),
      undoToasts: s.undoToasts.filter((x) => s.completions.some((e) => e.id === x.eventId && e.taskId !== id))
    }))
  },

  async completeTask(id, occurrence = null) {
    if (get().completing[id]) return
    set((s) => ({ completing: { ...s.completing, [id]: true } }))
    try {
      const { task, event } = await api().tasks.complete(id, occurrence)
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === id ? task : t)),
        completions: event && !s.completions.some((e) => e.id === event.id) ? [...s.completions, event] : s.completions,
        undoToasts: event
          ? [...s.undoToasts, undoToastFor(event.id, { ...task, title: event.title }, s.plans, s.t)]
          : s.undoToasts
      }))
    } finally {
      set((s) => {
        const completing = { ...s.completing }
        delete completing[id]
        return { completing }
      })
    }
  },

  async skipOccurrence(id, date, skip) {
    const task = await api().tasks.skipOccurrence(id, date, skip)
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }))
  },

  async undoCompletion(eventId) {
    get().dismissUndoToast(eventId)
    const { task } = await api().tasks.undoCompletion(eventId)
    // The broadcast brings the same change; applying it here keeps this window from waiting on it.
    const now = new Date().toISOString()
    set((s) => ({
      tasks: task ? s.tasks.map((t) => (t.id === task.id ? task : t)) : s.tasks,
      completions: s.completions.map((e) => (e.id === eventId && !e.undoneAt ? { ...e, undoneAt: now } : e))
    }))
  },

  dismissUndoToast(eventId) {
    set((s) => ({ undoToasts: s.undoToasts.filter((x) => x.eventId !== eventId) }))
  },

  async updateSettings(patch) {
    // Apply locally first, so a second quick change (e.g. color, then animation) merges onto this one
    // instead of onto the old values; the saved settings from the main process replace it below.
    set((s) => ({ settings: { ...s.settings, ...patch } }))
    try {
      const settings = await api().settings.update(patch)
      set({ settings, ...localeState(settings, get().appInfo) })
    } catch (error) {
      set({ settings: await api().settings.get() })
      throw error
    }
  },

  async updateCustomTheme(patch) {
    await get().updateSettings({ customTheme: { ...get().settings.customTheme, ...patch } })
  }
}))

export const useT = (): Translate => useAppStore((s) => s.t)

/** One focus request at a time; its answer (the new snapshot) replaces the page's copy. */
async function focusRequest(send: () => Promise<FocusSnapshot>): Promise<void> {
  if (useAppStore.getState().focusBusy) return
  useAppStore.setState({ focusBusy: true })
  try {
    useAppStore.setState({ focus: await send() })
  } finally {
    useAppStore.setState({ focusBusy: false })
  }
}
