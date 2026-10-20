/** Pure geometry helpers, kept free of Electron imports so they are unit-testable. */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface SavedWindowState extends Rect {
  isMaximized: boolean
}

export interface WindowSizeLimits {
  defaultWidth: number
  defaultHeight: number
  minWidth: number
  minHeight: number
}

function isFiniteRect(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]))
}

export function parseSavedWindowState(value: unknown): SavedWindowState | null {
  if (!isFiniteRect(value)) return null
  const maximized = (value as unknown as Record<string, unknown>).isMaximized === true
  return { x: value.x, y: value.y, width: value.width, height: value.height, isMaximized: maximized }
}

function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

export function centerIn(area: Rect, width: number, height: number): Rect {
  const w = Math.min(width, area.width)
  const h = Math.min(height, area.height)
  return {
    x: Math.round(area.x + (area.width - w) / 2),
    y: Math.round(area.y + (area.height - h) / 2),
    width: w,
    height: h
  }
}

/**
 * Decides where the main window opens. A saved position is reused only if
 * enough of its title area is still on a connected display (a monitor may
 * have been unplugged); otherwise the window is centered on the primary display.
 */
export function resolveWindowBounds(
  saved: SavedWindowState | null,
  workAreas: readonly Rect[],
  primaryWorkArea: Rect,
  limits: WindowSizeLimits
): Rect {
  if (saved) {
    const width = Math.max(limits.minWidth, Math.round(saved.width))
    const height = Math.max(limits.minHeight, Math.round(saved.height))
    const titleStrip: Rect = { x: saved.x, y: saved.y, width, height: 40 }
    const visible = workAreas.some((area) => intersectionArea(titleStrip, area) >= Math.min(width, 200) * 40 * 0.5)
    if (visible) return { x: Math.round(saved.x), y: Math.round(saved.y), width, height }
  }
  return centerIn(primaryWorkArea, limits.defaultWidth, limits.defaultHeight)
}

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'

/** Places a window in a corner of a display's work area (which already excludes the taskbar/Dock/menu bar). */
export function cornerIn(area: Rect, width: number, height: number, margin: number, corner: Corner): Rect {
  const right = corner.endsWith('right')
  const bottom = corner.startsWith('bottom')
  return {
    x: Math.round(right ? area.x + area.width - width - margin : area.x + margin),
    y: Math.round(bottom ? area.y + area.height - height - margin : area.y + margin),
    width,
    height
  }
}

export function parseSavedRect(value: unknown): Rect | null {
  return isFiniteRect(value) ? { x: value.x, y: value.y, width: value.width, height: value.height } : null
}

/** Height of the widget's drag strip; at least part of it must be on screen so the user can grab it. */
const WIDGET_HANDLE_HEIGHT = 40
const WIDGET_DEFAULT_MARGIN = 24

/**
 * Decides where the desktop widget opens. A saved position is kept on the display
 * that shows most of its drag strip, nudged fully inside that display's work area
 * (resolution, scaling or taskbar may have changed). If no display shows enough of
 * the strip, e.g. its monitor was unplugged, it goes to the top-right of the primary display.
 */
export function resolveWidgetBounds(
  saved: Rect | null,
  workAreas: readonly Rect[],
  primaryWorkArea: Rect,
  size: { width: number; height: number }
): Rect {
  const { width, height } = size
  if (saved) {
    const strip: Rect = { x: saved.x, y: saved.y, width, height: WIDGET_HANDLE_HEIGHT }
    let best: Rect | null = null
    let bestArea = 0
    for (const area of workAreas) {
      const overlap = intersectionArea(strip, area)
      if (overlap > bestArea) {
        best = area
        bestArea = overlap
      }
    }
    if (best && bestArea >= width * WIDGET_HANDLE_HEIGHT * 0.25) {
      const w = Math.min(width, best.width)
      const h = Math.min(height, best.height)
      const clamp = (v: number, min: number, max: number): number => Math.round(Math.min(Math.max(v, min), max))
      return {
        x: clamp(saved.x, best.x, best.x + best.width - w),
        y: clamp(saved.y, best.y, best.y + best.height - h),
        width: w,
        height: h
      }
    }
  }
  const w = Math.min(width, primaryWorkArea.width)
  const h = Math.min(height, primaryWorkArea.height)
  const margin = Math.max(
    0,
    Math.min(WIDGET_DEFAULT_MARGIN, (primaryWorkArea.width - w) / 2, (primaryWorkArea.height - h) / 2)
  )
  return cornerIn(primaryWorkArea, w, h, margin, 'top-right')
}
