import { useEffect, useRef, useState, type FormEvent } from 'react'
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from '../../../shared/constants'
import { THEME_IDS, type ThemeId } from '../../../shared/themes'
import { dayKey } from '../../../shared/dates'
import { REMINDER_MAX_MINUTES, REMINDER_PRESETS_DATE_ONLY, REMINDER_PRESETS_TIMED } from '../../../shared/deadline'
import {
  normalizeRule,
  RECURRENCE_INTERVAL_MAX,
  type RecurrencePreset,
  type RecurrenceRule,
  type RecurrenceUnit
} from '../../../shared/recurrence'
import { splitDuration } from '../../../shared/timer'
import type { Task } from '../../../shared/types'
import { describeRule, weekdayName } from '../lib/recurrenceText'
import { formatWindow } from '../lib/windowText'
import { useNow } from '../hooks/useNow'
import { isTitleBlank, validateTaskForm } from '../../../shared/taskForm'
import { useAppStore, useT } from '../store/appStore'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Select } from './Select'

const inputClass =
  'w-full rounded-lg bg-app px-3 py-2 text-sm text-fg ring-1 ring-line outline-none placeholder:text-muted/60 focus:ring-2 focus:ring-accent'
const invalidInputClass =
  'w-full rounded-lg bg-app px-3 py-2 text-sm text-fg ring-2 ring-danger outline-none placeholder:text-muted/60'

