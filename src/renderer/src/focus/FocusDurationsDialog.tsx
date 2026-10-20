import { useState } from 'react'
import { DEFAULT_FOCUS_DURATIONS, FOCUS_LIMITS, LONG_BREAK_EVERY } from '../../../shared/focus/timer'
import type { FocusDurations } from '../../../shared/focus/types'
import type { TranslationKey } from '../../../shared/i18n'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { useAppStore, useT } from '../store/appStore'

const inputClass =
  'w-20 rounded-lg bg-app px-3 py-2 text-center text-sm text-fg tabular-nums ring-1 ring-line outline-none focus:ring-2 focus:ring-accent'
const invalidInputClass =
  'w-20 rounded-lg bg-app px-3 py-2 text-center text-sm text-fg tabular-nums ring-2 ring-danger outline-none'

const FIELDS: { key: keyof FocusDurations; label: TranslationKey }[] = [
  { key: 'focusMin', label: 'focus.durations.focus' },
  { key: 'shortBreakMin', label: 'focus.durations.short' },
  { key: 'longBreakMin', label: 'focus.durations.long' }
]

function valid(key: keyof FocusDurations, text: string): boolean {
  const n = Number(text)
  return /^\d+$/.test(text.trim()) && n >= FOCUS_LIMITS[key].min && n <= FOCUS_LIMITS[key].max
}

export function FocusDurationsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT()
  const current = useAppStore((s) => s.focus?.durations ?? DEFAULT_FOCUS_DURATIONS)
  const setFocusDurations = useAppStore((s) => s.setFocusDurations)
  const [values, setValues] = useState<Record<keyof FocusDurations, string>>({
    focusMin: String(current.focusMin),
    shortBreakMin: String(current.shortBreakMin),
    longBreakMin: String(current.longBreakMin)
  })
  const [checked, setChecked] = useState(false)
  const allValid = FIELDS.every((f) => valid(f.key, values[f.key]))

  const save = (): void => {
    setChecked(true)
    if (!allValid) return
    void setFocusDurations({
      focusMin: Number(values.focusMin),
      shortBreakMin: Number(values.shortBreakMin),
      longBreakMin: Number(values.longBreakMin)
    })
      .then(onClose)
      .catch((error) => console.error('[Focus] Saving durations failed', error))
  }

  return (
    <Dialog
      title={t('focus.durations.title')}
      onClose={onClose}
      width="max-w-sm"
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto"
            data-testid="focus-durations-restore"
            onClick={() =>
              setValues({
                focusMin: String(DEFAULT_FOCUS_DURATIONS.focusMin),
                shortBreakMin: String(DEFAULT_FOCUS_DURATIONS.shortBreakMin),
                longBreakMin: String(DEFAULT_FOCUS_DURATIONS.longBreakMin)
              })
            }
          >
            {t('focus.durations.restore')}
          </Button>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" data-testid="focus-durations-save" onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3 pb-1"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {FIELDS.map(({ key, label }) => {
          const bad = checked && !valid(key, values[key])
          return (
            <label key={key} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-col">
                <span className="text-sm">{t(label)}</span>
                <span className="text-[11px] text-muted">
                  {t('focus.durations.range', { min: FOCUS_LIMITS[key].min, max: FOCUS_LIMITS[key].max })}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={FOCUS_LIMITS[key].min}
                  max={FOCUS_LIMITS[key].max}
                  step={1}
                  data-testid={`focus-duration-${key}`}
                  value={values[key]}
                  aria-invalid={bad || undefined}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  className={bad ? invalidInputClass : inputClass}
                />
                <span className="w-8 text-xs text-muted">{t('focus.durations.unit')}</span>
              </span>
            </label>
          )
        })}
        {checked && !allValid && (
          <p className="text-xs text-danger-fg" data-testid="focus-durations-error">
            {t('focus.durations.invalid')}
          </p>
        )}
        <p className="text-xs text-muted">{t('focus.durations.note', { count: LONG_BREAK_EVERY })}</p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
