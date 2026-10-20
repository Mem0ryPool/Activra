import { TIMER_MAX_SEC, TIMER_MIN_SEC } from './constants'
import type { TranslationKey } from './i18n'
import type { RecurrenceRule } from './recurrence'

/** The task dialog's values that can make it invalid. */
export interface TaskFormValues {
  title: string
  timerOn: boolean
  durationSec: number
  rule: RecurrenceRule | null
  /** Custom weekly repeat with no day chosen. */
  missingWeekdays: boolean
  dueOn: boolean
  dueDate: string
}

/** `field: 'title'` errors are shown at the name field; the others below the form. */
export type TaskFormError = { field: 'title' | 'form'; key: TranslationKey }

/** Same rule as the main process (`validateTitle`): blank or only spaces is not a name. */
export function isTitleBlank(title: string): boolean {
  return title.trim().length === 0
}

/** The first problem that blocks saving, checked in the order the fields appear, or null. */
export function validateTaskForm(v: TaskFormValues): TaskFormError | null {
  if (isTitleBlank(v.title)) return { field: 'title', key: 'dialog.error.titleRequired' }
  const repeating = v.rule !== null
  if (!repeating && v.timerOn && (v.durationSec < TIMER_MIN_SEC || v.durationSec > TIMER_MAX_SEC)) {
    return { field: 'form', key: 'dialog.error.timerRange' }
  }
  if (v.missingWeekdays) return { field: 'form', key: 'dialog.error.weekdays' }
  if (v.rule?.endDate && v.rule.endDate < v.rule.startDate) return { field: 'form', key: 'dialog.error.endBeforeStart' }
  if (v.dueOn && !repeating && !v.dueDate) return { field: 'form', key: 'dialog.error.dueDate' }
  return null
}