function NumberField({
  label,
  value,
  max,
  onChange
}: {
  label: string
  value: number
  max: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.min(max, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
        className={inputClass}
      />
    </label>
  )
}

type RepeatChoice = 'none' | RecurrencePreset

interface RepeatState {
  choice: RepeatChoice
  interval: number
  unit: RecurrenceUnit
  weekdays: number[]
  startDate: string
  endsOn: boolean
  endDate: string
}

function initialRepeat(rule: RecurrenceRule | null, today: string): RepeatState {
  return {
    choice: rule ? rule.preset : 'none',
    interval: rule?.interval ?? 1,
    unit: rule?.unit ?? 'day',
    weekdays: rule?.weekdays.length ? rule.weekdays : [],
    startDate: rule?.startDate ?? today,
    endsOn: !!rule?.endDate,
    endDate: rule?.endDate ?? ''
  }
}

function toRule(r: RepeatState): RecurrenceRule | null {
  if (r.choice === 'none') return null
  // Normalized so the summary and the preview show exactly what will be saved (e.g. "Weekly" picked
  // after "Daily" must not keep the daily unit).
  return normalizeRule({
    preset: r.choice,
    unit: r.unit,
    interval: r.interval,
    weekdays: r.weekdays,
    startDate: r.startDate,
    endDate: r.endsOn && r.endDate ? r.endDate : null
  })
}

/** Monday first. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

function RepeatFields({
  value,
  editing,
  onChange
}: {
  value: RepeatState
  editing: boolean
  onChange: (next: RepeatState) => void
}): React.JSX.Element {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  const set = (patch: Partial<RepeatState>): void => onChange({ ...value, ...patch })
  const max = RECURRENCE_INTERVAL_MAX[value.unit]
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('dialog.field.repeat')}</span>
        <Select
          name="repeat"
          label={t('dialog.field.repeat')}
          size="sm"
          value={value.choice}
          onChange={(choice) => set({ choice })}
          options={(['none', 'daily', 'weekly', 'weekdays', 'custom'] as const).map((id) => ({
            value: id,
            label: t(`repeat.option.${id}`)
          }))}
        />
      </label>
      {value.choice === 'custom' && (
        <div className="flex flex-col gap-3 rounded-lg bg-app/60 p-3 ring-1 ring-line">
          <div className="flex items-end gap-2">
            <label className="flex w-24 flex-col gap-1">
              <span className="text-xs text-muted">{t('dialog.field.every')}</span>
              <input
                type="number"
                name="repeat-interval"
                min={1}
                max={max}
                value={value.interval}
                onChange={(e) => set({ interval: Math.min(max, Math.max(1, Math.floor(Number(e.target.value) || 1))) })}
                className={inputClass}
              />
            </label>
            <Select
              name="repeat-unit"
              label={t('dialog.field.every')}
              size="sm"
              className="w-28!"
              value={value.unit}
              onChange={(unit: RecurrenceUnit) =>
                set({ unit, interval: Math.min(value.interval, RECURRENCE_INTERVAL_MAX[unit]) })
              }
              options={[
                { value: 'day', label: t('repeat.unit.day') },
                { value: 'week', label: t('repeat.unit.week') }
              ]}
            />
          </div>
          {value.unit === 'week' && (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-xs text-muted">{t('dialog.field.onDays')}</legend>
              <div className="flex flex-wrap gap-1">
                {WEEK_ORDER.map((day) => {
                  const on = value.weekdays.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      data-testid="weekday-toggle"
                      onClick={() =>
                        set({ weekdays: on ? value.weekdays.filter((d) => d !== day) : [...value.weekdays, day] })
                      }
                      className={`h-8 min-w-10 rounded-md px-2 text-xs ring-1 transition-colors ${
                        on ? 'bg-accent text-white ring-accent' : 'text-muted ring-line hover:text-fg'
                      }`}
                    >
                      {weekdayName(day, locale)}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )}
        </div>
      )}
      {value.choice !== 'none' && (
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="text-xs text-muted">{t('dialog.field.startDate')}</span>
            <input
              type="date"
              name="repeat-start"
              value={value.startDate}
              onChange={(e) => e.target.value && set({ startDate: e.target.value })}
              className={inputClass}
            />
          </label>
          <div className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="text-xs text-muted">{t('dialog.field.ends')}</span>
            <div className="flex flex-col gap-2">
              <Select
                name="repeat-ends"
                label={t('dialog.field.ends')}
                size="sm"
                value={value.endsOn ? 'on' : 'never'}
                onChange={(v) => set({ endsOn: v === 'on', endDate: value.endDate || value.startDate })}
                options={[
                  { value: 'never', label: t('repeat.ends.never') },
                  { value: 'on', label: t('repeat.ends.on') }
                ]}
              />
              {value.endsOn && (
                <input
                  type="date"
                  name="repeat-end"
                  aria-label={t('repeat.ends.on')}
                  value={value.endDate}
                  min={value.startDate}
                  onChange={(e) => set({ endDate: e.target.value })}
                  className={inputClass}
                />
              )}
            </div>
          </div>
        </div>
      )}
      {value.choice !== 'none' && (
        <p className="text-xs text-muted">{t(editing ? 'dialog.repeat.editHint' : 'dialog.repeat.hint')}</p>
      )}
    </div>
  )
}

interface DueState {
  on: boolean
  date: string
  time: string
  /** Minutes before, or null for no reminder. */
  reminder: number | null
  /** The custom amount fields are shown (also for a value that is not one of the presets). */
  custom: boolean
}

type CustomUnit = 'minutes' | 'hours' | 'days'
const UNIT_MINUTES: Record<CustomUnit, number> = { minutes: 1, hours: 60, days: 1440 }

function splitCustom(minutes: number): { amount: number; unit: CustomUnit } {
  if (minutes > 0 && minutes % 1440 === 0) return { amount: minutes / 1440, unit: 'days' }
  if (minutes > 0 && minutes % 60 === 0) return { amount: minutes / 60, unit: 'hours' }
  return { amount: minutes, unit: 'minutes' }
}

