import { useCallback, useEffect, useState } from 'react'
import { acceleratorFromKey, defaultWidgetShortcut, formatAccelerator, type ShortcutStatus } from '../../../shared/shortcut'
import { useAppStore, useT } from '../store/appStore'
import { Button } from './Button'

/** A message from the last attempt, shown until the next one. */
type Notice = { kind: 'needs-modifier' } | { kind: 'too-many' } | { kind: 'rejected'; keys: string; current: string | null }

/**
 * Settings row for the widget's global shortcut (Phase 6.7). Click the shortcut field and press a new
 * combination (at most 3 keys); Esc cancels. While recording, the main process releases the old shortcut,
 * so pressing it here never toggles the widget. A new shortcut is registered before it is saved: when
 * another program holds it, nothing changes, the previous one keeps working, and the row says so.
 */
export function ShortcutSetting(): React.JSX.Element {
  const t = useT()
  const platform = window.lifeUnlocked.platform
  const accelerator = useAppStore((s) => s.settings.widgetShortcut)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [status, setStatus] = useState<ShortcutStatus | null>(null)
  const [recording, setRecording] = useState(false)
  // Kept with the shortcut it was about: once the shortcut changes (anywhere), the message is gone.
  const [noticeState, setNoticeState] = useState<{ notice: Notice; for: string | null } | null>(null)
  const notice = noticeState && noticeState.for === accelerator ? noticeState.notice : null
  const setNotice = useCallback(
    (next: Notice | null): void => setNoticeState(next ? { notice: next, for: accelerator } : null),
    [accelerator]
  )
  const format = useCallback((a: string): string => formatAccelerator(a, platform), [platform])

  useEffect(() => {
    let live = true
    void window.lifeUnlocked.app.shortcutStatus().then((s) => live && setStatus(s))
    const off = window.lifeUnlocked.app.onShortcutChanged(setStatus)
    return () => {
      live = false
      off()
    }
  }, [])

  /** Tries a shortcut; saved (by the main process) only when it could be registered. */
  const change = useCallback(
    async (next: string): Promise<void> => {
      const answer = await window.lifeUnlocked.app.setShortcut(next)
      setStatus(answer.status)
      // On a conflict the status is what still works (the previous shortcut), if anything.
      const kept = answer.status.state === 'registered' ? answer.status.accelerator : null
      setNotice(answer.result === 'conflict' ? { kind: 'rejected', keys: format(next), current: kept && format(kept) } : null)
    },
    [format, setNotice]
  )

  const stop = useCallback((): void => {
    setRecording(false)
    void window.lifeUnlocked.app.suspendShortcut(false).then(setStatus)
  }, [])

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      // Every key goes to the recorder while it listens (nothing else on the page reacts).
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        setNotice(null)
        stop()
        return
      }
      const result = acceleratorFromKey(e, platform)
      if (result.kind === 'pending') return
      if (result.kind !== 'ok') {
        setNotice({ kind: result.kind })
        return
      }
      setRecording(false)
      void change(result.accelerator).catch((error) => {
        console.error('[Shortcut] Could not change the shortcut', error)
        stop()
      })
    }
    const onBlur = (): void => stop()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [recording, platform, stop, change, setNotice])
  // Leaving the page while recording gives the shortcut back.
  useEffect(() => () => void window.lifeUnlocked.app.suspendShortcut(false), [])

  const start = (): void => {
    setNotice(null)
    setRecording(true)
    void window.lifeUnlocked.app.suspendShortcut(true).then(setStatus)
  }

  const keys = accelerator ? format(accelerator) : null
  const state = status?.state
  const line =
    notice?.kind === 'needs-modifier'
      ? t(platform === 'darwin' ? 'settings.widget.shortcut.needsModifierMac' : 'settings.widget.shortcut.needsModifier')
      : notice?.kind === 'too-many'
        ? t(platform === 'darwin' ? 'settings.widget.shortcut.tooManyMac' : 'settings.widget.shortcut.tooMany')
        : notice?.kind === 'rejected'
          ? notice.current
            ? t('settings.widget.shortcut.rejected', { keys: notice.keys, current: notice.current })
            : t('settings.widget.shortcut.rejectedNone', { keys: notice.keys })
          : recording
            ? t('settings.widget.shortcut.recordingHint')
            : accelerator === null || state === 'off'
              ? t(platform === 'darwin' ? 'settings.widget.shortcut.offMac' : 'settings.widget.shortcut.off')
              : state === 'conflict'
                ? t('settings.widget.shortcut.conflict', { keys: keys ?? '' })
                : t('settings.widget.shortcut.registered', { keys: keys ?? '' })
  const warn = notice !== null || (!recording && state === 'conflict')

  return (
    <div className="flex min-h-14 items-center justify-between gap-6 px-4 py-3" data-testid="widget-shortcut-row">
      <div className="min-w-0">
        <p className="text-sm">{t('settings.widget.shortcut')}</p>
        <p
          className={`text-xs ${warn ? 'text-warn' : 'text-muted'}`}
          data-testid="widget-shortcut-status"
          data-state={notice ? notice.kind : recording ? 'recording' : (state ?? '')}
          role="status"
        >
          {line}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          data-testid="widget-shortcut-keys"
          aria-label={`${t('settings.widget.shortcut')}: ${recording ? t('settings.widget.shortcut.recording') : (keys ?? t('settings.widget.shortcut.none'))}`}
          aria-pressed={recording}
          title={t('settings.widget.shortcut.clickToChange')}
          onClick={() => (recording ? stop() : start())}
          className={`no-drag inline-flex h-9 min-w-32 items-center justify-center rounded-lg px-3 text-[13px] tabular-nums ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
            recording
              ? 'bg-accent/10 text-accent ring-accent/60'
              : keys
                ? 'bg-app text-fg ring-line hover:ring-ink/25'
                : 'bg-app text-muted ring-line hover:ring-ink/25'
          }`}
        >
          {recording ? t('settings.widget.shortcut.recording') : (keys ?? t('settings.widget.shortcut.none'))}
        </button>
        {recording ? (
          <Button variant="ghost" data-testid="widget-shortcut-cancel" onClick={stop}>
            {t('common.cancel')}
          </Button>
        ) : (
          <>
            {accelerator !== defaultWidgetShortcut(platform) && (
              <Button variant="ghost" data-testid="widget-shortcut-default" onClick={() => void change(defaultWidgetShortcut(platform))}>
                {t('settings.widget.shortcut.reset')}
              </Button>
            )}
            {accelerator !== null && (
              <Button
                variant="ghost"
                data-testid="widget-shortcut-off"
                onClick={() => {
                  setNotice(null)
                  void updateSettings({ widgetShortcut: null })
                }}
              >
                {t('settings.widget.shortcut.turnOff')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
