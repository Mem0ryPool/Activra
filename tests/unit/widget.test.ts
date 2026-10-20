import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/constants'
import { selectTodayTasks, sortActive, sortCompleted } from '../../src/shared/taskOrder'
import type { Task } from '../../src/shared/types'
import {
  validateSettingsPatch,
  validateWidgetOpacity,
  validateWidgetSettings,
  ValidationError
} from '../../src/shared/validation'
import { reviveWidgetSettings, WIDGET_ANIMATION_MS } from '../../src/shared/widget'
import { DataStore } from '../../src/main/storage/dataStore'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseSavedRect, resolveWidgetBounds } from '../../src/main/windows/windowBounds'

function task(id: string, createdAt: string, completedAt: string | null = null): Task {
  return {
    id,
    title: id,
    description: '',
    createdAt,
    updatedAt: completedAt ?? createdAt,
    completedAt,
    status: completedAt ? 'completed' : 'active',
    timerConfig: null,
    themeOverride: null,
    recurrence: null,
    recurrenceHistory: [],
    skippedOccurrences: [],
    due: null,
    reminderMinutes: null,
    window: null
  }
}

describe('task order', () => {
  const tasks = [
    task('old', '2026-10-01T08:00:00'),
    task('new', '2026-10-14T08:00:00'),
    task('doneEarly', '2026-10-01T08:00:00', '2026-10-15T09:00:00'),
    task('doneLate', '2026-10-01T08:00:00', '2026-10-15T18:00:00'),
    task('doneYesterday', '2026-10-01T08:00:00', '2026-10-14T23:59:00')
  ]

  it('keeps the Tasks page order: newest active first, latest unlock first', () => {
    expect(sortActive(tasks).map((x) => x.id)).toEqual(['new', 'old'])
    expect(sortCompleted(tasks).map((x) => x.id)).toEqual(['doneLate', 'doneEarly', 'doneYesterday'])
  })

  it('shows active tasks then tasks completed today, with progress', () => {
    const today = selectTodayTasks(tasks, [], new Date('2026-10-15T20:00:00').getTime())
    expect(today.items.map((x) => x.task.id)).toEqual(['new', 'old', 'doneLate', 'doneEarly'])
    expect(today.completed).toBe(2)
    expect(today.total).toBe(4)
  })

  it('drops tasks completed today once the day changes', () => {
    const tomorrow = selectTodayTasks(tasks, [], new Date('2026-10-16T00:00:01').getTime())
    expect(tomorrow.items.map((x) => x.task.id)).toEqual(['new', 'old'])
    expect(tomorrow.completed).toBe(0)
  })

  it('is empty without tasks', () => {
    expect(selectTodayTasks([], [], Date.now())).toEqual({ items: [], completed: 0, total: 0 })
  })
})

const fullWidget = {
  visible: true,
  alwaysOnTop: true,
  opacity: 60,
  shape: 'square',
  animation: 'smooth',
  appearance: 'light'
} as const

