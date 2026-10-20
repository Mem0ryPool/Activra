import { DEFAULT_CUSTOM_THEME } from './themes'
import { DEFAULT_WIDGET_SETTINGS } from './widget'
import type { ReminderSettings, Settings } from './types'
import { DEFAULT_WIDGET_SHORTCUT } from './shortcut'

export const TITLE_MAX_LENGTH = 120
export const DESCRIPTION_MAX_LENGTH = 1000
export const TIMER_MIN_SEC = 60
export const TIMER_MAX_SEC = 999 * 3600

export const NOTIFICATION_DURATION_MIN_SEC = 3
export const NOTIFICATION_DURATION_MAX_SEC = 15

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true,
  defaultMinutes: 15,
  sound: true,
  allDayTime: '09:00'
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'system',
  // 5 s for new users (Phase 6.7); a value saved earlier is kept as it is.
  notificationDurationSec: 5,
  notificationVolume: 70,
  notificationPosition: 'bottom-right',
  achievementTheme: 'legendary',
  customTheme: DEFAULT_CUSTOM_THEME,
  closeAction: 'tray',
  appearance: 'system',
  widget: DEFAULT_WIDGET_SETTINGS,
  reminders: DEFAULT_REMINDER_SETTINGS,
  widgetShortcut: DEFAULT_WIDGET_SHORTCUT
}

export const ICON_MAX_BYTES = 2 * 1024 * 1024
export const SOUND_MAX_BYTES = 5 * 1024 * 1024
