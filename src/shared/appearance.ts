/** Light/dark choice for the main window and, separately, for the desktop widget. */
export const APPEARANCES = ['dark', 'light', 'system'] as const
export type Appearance = (typeof APPEARANCES)[number]
export type ResolvedAppearance = 'dark' | 'light'

export function resolveAppearance(setting: Appearance, systemPrefersDark: boolean): ResolvedAppearance {
  if (setting === 'system') return systemPrefersDark ? 'dark' : 'light'
  return setting
}

/** Main-window chrome colors the main process needs (background before paint, Windows title bar buttons). */
export const WINDOW_CHROME: Record<ResolvedAppearance, { background: string; symbol: string }> = {
  dark: { background: '#111827', symbol: '#9CA3AF' },
  light: { background: '#f4f5f7', symbol: '#4b5563' }
}

/** Opacity of the black scrim behind a modal dialog. Keep in step with `bg-black/55` in `Dialog.tsx`. */
export const MODAL_SCRIM_OPACITY = 0.55

/** `hex` (#rrggbb) as it looks under black at `opacity`, so native chrome can match the page's scrim. */
export function dimColor(hex: string, opacity: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return hex
  const value = parseInt(match[1] as string, 16)
  const channel = (shift: number): string =>
    Math.round(((value >> shift) & 0xff) * (1 - opacity))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16)
  const [r, g, b] = [16, 8, 0].map((shift) => {
    const c = ((value >> shift) & 0xff) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two #rrggbb colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Minimum contrast for the title bar buttons (WCAG non-text contrast), so minimize/maximize/close stay visible. */
export const TITLE_BAR_SYMBOL_MIN_CONTRAST = 3

/**
 * Colors for the Windows title bar buttons (Window Controls Overlay). The OS draws them above the page,
 * so a page scrim cannot cover them; while a modal is open they are repainted with the scrim's color instead.
 * The symbols are dimmed by about the same amount, adjusted so they stay clearly visible.
 */
export function titleBarColors(appearance: ResolvedAppearance, modalOpen: boolean): { color: string; symbolColor: string } {
  const chrome = WINDOW_CHROME[appearance]
  if (!modalOpen) return { color: chrome.background, symbolColor: chrome.symbol }
  const color = dimColor(chrome.background, MODAL_SCRIM_OPACITY)
  // Dim the symbols like the page, or as close to that as keeps them readable (darker on light, lighter on dark).
  const steps = Array.from({ length: 21 }, (_, i) => i / 20).sort(
    (a, b) => Math.abs(a - MODAL_SCRIM_OPACITY) - Math.abs(b - MODAL_SCRIM_OPACITY) || a - b
  )
  for (const opacity of steps) {
    const symbolColor = dimColor(chrome.symbol, opacity)
    if (contrastRatio(symbolColor, color) >= TITLE_BAR_SYMBOL_MIN_CONTRAST) return { color, symbolColor }
  }
  return { color, symbolColor: chrome.symbol }
}
