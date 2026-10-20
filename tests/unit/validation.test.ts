import { describe, expect, it } from 'vitest'
import {
  ValidationError,
  validateId,
  validateSettingsPatch,
  validateTaskInput,
  validateTaskPatch
} from '../../src/shared/validation'

describe('validateTaskInput', () => {
  it('trims and fills defaults', () => {
    expect(validateTaskInput({ title: '  Gym  ' })).toEqual({ title: 'Gym', description: '', timerDurationSec: null, themeOverride: null, recurrence: null, due: null, reminderMinutes: null })
  })

  it.each([
    [null],
    ['text'],
    [{ title: '' }],
    [{ title: '   ' }],
    [{ title: 'x'.repeat(121) }],
    [{ title: 'ok', description: 5 }],
    [{ title: 'ok', timerDurationSec: 30 }],
    [{ title: 'ok', timerDurationSec: 90.5 }],
    [{ title: 'ok', extra: true }],
    [{ title: 'ok', __proto__: { polluted: true }, path: '/etc/passwd' }]
  ])('rejects %j', (input) => {
    expect(() => validateTaskInput(input)).toThrow(ValidationError)
  })

  it('accepts a countdown in whole seconds', () => {
    expect(validateTaskInput({ title: 'Exam', timerDurationSec: 3600 }).timerDurationSec).toBe(3600)
  })
})

describe('validateTaskPatch', () => {
  it('only keeps provided fields', () => {
    expect(validateTaskPatch({ title: 'New' })).toEqual({ title: 'New' })
    expect(validateTaskPatch({ timerDurationSec: null })).toEqual({ timerDurationSec: null })
  })
  it('rejects unknown fields and bad types', () => {
    expect(() => validateTaskPatch({ status: 'completed' })).toThrow(ValidationError)
    expect(() => validateTaskPatch({ restartTimer: 'yes' })).toThrow(ValidationError)
  })
})

describe('validateId', () => {
  it('accepts uuids and rejects paths', () => {
    expect(validateId('6f1c2b8e-1d2a-4f3b-9c4d-123456789abc')).toBeTruthy()
    expect(() => validateId('../../secret')).toThrow(ValidationError)
    expect(() => validateId(42)).toThrow(ValidationError)
  })
})

describe('validateSettingsPatch', () => {
  it('accepts valid values', () => {
    expect(validateSettingsPatch({ language: 'zh-CN', notificationVolume: 0, notificationDurationSec: 3 })).toEqual({
      language: 'zh-CN',
      notificationVolume: 0,
      notificationDurationSec: 3
    })
  })
  it('rejects out-of-range values', () => {
    expect(() => validateSettingsPatch({ language: 'fr' })).toThrow(ValidationError)
    expect(() => validateSettingsPatch({ notificationVolume: 101 })).toThrow(ValidationError)
    expect(() => validateSettingsPatch({ notificationDurationSec: 1 })).toThrow(ValidationError)
  })
})
