import type { Translate } from '../i18n'
import type { FocusFinished } from './types'

/**
 * A finished run is announced only if its time was up at most this long ago. One that ran out long
 * before (the app was closed, or the PC slept for hours) is recorded silently; the Focus page lists it.
 */
export const FOCUS_CARD_LATE_MS = 10 * 60 * 1000

export interface FocusCardText {
  heading: string
  taskTitle: string
  /** Kept readable when a long task name is shortened (" · 25 分钟"). */
  titleSuffix?: string
}

export function focusCardText(finished: FocusFinished, t: Translate): FocusCardText {
  const { run } = finished
  if (run.phase !== 'focus') {
    return { heading: t('focus.notify.breakDone'), taskTitle: t('focus.notify.breakDoneBody') }
  }
  const minutes = Math.round(run.plannedSec / 60)
  if (!run.taskTitle) return { heading: t('focus.notify.focusDone'), taskTitle: t('focus.notify.minutes', { count: minutes }) }
  const suffix = t('focus.notify.minutesSuffix', { count: minutes })
  return { heading: t('focus.notify.focusDone'), taskTitle: run.taskTitle + suffix, titleSuffix: suffix }
}
