import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  HABIT_NAME_MAX_LENGTH,
  HABIT_NOTE_MAX_LENGTH,
  HABIT_TIMES_PER_WEEK_MAX,
  type Habit,
  type HabitFrequency
} from '../../../shared/habits/types'
import { weekdayName } from '../lib/recurrenceText'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { useAppStore, useT } from '../store/appStore'

const inputClass =
  'w-full rounded-lg bg-app px-3 py-2 text-sm text-fg ring-1 ring-line outline-none placeholder:text-muted/60 focus:ring-2 focus:ring-accent'
const invalidInputClass =
  'w-full rounded-lg bg-app px-3 py-2 text-sm text-fg ring-2 ring-danger outline-none placeholder:text-muted/60'

function sameFrequency(a: HabitFrequency, b: HabitFrequency): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Days of the week in the order the locale's calendar starts its week (Monday for Chinese). */
export function weekOrder(locale: string): number[] {
  return locale === 'zh-CN' ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]
}

/** Create a habit, or edit one (`habit` given): name, note and daily / N times a week / chosen days. */
export function HabitDialog({ habit, onClose }: { habit?: Habit; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const createHabit = useAppStore((s) => s.createHabit)
  const updateHabit = useAppStore((s) => s.updateHabit)
  const locale = useAppStore((s) => s.locale)
  const [name, setName] = useState(habit?.name ?? '')
  const [note, setNote] = useState(habit?.note ?? '')
  const [kind, setKind] = useState<HabitFrequency['kind']>(habit?.frequency.kind ?? 'daily')
  const [times, setTimes] = useState(habit?.frequency.kind === 'weekly' ? habit.frequency.timesPerWeek : 3)
  const [weekdays, setWeekdays] = useState<number[]>(habit?.frequency.kind === 'weekdays' ? habit.frequency.weekdays : [1, 3, 5])
  const [weekdaysError, setWeekdaysError] = useState(false)
  const [nameError, setNameError] = useState(false)
  const [saveError, setSaveError] = useState(false)
  // A ref, not state: two quick submits in the same tick must not both save.
  const saving = useRef(false)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => nameRef.current?.focus(), [])

  const frequency: HabitFrequency =
    kind === 'daily'
      ? { kind: 'daily' }
      : kind === 'weekly'
        ? { kind: 'weekly', timesPerWeek: times }
        : { kind: 'weekdays', weekdays: [...weekdays].sort((a, b) => a - b) }
  const frequencyChanged = !!habit && !sameFrequency(habit.frequency, frequency)

  const submit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault()
    if (saving.current) return
    if (!name.trim()) {
      setNameError(true)
      nameRef.current?.focus()
      return
    }
    if (kind === 'weekdays' && weekdays.length === 0) {
      setWeekdaysError(true)
      return
    }
    saving.current = true
    setBusy(true)
    setSaveError(false)
    try {
      const fields = { name: name.trim(), note: note.trim(), frequency }
      if (habit) await updateHabit(habit.id, fields)
      else await createHabit(fields)
      onClose()
    } catch (error) {
      console.error('[Habits] Save failed', error)
      setSaveError(true)
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t(habit ? 'habits.dialog.edit' : 'habits.dialog.new')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()} data-testid="habit-save">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4 pb-1" onSubmit={(e) => void submit(e)}>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">{t('habits.field.name')}</span>
          <input
            ref={nameRef}
            data-testid="habit-name"
            value={name}
            maxLength={HABIT_NAME_MAX_LENGTH}
            placeholder={t('habits.field.namePlaceholder')}
            aria-invalid={nameError || undefined}
            aria-describedby={nameError ? 'habit-name-error' : undefined}
            onChange={(e) => {
              setName(e.target.value)
              if (e.target.value.trim()) setNameError(false)
            }}
            className={nameError ? invalidInputClass : inputClass}
          />
          {nameError && (
            <span id="habit-name-error" className="text-xs text-danger-fg" data-testid="habit-name-error">
              {t('habits.error.name')}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">{t('habits.field.note')}</span>
          <textarea
            data-testid="habit-note"
            value={note}
            maxLength={HABIT_NOTE_MAX_LENGTH}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            className={`${inputClass} resize-none`}
          />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-xs text-muted">{t('habits.field.frequency')}</legend>
          <div className="flex gap-2" role="radiogroup">
            {(['daily', 'weekly', 'weekdays'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                data-testid={`habit-frequency-${k}`}
                onClick={() => setKind(k)}
                className={`h-9 flex-1 rounded-lg text-sm ring-1 transition-colors ${
                  kind === k ? 'bg-accent/15 font-medium text-fg ring-accent' : 'text-muted ring-line hover:bg-ink/5'
                }`}
              >
                {t(k === 'daily' ? 'habits.field.daily' : k === 'weekly' ? 'habits.field.weekly' : 'habits.field.custom')}
              </button>
            ))}
          </div>
          {kind === 'weekly' && (
            <label className="flex items-center justify-between gap-3 pt-1">
              <span className="text-sm">{t('habits.field.timesPerWeek')}</span>
              <input
                type="number"
                data-testid="habit-times"
                min={1}
                max={HABIT_TIMES_PER_WEEK_MAX}
                value={times}
                onChange={(e) =>
                  setTimes(Math.min(HABIT_TIMES_PER_WEEK_MAX, Math.max(1, Math.floor(Number(e.target.value) || 1))))
                }
                className={`${inputClass} w-20 text-center`}
              />
            </label>
          )}
          {kind === 'weekdays' && (
            <div className="flex flex-col gap-1.5 pt-1">
              <span className="text-xs text-muted">{t('habits.field.weekdays')}</span>
              <div className="flex gap-1.5" data-testid="habit-weekdays">
                {weekOrder(locale).map((day) => {
                  const on = weekdays.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      data-testid={`habit-weekday-${day}`}
                      onClick={() => {
                        setWeekdays((list) => (on ? list.filter((x) => x !== day) : [...list, day]))
                        setWeekdaysError(false)
                      }}
                      className={`h-8 flex-1 rounded-md text-xs ring-1 transition-colors ${
                        on ? 'bg-accent font-medium text-white ring-accent' : 'text-muted ring-line hover:bg-ink/5'
                      }`}
                    >
                      {weekdayName(day, locale)}
                    </button>
                  )
                })}
              </div>
              {weekdaysError && (
                <span className="text-xs text-danger-fg" data-testid="habit-weekdays-error">
                  {t('habits.error.weekdays')}
                </span>
              )}
            </div>
          )}
          {frequencyChanged && (
            <p className="text-xs text-muted" data-testid="habit-frequency-changed">
              {t('habits.field.frequencyChanged')}
            </p>
          )}
        </fieldset>
        {saveError && <p className="text-xs text-danger-fg">{t('habits.error.save')}</p>}
        {/* Enter in the name field submits. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
