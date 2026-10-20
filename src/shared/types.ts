import type { AchievementStyle, CustomTheme, NotificationPosition, ThemeId } from './themes'
import type { Appearance } from './appearance'
import type { RecurrenceRule, RecurrenceSegment } from './recurrence'
import type { WidgetAnimation, WidgetShape } from './widget'
import type { Plan } from './planner/types'
import type { Habit, HabitCheckin } from './habits/types'

export type TaskStatus = 'active' | 'completed'

/** Optional countdown. Reaching zero only shows "time's up"; it never completes the task. */
export interface TimerConfig {
  kind: 'countdown'
  durationSec: number
  /** ISO timestamp the countdown started from. */
  startedAt: string
}

export interface Task {
  id: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
  status: TaskStatus
  timerConfig: TimerConfig | null
  /** Theme used for this task's achievement instead of the global one; null follows the global theme. */
  themeOverride: ThemeId | null
  /**
   * Repeat rule, or null for a one-off task. A repeating task stays 'active' as a template;
   * each day it occurs on is completed on its own (see `src/shared/recurrence.ts`).
   */
  recurrence: RecurrenceRule | null
  /** Earlier rules of this series and the days they decided, oldest first. */
  recurrenceHistory: RecurrenceSegment[]
  /** Dates (YYYY-MM-DD) skipped with "Skip this time". */
  skippedOccurrences: string[]
  /** Deadline, or null. Never completes or fails the task; see `src/shared/deadline.ts`. */
  due: TaskDue | null
  /** Remind this many minutes before the deadline; null for no reminder. Needs `due`. */
  reminderMinutes: number | null
  /**
   * Only for a one-off plan node ("every hour for the next 4 hours"): it can be completed only
   * between these instants, and is missed once the window has closed (see `src/shared/timeWindow.ts`).
   * Null for every other task.
   */
  window: TaskWindow | null
}

/** Absolute instants (ISO, UTC); completable from `start` (inclusive) to `end` (exclusive). */
export interface TaskWindow {
  start: string
  end: string
}

export interface TaskDue {
  /** YYYY-MM-DD for a one-off task; null for a repeating task (each occurrence is due on its own date). */
  date: string | null
  /** HH:MM local time, or null for "by the end of the day". */
  time: string | null
}

export interface TaskInput {
  title: string
  description?: string
  /** Countdown length in seconds, or null/undefined for no countdown. */
  timerDurationSec?: number | null
  themeOverride?: ThemeId | null
  recurrence?: RecurrenceRule | null
  due?: TaskDue | null
  reminderMinutes?: number | null
}

export interface TaskPatch {
  title?: string
  description?: string
  timerDurationSec?: number | null
  /** Restart the countdown from now even if its length did not change. */
  restartTimer?: boolean
  themeOverride?: ThemeId | null
  /** A new rule applies from today on; earlier days keep the rule they had. */
  recurrence?: RecurrenceRule | null
  due?: TaskDue | null
  reminderMinutes?: number | null
}

export type CloseAction = 'tray' | 'quit'

export type LanguageSetting = 'system' | 'zh-CN' | 'en'
export type Locale = 'zh-CN' | 'en'

/**
 * Desktop task widget, kept apart from the main window's own options.
 * Its position is saved separately, like the main window's.
 */
export interface WidgetSettings {
  visible: boolean
  alwaysOnTop: boolean
  /** Whole-window opacity in percent, WIDGET_OPACITY_MIN–100, applied with the native window API. */
  opacity: number
  shape: WidgetShape
  /** Show/hide and small state-change motion. Independent of the achievement theme's animation. */
  animation: WidgetAnimation
  /** Light/dark for the widget only; never changed by the main window's appearance. */
  appearance: Appearance
}

/** Deadline reminders (Windows notifications), separate from achievement notifications. */
export interface ReminderSettings {
  enabled: boolean
  /** Offset filled in when a deadline is added to a task; null for none. */
  defaultMinutes: number | null
  /** Play the system notification sound. */
  sound: boolean
  /** HH:MM a date-only deadline's reminder is counted from, on the due day. */
  allDayTime: string
}

