import { APPEARANCES, type Appearance } from './appearance'
import type { WidgetSettings } from './types'

export const WIDGET_SHAPES = ['rounded', 'square'] as const
export type WidgetShape = (typeof WIDGET_SHAPES)[number]

export const WIDGET_ANIMATIONS = ['none', 'fade', 'slide', 'scale', 'smooth'] as const
export type WidgetAnimation = (typeof WIDGET_ANIMATIONS)[number]

/** Show/hide transition length per animation; the main process waits this long before closing the window. */
export const WIDGET_ANIMATION_MS: Record<WidgetAnimation, number> = {
  none: 0,
  fade: 180,
  slide: 220,
  scale: 180,
  smooth: 280
}

/** Whole-window opacity in percent. Below 60 text gets hard to read on busy wallpapers. */
export const WIDGET_OPACITY_MIN = 60
export const WIDGET_OPACITY_MAX = 100

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  visible: false,
  alwaysOnTop: false,
  opacity: 95,
  shape: 'rounded',
  animation: 'fade',
  appearance: 'dark'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Lenient restore from disk: each field falls back to its default on its own,
 * and an opacity saved by an older version with a wider range is clamped instead of reset.
 */
export function reviveWidgetSettings(raw: unknown): WidgetSettings {
  const d = DEFAULT_WIDGET_SETTINGS
  if (!isRecord(raw)) return { ...d }
  const opacity =
    typeof raw.opacity === 'number' && Number.isFinite(raw.opacity)
      ? Math.min(WIDGET_OPACITY_MAX, Math.max(WIDGET_OPACITY_MIN, Math.round(raw.opacity)))
      : d.opacity
  return {
    visible: typeof raw.visible === 'boolean' ? raw.visible : d.visible,
    alwaysOnTop: typeof raw.alwaysOnTop === 'boolean' ? raw.alwaysOnTop : d.alwaysOnTop,
    opacity,
    shape: (WIDGET_SHAPES as readonly unknown[]).includes(raw.shape) ? (raw.shape as WidgetShape) : d.shape,
    animation: (WIDGET_ANIMATIONS as readonly unknown[]).includes(raw.animation)
      ? (raw.animation as WidgetAnimation)
      : d.animation,
    appearance: (APPEARANCES as readonly unknown[]).includes(raw.appearance)
      ? (raw.appearance as Appearance)
      : d.appearance
  }
}