describe('widget settings validation', () => {
  it('accepts a full widget object', () => {
    expect(validateSettingsPatch({ widget: fullWidget })).toEqual({ widget: fullWidget })
  })

  it('rejects partial, unknown or out-of-range values', () => {
    const bad = [
      { visible: true },
      { ...fullWidget, visible: 'yes' },
      { ...fullWidget, opacity: 59 },
      { ...fullWidget, opacity: 101 },
      { ...fullWidget, opacity: 80.5 },
      { ...fullWidget, shape: 'circle' },
      { ...fullWidget, animation: 'burst' },
      { ...fullWidget, appearance: 'sepia' },
      { ...fullWidget, x: 0 },
      null
    ]
    for (const value of bad) expect(() => validateWidgetSettings(value)).toThrow(ValidationError)
    expect(() => validateWidgetOpacity(59)).toThrow(ValidationError)
    expect(validateWidgetOpacity(100)).toBe(100)
  })

  it('defaults to hidden, not on top, 95% opacity, rounded, fade', () => {
    expect(DEFAULT_SETTINGS.widget).toEqual({
      visible: false,
      alwaysOnTop: false,
      opacity: 95,
      shape: 'rounded',
      animation: 'fade',
      appearance: 'dark'
    })
  })

  it('restores each widget field on its own and clamps opacity from older versions', () => {
    // Saved by Phase 3A: no shape/animation, opacity from the old 30–100 range.
    expect(reviveWidgetSettings({ visible: true, alwaysOnTop: true, opacity: 40 })).toEqual({
      visible: true,
      alwaysOnTop: true,
      opacity: 60,
      shape: 'rounded',
      animation: 'fade',
      appearance: 'dark'
    })
    expect(reviveWidgetSettings({ visible: 'x', opacity: 'y', shape: 'square', animation: 'nope' })).toEqual({
      ...DEFAULT_SETTINGS.widget,
      shape: 'square'
    })
    expect(reviveWidgetSettings(null)).toEqual(DEFAULT_SETTINGS.widget)
  })

  it('every widget animation has a duration, and none is instant', () => {
    expect(WIDGET_ANIMATION_MS.none).toBe(0)
    for (const a of ['fade', 'slide', 'scale', 'smooth'] as const) {
      expect(WIDGET_ANIMATION_MS[a]).toBeGreaterThan(0)
      expect(WIDGET_ANIMATION_MS[a]).toBeLessThanOrEqual(300)
    }
  })

  it('loads old data files, keeps the other settings, and persists widget appearance', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lu-widget-'))
    await writeFile(
      path.join(dir, 'life-unlocked-data.json'),
      JSON.stringify({
        schemaVersion: 1,
        tasks: [],
        settings: {
          language: 'en',
          achievementTheme: 'custom',
          widget: { visible: true, alwaysOnTop: false, opacity: 85 }
        }
      })
    )
    const store = new DataStore({ directory: dir })
    await store.load()
    expect(store.getSettings().widget).toEqual({ ...DEFAULT_SETTINGS.widget, visible: true, opacity: 85 })
    expect(store.getSettings().achievementTheme).toBe('custom')
    expect(store.getSettings().appearance).toBe('system')
    await store.updateSettings({ widget: fullWidget })
    const reloaded = new DataStore({ directory: dir })
    await reloaded.load()
    expect(reloaded.getSettings().widget).toEqual(fullWidget)
    expect(reloaded.getSettings().language).toBe('en')
  })
})

describe('resolveWidgetBounds', () => {
  const size = { width: 320, height: 420 }
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }
  const secondary = { x: 1920, y: 0, width: 2560, height: 1400 }
  const left = { x: -1920, y: 200, width: 1920, height: 1040 }

  it('opens top-right on the primary display by default', () => {
    expect(resolveWidgetBounds(null, [primary], primary, size)).toEqual({ x: 1576, y: 24, width: 320, height: 420 })
  })

  it('restores a position on a second monitor, including negative coordinates', () => {
    expect(resolveWidgetBounds({ x: 3000, y: 500, ...size }, [primary, secondary], primary, size)).toEqual({
      x: 3000,
      y: 500,
      ...size
    })
    expect(resolveWidgetBounds({ x: -1000, y: 300, ...size }, [primary, left], primary, size)).toEqual({
      x: -1000,
      y: 300,
      ...size
    })
  })

  it('falls back to the primary display when the saved monitor is gone', () => {
    expect(resolveWidgetBounds({ x: 3000, y: 500, ...size }, [primary], primary, size)).toEqual({
      x: 1576,
      y: 24,
      ...size
    })
  })

  it('pulls a partly off-screen widget fully inside the display it is on', () => {
    // Hanging off the bottom-right corner, e.g. after the resolution or scaling dropped.
    expect(resolveWidgetBounds({ x: 1800, y: 900, ...size }, [primary], primary, size)).toEqual({
      x: 1600,
      y: 620,
      ...size
    })
    // Straddling two displays: it stays on the one that shows more of its drag strip.
    expect(resolveWidgetBounds({ x: 1850, y: 100, ...size }, [primary, secondary], primary, size)).toEqual({
      x: 1920,
      y: 100,
      ...size
    })
  })

  it('ignores a widget whose drag strip is above every display', () => {
    expect(resolveWidgetBounds({ x: 100, y: -300, ...size }, [primary], primary, size)).toEqual({
      x: 1576,
      y: 24,
      ...size
    })
  })

  it('shrinks to fit a display smaller than the widget', () => {
    const tiny = { x: 0, y: 0, width: 300, height: 400 }
    expect(resolveWidgetBounds(null, [tiny], tiny, size)).toEqual({ x: 0, y: 0, width: 300, height: 400 })
  })

  it('parses only finite rectangles', () => {
    expect(parseSavedRect({ x: 1, y: 2, width: 3, height: 4, extra: true })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4
    })
    expect(parseSavedRect({ x: 'a', y: 2, width: 3, height: 4 })).toBeNull()
    expect(parseSavedRect(null)).toBeNull()
  })
})
