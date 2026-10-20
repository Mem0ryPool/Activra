import { IpcChannels } from '../../shared/ipc'
import { isValidAccelerator, type ShortcutChange } from '../../shared/shortcut'
import { validateBoolean, ValidationError } from '../../shared/validation'
import type { WidgetShortcut } from '../widgetShortcut'
import { broadcast, handle } from './registerHandlers'

/** The widget shortcut's status for Settings, and the pause while a new one is recorded (Phase 6.7). */
export function registerShortcutHandlers(
  shortcut: WidgetShortcut,
  /** Saves the accepted shortcut like any settings change (every window hears about it). */
  save: (accelerator: string) => Promise<unknown>
): { changed: () => void } {
  handle(IpcChannels.appShortcutStatus, () => shortcut.status)
  handle(IpcChannels.appSuspendShortcut, (_e, on: unknown) => {
    shortcut.suspend(validateBoolean(on, 'on'))
    return shortcut.status
  })
  // Register first, save only what works: a shortcut another program holds never replaces a working one.
  handle(IpcChannels.appSetShortcut, async (_e, value: unknown): Promise<ShortcutChange> => {
    if (!isValidAccelerator(value)) throw new ValidationError('Not a valid shortcut')
    const result = shortcut.tryChange(value)
    if (result === 'ok') await save(value)
    return { result, status: shortcut.status }
  })
  return { changed: () => broadcast(IpcChannels.appShortcutChanged, shortcut.status) }
}
