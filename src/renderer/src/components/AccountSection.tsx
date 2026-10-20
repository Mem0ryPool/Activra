import { useEffect, useRef, useState } from 'react'
import { parseEmailLogin, type AuthRequestResult, type AuthStatus, type AuthVerifyResult } from '../../../shared/auth'
import { useT } from '../store/appStore'
import { Button } from './Button'
import { Section } from './SettingsRows'

type Notice = { tone: 'error' | 'success'; text: string } | null
type Busy = null | 'send' | 'verify' | 'sign-out'

const inputClass =
  'h-9 w-full min-w-0 rounded-lg bg-app px-3 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-accent aria-[invalid=true]:ring-danger'

/**
 * Optional email sign-in in Settings (Phase 5C). Everything works without it; the page only ever holds
 * the state and the email (the main process keeps the session). Signing in changes no local data.
 */
export function AccountSection(): React.JSX.Element {
  const t = useT()
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const emailRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  const show = (next: AuthStatus): void => {
    setAuth(next)
    if (next.state === 'code-sent') {
      const at = Date.now()
      setNow(at)
      setResendAt(at + next.resendInSeconds * 1000)
    }
  }

  useEffect(() => {
    let alive = true
    window.lifeUnlocked.auth
      .status()
      .then((status) => alive && show(status))
      // Sign-in is optional: if it cannot answer, the page simply offers nothing.
      .catch(() => alive && setAuth({ mode: 'unavailable', state: 'signed-out' }))
    return () => {
      alive = false
    }
  }, [])

  const cooling = resendAt > now
  useEffect(() => {
    if (!cooling) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [cooling])

  const state = auth?.state
  useEffect(() => {
    if (state === 'code-sent') codeRef.current?.focus()
  }, [state])

  const failure = (result: Exclude<AuthRequestResult | AuthVerifyResult, { status: 'code-sent' | 'signed-in' }>): string => {
    switch (result.status) {
      case 'invalid-email':
        return t('account.error.invalidEmail')
      case 'channel-unavailable':
        return t('account.error.phone')
      case 'invalid-code':
        return t('account.error.code')
      case 'invalid-or-expired':
        return t('account.error.invalidOrExpired')
      case 'no-pending-code':
        return t('account.error.noPending')
      case 'rate-limited':
        return t('account.error.rateLimited', { seconds: result.retryAfterSeconds })
      default:
        return t('account.error.temporary')
    }
  }

  const run = async <R,>(kind: Busy, call: () => Promise<R>): Promise<R | null> => {
    setBusy(kind)
    setNotice(null)
    try {
      return await call()
    } catch {
      setNotice({ tone: 'error', text: t('account.error.temporary') })
      return null
    } finally {
      setBusy(null)
    }
  }

  const requestCode = async (address: string): Promise<void> => {
    const result = await run('send', () => window.lifeUnlocked.auth.requestCode(address))
    if (!result) return
    if (result.status === 'code-sent') {
      setCode('')
      setFieldError(null)
      setDevCode(result.developmentCode ?? null)
      show(result.auth)
    } else if (result.status === 'invalid-email' || result.status === 'channel-unavailable') {
      setFieldError(failure(result))
      emailRef.current?.focus()
    } else {
      setNotice({ tone: 'error', text: failure(result) })
    }
  }

  const submitEmail = (e: React.FormEvent): void => {
    e.preventDefault()
    if (busy) return
    const parsed = parseEmailLogin(email)
    if (!parsed.ok) {
      setFieldError(
        t(
          parsed.error === 'required'
            ? 'account.error.emailRequired'
            : parsed.error === 'invalid-email'
              ? 'account.error.invalidEmail'
              : 'account.error.phone'
        )
      )
      emailRef.current?.focus()
      return
    }
    void requestCode(parsed.email)
  }

  const submitCode = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy) return
    if (!/^\d{6}$/.test(code.trim())) {
      setFieldError(t('account.error.code'))
      codeRef.current?.focus()
      return
    }
    const result = await run('verify', () => window.lifeUnlocked.auth.verifyCode(code.trim()))
    if (!result) return
    if (result.status === 'signed-in') {
      setDevCode(null)
      setFieldError(null)
      setCode('')
      show(result.auth)
      setNotice({ tone: 'success', text: t('account.success') })
    } else if (result.status === 'invalid-code' || result.status === 'invalid-or-expired') {
      setFieldError(failure(result))
      codeRef.current?.select()
    } else {
      setNotice({ tone: 'error', text: failure(result) })
      if (result.status === 'no-pending-code') show(await window.lifeUnlocked.auth.status())
    }
  }

  const changeEmail = async (): Promise<void> => {
    const next = await run(null, () => window.lifeUnlocked.auth.cancel())
    setDevCode(null)
    setFieldError(null)
    setCode('')
    if (next) show(next)
    window.setTimeout(() => emailRef.current?.focus())
  }

  const signOut = async (): Promise<void> => {
    const next = await run('sign-out', () => window.lifeUnlocked.auth.signOut())
    if (!next) return
    show(next)
    setNotice({ tone: 'success', text: t('account.signedOut') })
  }

  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const errorId = 'account-field-error'

  return (
    <Section title={t('settings.account')} hint={t('account.hint')}>
      <div className="flex flex-col gap-3 px-4 py-3" data-testid="account-section" data-auth-state={auth?.state ?? 'loading'}>
        {!auth && <p className="text-sm text-muted">{t('account.loading')}</p>}

        {auth?.mode === 'unavailable' && <p className="text-sm text-muted">{t('account.unavailable')}</p>}

        {auth?.mode === 'development-mock' && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted" data-testid="account-dev-note">
            <span className="rounded-md bg-warn/15 px-1.5 py-0.5 font-semibold text-warn">{t('account.dev.badge')}</span>
            {t('account.dev.note')}
          </p>
        )}

        {auth?.mode === 'development-mock' && auth.state === 'signed-out' && (
          <form className="flex flex-col gap-1.5" onSubmit={submitEmail} noValidate>
            <label htmlFor="account-email" className="text-sm">
              {t('account.email')}
            </label>
            <div className="flex gap-2">
              <input
                ref={emailRef}
                id="account-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                placeholder="name@example.com"
                value={email}
                maxLength={320}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setFieldError(null)
                }}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? errorId : undefined}
                className={inputClass}
              />
              <Button type="submit" variant="primary" disabled={busy !== null} data-testid="account-send">
                {busy === 'send' ? t('account.sending') : t('account.sendCode')}
              </Button>
            </div>
            {fieldError && (
              <p id={errorId} role="alert" className="text-xs font-medium text-danger-fg">
                {fieldError}
              </p>
            )}
          </form>
        )}

        {auth?.state === 'code-sent' && (
          <form className="flex flex-col gap-1.5" onSubmit={(e) => void submitCode(e)} noValidate>
            <p className="text-sm">{t('account.codeSent', { email: auth.email })}</p>
            {devCode && (
              <p className="text-xs text-muted" data-testid="account-dev-code">
                {t('account.dev.code', { code: devCode })}
              </p>
            )}
            <label htmlFor="account-code" className="sr-only">
              {t('account.code')}
            </label>
            <div className="flex gap-2">
              <input
                ref={codeRef}
                id="account-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                  setFieldError(null)
                }}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? errorId : undefined}
                className={`${inputClass} max-w-40 tracking-[0.3em] tabular-nums`}
              />
              <Button type="submit" variant="primary" disabled={busy !== null} data-testid="account-verify">
                {busy === 'verify' ? t('account.verifying') : t('account.verify')}
              </Button>
            </div>
            {fieldError && (
              <p id={errorId} role="alert" className="text-xs font-medium text-danger-fg">
                {fieldError}
              </p>
            )}
            <div className="-ml-3.5 flex flex-wrap gap-1">
              <Button
                variant="ghost"
                disabled={busy !== null || cooling}
                onClick={() => void requestCode(auth.email)}
                data-testid="account-resend"
              >
                {cooling ? t('account.resendIn', { seconds: resendSeconds }) : t('account.resend')}
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => void changeEmail()}>
                {t('account.changeEmail')}
              </Button>
            </div>
          </form>
        )}

        {auth?.state === 'signed-in' && (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm" data-testid="account-signed-in">
                {t('account.signedIn', { email: auth.email })}
              </p>
              <p className="text-xs text-muted">{t('account.signedInNote')}</p>
            </div>
            <Button disabled={busy !== null} onClick={() => void signOut()} data-testid="account-sign-out">
              {t('account.signOut')}
            </Button>
          </div>
        )}

        <p
          aria-live="polite"
          data-testid="account-notice"
          className={!notice ? 'sr-only' : notice.tone === 'error' ? 'text-xs font-medium text-danger-fg' : 'text-xs text-muted'}
        >
          {notice?.text}
        </p>
      </div>
    </Section>
  )
}
