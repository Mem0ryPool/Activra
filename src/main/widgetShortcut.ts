import { isValidAccelerator, type ShortcutChange, type ShortcutStatus } from '../shared/shortcut'

/** What registers the shortcut: Electron's globalShortcut in the app, a fake in unit tests. */
export interface ShortcutRegistrar {
  /** False (or a throw) when the system or another program already uses the accelerator. */
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

/**
 * Keeps one global shortcut for showing/hiding the desktop widget registered (Phase 6.7). At most one
 * accelerator is held at a time; applying a new one releases the old one first, so there is never a
 * second listener. A conflict never throws: it is reported as 'conflict' and the app starts normally.
 * While Settings records a replacement it is released ('suspended'), so pressing the old combination
 * there does not toggle the widget.
 */
export class WidgetShortcut {
  private wanted: string | null = null
  private held: string | null = null
  private suspended = false
  private conflict = false

  constructor(
    private readonly registrar: ShortcutRegistrar,
    private readonly onPress: () => void,
    private readonly onStatus: (status: ShortcutStatus) => void = () => {}
  ) {}

  /** Uses `accelerator` (null: off). Re-applying the same value changes nothing. */
  apply(accelerator: string | null): void {
    const next = accelerator !== null && isValidAccelerator(accelerator) ? accelerator : null
    if (next === this.wanted && (this.held === next || this.conflict || this.suspended)) return
    this.wanted = next
    this.sync()
  }

  /**
   * Switches to `accelerator` only if it can be registered: the new one is registered first, and only
   * then is the old one released. When another program holds it, nothing changes (the previous shortcut
   * keeps working) and 'conflict' is returned; the caller saves the setting only on 'ok'. Also ends a
   * recording pause.
   */
  tryChange(accelerator: string): ShortcutChange['result'] {
    if (!isValidAccelerator(accelerator)) return 'invalid'
    const wasSuspended = this.suspended
    this.suspended = false
    if (accelerator === this.held) {
      this.onStatus(this.status)
      return 'ok'
    }
    let ok = false
    try {
      ok = this.registrar.register(accelerator, () => this.onPress())
    } catch (error) {
      console.warn('[Shortcut] Could not register the widget shortcut', error)
    }
    if (!ok) {
      console.warn('[Shortcut] The new widget shortcut is already in use; the previous one is kept')
      // Back to what was there (the pause had released it).
      if (wasSuspended) this.sync()
      else this.onStatus(this.status)
      return 'conflict'
    }
    this.release()
    this.held = accelerator
    this.wanted = accelerator
    this.conflict = false
    this.onStatus(this.status)
    return 'ok'
  }

  /** Releases the shortcut while a replacement is recorded, and takes it back afterwards. */
  suspend(on: boolean): void {
    if (this.suspended === on) return
    this.suspended = on
    this.sync()
  }

  get status(): ShortcutStatus {
    if (this.wanted === null) return { accelerator: null, state: 'off' }
    if (this.suspended) return { accelerator: this.wanted, state: 'suspended' }
    return { accelerator: this.wanted, state: this.held === this.wanted ? 'registered' : 'conflict' }
  }

  /** Releases everything (app quit). */
  dispose(): void {
    this.release()
    this.wanted = null
  }

  private release(): void {
    if (this.held === null) return
    try {
      this.registrar.unregister(this.held)
    } catch (error) {
      console.warn('[Shortcut] Could not release the widget shortcut', error)
    }
    this.held = null
  }

  private sync(): void {
    this.release()
    this.conflict = false
    if (this.wanted !== null && !this.suspended) {
      let ok = false
      try {
        ok = this.registrar.register(this.wanted, () => this.onPress())
      } catch (error) {
        console.warn('[Shortcut] Could not register the widget shortcut', error)
      }
      if (ok) this.held = this.wanted
      else {
        this.conflict = true
        console.warn('[Shortcut] The widget shortcut is already in use by another program')
      }
    }
    this.onStatus(this.status)
  }
}