function DueFields({
  value,
  repeating,
  onChange
}: {
  value: DueState
  repeating: boolean
  onChange: (next: DueState) => void
}): React.JSX.Element {
  const t = useT()
  const reminders = useAppStore((s) => s.settings.reminders)
  const set = (patch: Partial<DueState>): void => onChange({ ...value, ...patch })
  const dateOnly = !value.time
  const presets: readonly number[] = dateOnly ? REMINDER_PRESETS_DATE_ONLY : REMINDER_PRESETS_TIMED
  const custom = value.custom || (value.reminder !== null && !presets.includes(value.reminder))
  const selectValue = custom ? 'custom' : value.reminder === null ? 'none' : String(value.reminder)
  const label = (m: number): string =>
    dateOnly
      ? t(m === 0 ? 'reminder.onDay' : 'reminder.dayBefore', { time: reminders.allDayTime })
      : m === 0
        ? t('reminder.atTime')
        : m === 60
          ? t('reminder.hour')
          : m === 1440
            ? t('reminder.day')
            : t('reminder.minutes', { n: m })
  const parts = splitCustom(value.reminder ?? 15)

  return (
    <div className="flex flex-col gap-3">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="text-sm font-medium">{t('dialog.field.hasDue')}</span>
        <input
          type="checkbox"
          name="due"
          checked={value.on}
          onChange={(e) => set({ on: e.target.checked })}
          className="size-4 accent-accent"
        />
      </label>
      {value.on && (
        <>
          <div className="flex flex-wrap gap-3">
            {!repeating && (
              <label className="flex min-w-36 flex-1 flex-col gap-1">
                <span className="text-xs text-muted">{t('dialog.field.dueDate')}</span>
                <input
                  type="date"
                  name="due-date"
                  value={value.date}
                  onChange={(e) => set({ date: e.target.value })}
                  className={inputClass}
                />
              </label>
            )}
            <label className="flex min-w-36 flex-1 flex-col gap-1">
              <span className="text-xs text-muted">
                {t(repeating ? 'dialog.field.dueTimeRepeat' : 'dialog.field.dueTime')}
              </span>
              <input
                type="time"
                name="due-time"
                value={value.time}
                onChange={(e) => set({ time: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-44 flex-1 flex-col gap-1">
              <span className="text-xs text-muted">{t('dialog.field.reminder')}</span>
              <Select
                name="reminder"
                label={t('dialog.field.reminder')}
                size="sm"
                value={String(selectValue)}
                onChange={(v) => {
                  if (v === 'custom') set({ custom: true, reminder: value.reminder ?? 15 })
                  else set({ custom: false, reminder: v === 'none' ? null : Number(v) })
                }}
                options={[
                  { value: 'none', label: t('reminder.none') },
                  ...presets.map((m) => ({ value: String(m), label: label(m) })),
                  { value: 'custom', label: t('reminder.custom') }
                ]}
              />
            </label>
            {custom && (
              <>
                <input
                  type="number"
                  name="reminder-amount"
                  aria-label={t('reminder.custom')}
                  min={0}
                  value={parts.amount}
                  onChange={(e) => {
                    const amount = Math.max(0, Math.floor(Number(e.target.value) || 0))
                    set({ reminder: Math.min(REMINDER_MAX_MINUTES, amount * UNIT_MINUTES[parts.unit]) })
                  }}
                  className={`${inputClass} w-20`}
                />
                <Select
                  name="reminder-unit"
                  label={t('reminder.custom')}
                  size="sm"
                  className="w-32!"
                  value={parts.unit}
                  onChange={(unit: CustomUnit) =>
                    set({ reminder: Math.min(REMINDER_MAX_MINUTES, parts.amount * UNIT_MINUTES[unit]) })
                  }
                  options={(['minutes', 'hours', 'days'] as const).map((u) => ({ value: u, label: t(`reminder.unit.${u}`) }))}
                />
              </>
            )}
          </div>
          <p className="text-xs text-muted">
            {dateOnly ? t('dialog.due.dateOnlyHint', { time: reminders.allDayTime }) : t('dialog.due.hint')}
            {!reminders.enabled && value.reminder !== null && ` ${t('dialog.due.remindersOff')}`}
          </p>
        </>
      )}
    </div>
  )
}

/** Create or edit a task. `task` undefined means create. */
export function TaskDialog({ task, onClose }: { task?: Task; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const createTask = useAppStore((s) => s.createTask)
  const updateTask = useAppStore((s) => s.updateTask)

  const initial = task?.timerConfig ? splitDuration(task.timerConfig.durationSec) : { hours: 0, minutes: 30 }
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [timerOn, setTimerOn] = useState(!!task?.timerConfig)
  const [hours, setHours] = useState(initial.hours)
  const [minutes, setMinutes] = useState(initial.minutes)
  const [restartTimer, setRestartTimer] = useState(false)
  const [themeOverride, setThemeOverride] = useState<ThemeId | null>(task?.themeOverride ?? null)
  const globalTheme = useAppStore((s) => s.settings.achievementTheme)
  const locale = useAppStore((s) => s.locale)
  const [repeat, setRepeat] = useState<RepeatState>(() => initialRepeat(task?.recurrence ?? null, dayKey(new Date())))
  const repeating = repeat.choice !== 'none'
  const rule = toRule(repeat)
  const defaultReminder = useAppStore((s) => s.settings.reminders.defaultMinutes)
  const [due, setDue] = useState<DueState>(() => ({
    on: !!task?.due,
    date: task?.due?.date ?? dayKey(new Date()),
    time: task?.due?.time ?? '',
    reminder: task ? task.reminderMinutes : defaultReminder,
    custom: false
  }))
  // When the dialog opened; names "today"/"tomorrow" in a timed step's window.
  const openedAt = useNow(false)
  const [error, setError] = useState<string | null>(null)
  const [titleError, setTitleError] = useState(false)
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  // A form error appears below the fields, possibly under the fold: bring it into view.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  const showTitleError = (): void => {
    setTitleError(true)
    const input = titleRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    // The label row too, so the message next to it is visible.
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ;(input.closest('label') ?? input).scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' })
  }

  const submit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault()
    if (saving) return
    const durationSec = hours * 3600 + minutes * 60
    const invalid = validateTaskForm({
      title,
      timerOn,
      durationSec,
      rule,
      missingWeekdays: repeat.choice === 'custom' && repeat.unit === 'week' && repeat.weekdays.length === 0,
      dueOn: due.on,
      dueDate: due.date
    })
    if (invalid?.field === 'title') return showTitleError()
    if (invalid) return setError(t(invalid.key))
    const dueValue = due.on ? { date: repeating ? null : due.date, time: due.time || null } : null
    const reminderMinutes = due.on ? due.reminder : null
    const timerDurationSec = timerOn && !repeating ? durationSec : null
    setSaving(true)
    try {
      if (task) {
        await updateTask(task.id, {
          title,
          description,
          timerDurationSec,
          restartTimer,
          themeOverride,
          // A timed plan step keeps its window; nothing here may turn it into a repeat or a deadline.
          ...(task.window ? {} : { recurrence: rule, due: dueValue, reminderMinutes })
        })
      } else {
        await createTask({
          title,
          description,
          timerDurationSec,
          themeOverride,
          recurrence: rule,
          due: dueValue,
          reminderMinutes
        })
      }
      onClose()
    } catch {
      setError(t('dialog.error.saveFailed'))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={task ? t('dialog.edit.title') : t('dialog.create.title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={saving} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <label className="flex scroll-mt-2 flex-col gap-1.5">
          {/* The message sits on the label row, so showing it does not move anything. */}
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">{t('dialog.field.title')}</span>
            {titleError && (
              <span id="task-title-error" role="alert" data-testid="title-error" className="text-xs font-medium text-danger-fg">
                {t('dialog.error.titleRequired')}
              </span>
            )}
          </span>
          <input
            ref={titleRef}
            autoFocus
            name="title"
            value={title}
            maxLength={TITLE_MAX_LENGTH}
            placeholder={t('dialog.field.title.placeholder')}
            aria-invalid={titleError}
            aria-describedby={titleError ? 'task-title-error' : undefined}
            onChange={(e) => {
              setTitle(e.target.value)
              setError(null)
              if (!isTitleBlank(e.target.value)) setTitleError(false)
            }}
            className={titleError ? invalidInputClass : inputClass}
            // The global focus outline is unlayered CSS, so only an inline color can turn it red.
            style={titleError ? { outlineColor: 'var(--color-danger)' } : undefined}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('dialog.field.description')}</span>
          <textarea
            name="description"
            rows={3}
            value={description}
            maxLength={DESCRIPTION_MAX_LENGTH}
            placeholder={t('dialog.field.description.placeholder')}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputClass} resize-none`}
          />
        </label>

        <div className="rounded-lg bg-app/60 p-3 ring-1 ring-line">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm font-medium">{t('dialog.field.timer')}</span>
            <input
              type="checkbox"
              name="timer"
              disabled={repeating}
              checked={timerOn && !repeating}
              onChange={(e) => {
                setTimerOn(e.target.checked)
                setError(null)
              }}
              className="size-4 accent-accent"
            />
          </label>
          {timerOn && !repeating && (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex gap-3">
                <NumberField label={t('dialog.field.hours')} value={hours} max={999} onChange={setHours} />
                <NumberField label={t('dialog.field.minutes')} value={minutes} max={59} onChange={setMinutes} />
              </div>
              {task?.timerConfig && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={restartTimer}
                    onChange={(e) => setRestartTimer(e.target.checked)}
                    className="size-4 accent-accent"
                  />
                  {t('dialog.field.restartTimer')}
                </label>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            {t(repeating ? 'dialog.repeat.timerHint' : 'dialog.field.timer.hint')}
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('dialog.field.theme')}</span>
          <Select
            name="theme"
            label={t('dialog.field.theme')}
            size="sm"
            value={themeOverride ?? ''}
            onChange={(v) => setThemeOverride((v || null) as ThemeId | null)}
            options={[
              {
                value: '',
                label: t('dialog.field.theme.global', { name: t(`theme.${globalTheme}`) }),
                separatorAfter: true
              },
              ...THEME_IDS.map((id) => ({ value: id, label: t(`theme.${id}`) }))
            ]}
          />
        </label>

        {task?.window ? (
          // A timed plan step: its window is its rule, so repeat and deadline are not offered.
          <p data-testid="window-locked" className="rounded-lg bg-ink/[0.04] px-3 py-2.5 text-xs text-muted">
            {t('tasks.window.locked', { window: formatWindow(task.window, openedAt, t, locale) })}
          </p>
        ) : (
          <details
            data-testid="advanced-options"
            open={!!task?.recurrence || !!task?.due}
            className="group rounded-lg ring-1 ring-line [&_summary::-webkit-details-marker]:hidden"
          >
            <summary className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium select-none hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
              <span className="text-muted transition-transform group-open:rotate-90">›</span>
              {t('dialog.advanced')}
              {rule && (
                <span className="ml-auto truncate text-xs font-normal text-muted">{describeRule(rule, t, locale)}</span>
              )}
            </summary>
            <div className="flex flex-col gap-4 border-t border-line px-3 pt-3 pb-3">
              <RepeatFields
                value={repeat}
                editing={!!task?.recurrence}
                onChange={(next) => {
                  setRepeat(next)
                  setError(null)
                }}
              />
              <div className="border-t border-line pt-3">
                <DueFields
                  value={due}
                  repeating={repeating}
                  onChange={(next) => {
                    setDue(next)
                    setError(null)
                  }}
                />
              </div>
            </div>
          </details>
        )}

        {error && (
          <p ref={errorRef} role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