export interface Settings {
  language: LanguageSetting
  notificationDurationSec: number
  /** 0–100. 0 mutes the unlock sound. Applies to the built-in themes. */
  notificationVolume: number
  notificationPosition: NotificationPosition
  achievementTheme: ThemeId
  customTheme: CustomTheme
  /** What the main window's close button does: hide to the tray (default) or quit. */
  closeAction: CloseAction
  /** Light/dark for the main window. Separate from the widget's and from the achievement theme. */
  appearance: Appearance
  widget: WidgetSettings
  reminders: ReminderSettings
  /**
   * Global shortcut (Electron accelerator) that shows or hides the desktop widget; null turns it off.
   * Phase 6.7; an older version drops it and the default applies again.
   */
  widgetShortcut: string | null
}

export type SettingsPatch = Partial<Settings>

export interface AppInfo {
  version: string
  platform: string
  electronVersion: string
  systemLocale: Locale
  dataDirectory: string
}

/**
 * One completion of a task: the record an achievement is based on. Each has its own id, so the
 * same completion can never unlock twice, and undoing marks it instead of deleting anything.
 */
export interface CompletionEvent {
  id: string
  taskId: string
  /** Local date (YYYY-MM-DD) of the repeating-task occurrence it completes; null for a one-off task. */
  occurrence: string | null
  completedAt: string
  /** When it was undone. An undone completion is kept but no longer counts anywhere. */
  undoneAt: string | null
  /** Task title at the time, so the record reads the same if the task is renamed later. */
  title: string
}

/** Everything the pages need about tasks, sent as one piece so tasks and completions never disagree. */
export interface TaskSnapshot {
  tasks: Task[]
  completions: CompletionEvent[]
  /** Smart plans (Phase 6); their progress is derived from the tasks and completions above. */
  plans: Plan[]
  /** Habits (Phase 6.6) and their check-ins; kept apart from tasks, completions and plans. */
  habits: Habit[]
  habitCheckins: HabitCheckin[]
}

export interface CompleteTaskResult {
  task: Task
  /** False when the task was already completed, so no achievement fired. */
  unlocked: boolean
  /** The new completion when `unlocked`; otherwise null. */
  event: CompletionEvent | null
}

export interface UndoCompletionResult {
  /** The task after the undo, or null if it no longer exists. */
  task: Task | null
  /** False when the completion was already undone (or unknown), so nothing changed. */
  undone: boolean
}

export interface AchievementPayload {
  id: string
  heading: string
  /** The task's title; for a summary, the names of the achievements in the burst; for 'plan', the plan's title. */
  taskTitle: string
  /**
   * The end of `taskTitle` that must stay readable when the card shortens a long name: a timed plan
   * step's position (" · 第2/4次"). Absent for every other task.
   */
  titleSuffix?: string
  /** A short muted third line (habit 'claimed' card: "金色奖励已领取 · 本周不重复发放"). */
  detail?: string
  style: AchievementStyle
  /**
   * Absent: a single task completion (or a theme preview).
   * 'summary': the one notification that settles a burst of quick completions.
   * 'goal': a plan goal's achievement (also a habit's streak milestone). 'plan': a plan's "All
   * achievements!" (restrained gold frame). 'habit-record': a habit's new longest streak (flame).
   * 'habit-goal': a weekly habit's goal met this week (gold). 'habit-checkin': a plain habit check-in
   * (light: short, no particles, calm tone). 'habit-claimed': a goal met again after a cancel, its reward
   * already given this period (quiet, with `detail`). 'focus': a focus or break of the focus timer
   * ended (Phase 6.7; quiet like 'habit-claimed', never part of a burst).
   */
  variant?: AchievementVariant
}

export type AchievementVariant =
  | 'summary'
  | 'goal'
  | 'plan'
  | 'habit-goal'
  | 'habit-record'
  | 'habit-checkin'
  | 'habit-claimed'
  | 'focus'

export type AssetKind = 'icon' | 'sound'

export type ImportAssetResult =
  | { status: 'imported'; settings: Settings }
  | { status: 'cancelled' }
  | { status: 'rejected'; reason: 'too-large' | 'unsupported' }
