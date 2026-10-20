import { describe, expect, it } from 'vitest'
import {
  MODAL_SCRIM_OPACITY,
  TITLE_BAR_SYMBOL_MIN_CONTRAST,
  WINDOW_CHROME,
  contrastRatio,
  dimColor,
  titleBarColors
} from '../../src/shared/appearance'
import { isTitleBlank, validateTaskForm, type TaskFormValues } from '../../src/shared/taskForm'
import { ValidationError, validateBoolean } from '../../src/shared/validation'
import type { RecurrenceRule } from '../../src/shared/recurrence'

describe('dimColor', () => {
  it('matches black at the given opacity over the color', () => {
    expect(dimColor('#ffffff', 0.5)).toBe('#808080')
    expect(dimColor('#f4f5f7', MODAL_SCRIM_OPACITY)).toBe('#6e6e6f')
    expect(dimColor('#000000', 0.55)).toBe('#000000')
    expect(dimColor('#123456', 0)).toBe('#123456')
  })

  it('leaves anything that is not #rrggbb alone', () => {
    expect(dimColor('red', 0.5)).toBe('red')
  })
})

describe('titleBarColors', () => {
  it('uses the normal chrome without a dialog', () => {
    for (const appearance of ['light', 'dark'] as const) {
      expect(titleBarColors(appearance, false)).toEqual({
        color: WINDOW_CHROME[appearance].background,
        symbolColor: WINDOW_CHROME[appearance].symbol
      })
    }
  })

  it('paints the button area in the scrim color while a dialog is open, in both appearances', () => {
    for (const appearance of ['light', 'dark'] as const) {
      const { color, symbolColor } = titleBarColors(appearance, true)
      expect(color).toBe(dimColor(WINDOW_CHROME[appearance].background, MODAL_SCRIM_OPACITY))
      // Minimize / maximize / close stay clearly visible.
      expect(contrastRatio(symbolColor, color)).toBeGreaterThanOrEqual(TITLE_BAR_SYMBOL_MIN_CONTRAST)
    }
    // The light title bar is no longer white-ish under the dark scrim.
    expect(titleBarColors('light', true).color).toBe('#6e6e6f')
  })
})

describe('contrastRatio', () => {
  it('follows WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
  })
})

describe('validateBoolean', () => {
  it('accepts only booleans', () => {
    expect(validateBoolean(true, 'open')).toBe(true)
    expect(validateBoolean(false, 'open')).toBe(false)
    for (const bad of [1, 'true', null, undefined, {}]) expect(() => validateBoolean(bad, 'open')).toThrow(ValidationError)
  })
})

const daily: RecurrenceRule = {
  preset: 'daily',
  unit: 'day',
  interval: 1,
  weekdays: [],
  startDate: '2026-10-16',
  endDate: null
}
const base: TaskFormValues = {
  title: 'Read',
  timerOn: false,
  durationSec: 1800,
  rule: null,
  missingWeekdays: false,
  dueOn: false,
  dueDate: ''
}

describe('task name validation', () => {
  it.each(['', ' ', '   ', '\t', ' \n '])('treats %j as blank', (title) => {
    expect(isTitleBlank(title)).toBe(true)
    expect(validateTaskForm({ ...base, title })).toEqual({ field: 'title', key: 'dialog.error.titleRequired' })
  })

  it('accepts a name with surrounding spaces', () => {
    expect(isTitleBlank('  Gym ')).toBe(false)
    expect(validateTaskForm({ ...base, title: '  Gym ' })).toBeNull()
  })

  it('reports the empty name first, at the name field, even with repeat and deadline filled in', () => {
    expect(
      validateTaskForm({ ...base, title: '', rule: { ...daily, endDate: '2026-10-01' }, missingWeekdays: true, dueOn: true })
    ).toEqual({ field: 'title', key: 'dialog.error.titleRequired' })
  })

  it('keeps the other checks as form errors', () => {
    expect(validateTaskForm({ ...base, timerOn: true, durationSec: 0 })?.key).toBe('dialog.error.timerRange')
    expect(validateTaskForm({ ...base, rule: daily, timerOn: true, durationSec: 0 })).toBeNull()
    expect(validateTaskForm({ ...base, rule: daily, missingWeekdays: true })).toEqual({ field: 'form', key: 'dialog.error.weekdays' })
    expect(validateTaskForm({ ...base, rule: { ...daily, endDate: '2026-10-01' } })?.key).toBe('dialog.error.endBeforeStart')
    expect(validateTaskForm({ ...base, dueOn: true, dueDate: '' })?.key).toBe('dialog.error.dueDate')
    expect(validateTaskForm({ ...base, rule: daily, dueOn: true, dueDate: '' })).toBeNull()
  })
})
