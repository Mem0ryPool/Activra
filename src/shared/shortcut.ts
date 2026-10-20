/**
 * The global shortcut that shows or hides the desktop widget (Phase 6.7). Stored as an Electron
 * accelerator ("CommandOrControl+Alt+W"), so the same value means Ctrl on Windows and Cmd on macOS.
 * Recording uses `KeyboardEvent.code` (the physical key), so keyboard layouts and input methods do not
 * change what is saved.
 */

export const DEFAULT_WIDGET_SHORTCUT = 'CommandOrControl+Alt+D'
/**
 * macOS default: ⌃⌥D. The portable default would be ⌘⌥D there, which is macOS's own "show or hide the
 * Dock" shortcut. Only a settings file without a saved shortcut gets it (a new Mac profile); a shortcut
 * the user recorded is never replaced.
 */
export const MAC_WIDGET_SHORTCUT = 'Control+Alt+D'

/** The shortcut a new profile starts with, and what "restore default" sets, on this platform. */
export function defaultWidgetShortcut(platform: string): string {
  return platform === 'darwin' ? MAC_WIDGET_SHORTCUT : DEFAULT_WIDGET_SHORTCUT
}

/** Earlier defaults (Ctrl+Alt+W clashes with WeChat). A saved earlier default moves to the current one; any other choice is kept. */
const PREVIOUS_DEFAULTS = ['CommandOrControl+Alt+W']
/** At most this many keys, modifiers included (e.g. Ctrl+Alt+D). */
export const MAX_SHORTCUT_KEYS = 3

export function migrateWidgetShortcut(saved: string | null): string | null {
  return saved !== null && PREVIOUS_DEFAULTS.includes(saved) ? DEFAULT_WIDGET_SHORTCUT : saved
}

const MODIFIERS = ['CommandOrControl', 'Control', 'Command', 'Super', 'Alt', 'Shift'] as const
type Modifier = (typeof MODIFIERS)[number]

const NAMED_KEYS = [
  'Space', 'Tab', 'Enter', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'Up', 'Down', 'Left', 'Right', 'Plus', '-', '=', ',', '.', '/', ';', "'", '[', ']', '\\', '`'
]
const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/

function isKey(key: string): boolean {
  return KEY.test(key) || NAMED_KEYS.includes(key)
}

export interface ParsedAccelerator {
  modifiers: Modifier[]
  key: string
}

/** Splits an accelerator; null unless it is modifiers (at least one besides Shift) plus one key. */
export function parseAccelerator(value: unknown): ParsedAccelerator | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const parts = value.split('+')
  // "Plus" is the key name for "+", so a trailing empty part never appears in a valid value.
  const key = parts.pop() ?? ''
  if (!isKey(key)) return null
  const modifiers: Modifier[] = []
  for (const part of parts) {
    if (!(MODIFIERS as readonly string[]).includes(part) || modifiers.includes(part as Modifier)) return null
    modifiers.push(part as Modifier)
  }
  if (!modifiers.some((m) => m !== 'Shift') || modifiers.length + 1 > MAX_SHORTCUT_KEYS) return null
  return { modifiers, key }
}

export function isValidAccelerator(value: unknown): value is string {
  return parseAccelerator(value) !== null
}

const CODE_KEYS: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Delete: 'Delete',
  Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`'
}

export interface KeyLike {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * The accelerator for a key press while recording. `pending`: only modifiers are held so far (keep
 * waiting); `needs-modifier`: a key without Ctrl/Alt/Win (Cmd/Option/Control on macOS), which would
 * block that key everywhere, so it is refused; `too-many`: more than MAX_SHORTCUT_KEYS keys.
 */
export function acceleratorFromKey(
  event: KeyLike,
  platform: string
): { kind: 'ok'; accelerator: string } | { kind: 'pending' } | { kind: 'needs-modifier' } | { kind: 'too-many' } {
  const mac = platform === 'darwin'
  let key: string | undefined
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3)
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5)
  else if (/^Numpad[0-9]$/.test(event.code)) key = event.code.slice(6)
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code
  else key = CODE_KEYS[event.code]
  if (!key) return { kind: 'pending' }
  const modifiers: Modifier[] = []
  // Ctrl on Windows and Cmd on macOS are saved as one portable modifier.
  if (mac ? event.metaKey : event.ctrlKey) modifiers.push('CommandOrControl')
  if (mac && event.ctrlKey) modifiers.push('Control')
  if (!mac && event.metaKey) modifiers.push('Super')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (!modifiers.some((m) => m !== 'Shift')) return { kind: 'needs-modifier' }
  if (modifiers.length + 1 > MAX_SHORTCUT_KEYS) return { kind: 'too-many' }
  return { kind: 'ok', accelerator: [...modifiers, key].join('+') }
}

const LABELS: Record<'win' | 'mac', Record<Modifier, string>> = {
  win: { CommandOrControl: 'Ctrl', Control: 'Ctrl', Command: 'Win', Super: 'Win', Alt: 'Alt', Shift: 'Shift' },
  mac: { CommandOrControl: '⌘', Control: '⌃', Command: '⌘', Super: '⌘', Alt: '⌥', Shift: '⇧' }
}
const KEY_LABELS: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→', Plus: '+' }

/** How the shortcut is written for people: "Ctrl+Alt+W" on Windows, "⌘⌥W" on macOS. */
export function formatAccelerator(accelerator: string, platform: string): string {
  const parsed = parseAccelerator(accelerator)
  if (!parsed) return accelerator
  const mac = platform === 'darwin'
  const labels = LABELS[mac ? 'mac' : 'win']
  const parts = [...parsed.modifiers.map((m) => labels[m]), KEY_LABELS[parsed.key] ?? parsed.key]
  return mac ? parts.join('') : parts.join('+')
}

/** The answer to changing the shortcut from Settings. */
export interface ShortcutChange {
  /** 'conflict': another program holds it; nothing changed and the previous shortcut still works. */
  result: 'ok' | 'conflict' | 'invalid'
  status: ShortcutStatus
}

/** Where the shortcut stands, as the Settings page shows it. */
export interface ShortcutStatus {
  accelerator: string | null
  /**
   * 'registered': it works. 'off': the user turned it off. 'conflict': another program (or Windows)
   * already uses it. 'suspended': paused while a new one is being recorded.
   */
  state: 'registered' | 'off' | 'conflict' | 'suspended'
}
