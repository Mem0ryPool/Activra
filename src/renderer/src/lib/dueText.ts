import { dayKey } from '../../../shared/dates'
import { dueDateOf, overdueFrom, splitOverdue } from '../../../shared/deadline'
import type { Translate } from '../../../shared/i18n'
import { addDays } from '../../../shared/recurrence'
import type { Locale, Task } from '../../../shared/types'
import { formatDateKey } from './recurrenceText'

export interface DueLabel {
  text: string
  overdue: boolean
}

/** "Due today 18:00", "Due tomorrow", "Overdue 2 h". Overdue is a marker, never "failed". */
export function dueLabel(
  task: Task,
  occurrence: string | null,
  now: number,
  t: Translate,
  locale: Locale
): DueLabel | null {
  const date = dueDateOf(task, occurrence)
  const from = overdueFrom(task, occurrence)
  if (!date || from === null || !task.due) return null
  if (now >= from) {
    const { days, hours, minutes } = splitOverdue(now - from)
    const span =
      days > 0
        ? t('due.span.days', { n: days })
        : hours > 0
          ? t('due.span.hours', { n: hours })
          : t('due.span.minutes', { n: minutes })
    return { text: t('due.overdue', { span }), overdue: true }
  }
  const today = dayKey(new Date(now))
  const day =
    date === today ? t('due.today') : date === addDays(today, 1) ? t('due.tomorrow') : formatDateKey(date, locale)
  return { text: t('due.badge', { when: task.due.time ? `${day} ${task.due.time}` : day }), overdue: false }
}
