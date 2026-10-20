import { randomBytes } from 'node:crypto'
import {
  AUTH_INPUT_MAX_LENGTH,
  parseEmailLogin,
  type AuthMode,
  type AuthRequestResult,
  type AuthStatus,
  type AuthVerifyResult,
  type LoginIdentifier
} from '../../shared/auth'
import { mapOtpError } from './otpErrors'
import { defaultRateLimitPolicy, identifierKey, OtpRateLimiter, type Clock, type RateLimitPolicy } from './otpGuards'
import { normalizeOtpToken, type OtpAuthProvider } from './otpProvider'
import { defaultSessionPolicy, sessionAction, type SessionPolicy } from './sessionPolicy'
import type { AuthSessionStore } from './sessionStore'

const TOUCH_INTERVAL_MS = 3_600_000

export interface AuthServiceDeps {
  mode: AuthMode
  /** null while no provider is approved: every call answers 'unavailable' and the app stays guest-only. */
  provider: OtpAuthProvider | null
  sessions: AuthSessionStore
  /** Development mock only: the code just "delivered", shown in the window instead of being sent. */
  takeDevelopmentCode?: () => string | undefined
  now?: Clock
  rateLimit?: RateLimitPolicy
  sessionPolicy?: SessionPolicy
}

/**
 * Optional email OTP sign-in (Phase 5C), main process only. It answers the page with `AuthStatus`
 * (state and email, never a token), keeps the session in `AuthSessionStore`, and never reads, uploads
 * or changes local tasks, settings or other data. Phone (+86) identifiers parse but are not offered.
 */
export class AuthService {
  private readonly now: Clock
  private readonly rateLimit: RateLimitPolicy
  private readonly limiter: OtpRateLimiter
  private readonly pepper = randomBytes(32).toString('hex')
  private pending: { identifier: LoginIdentifier; sentAt: number } | null = null

  constructor(private readonly deps: AuthServiceDeps) {
    this.now = deps.now ?? Date.now
    this.rateLimit = deps.rateLimit ?? defaultRateLimitPolicy
    this.limiter = new OtpRateLimiter(this.rateLimit, this.now)
  }

  get mode(): AuthMode {
    return this.deps.mode
  }

  async status(): Promise<AuthStatus> {
    const mode = this.deps.mode
    if (this.pending) {
      const wait = this.pending.sentAt + this.rateLimit.resendCooldownMs - this.now()
      return { mode, state: 'code-sent', email: this.pending.identifier.value, resendInSeconds: Math.max(0, Math.ceil(wait / 1000)) }
    }
    const stored = await this.deps.sessions.load()
    if (!stored) return { mode, state: 'signed-out' }
    const now = this.now()
    // Refreshing needs the real provider adapter (Phase 5D); until then an expiring session ends.
    if (sessionAction(stored.session, stored.clock, now, this.deps.sessionPolicy ?? defaultSessionPolicy) !== 'use') {
      await this.deps.sessions.clear()
      return { mode, state: 'signed-out' }
    }
    if (now - stored.clock.lastActiveAt >= TOUCH_INTERVAL_MS) {
      await this.deps.sessions.save({ ...stored, clock: { ...stored.clock, lastActiveAt: now } })
    }
    return { mode, state: 'signed-in', email: stored.email }
  }

  async requestCode(input: unknown): Promise<AuthRequestResult> {
    const provider = this.deps.provider
    if (!provider) return { status: 'unavailable' }
    if (typeof input !== 'string' || input.length > AUTH_INPUT_MAX_LENGTH) return { status: 'invalid-email' }
    const parsed = parseEmailLogin(input)
    if (!parsed.ok) return { status: parsed.error === 'phone-unavailable' ? 'channel-unavailable' : 'invalid-email' }
    const identifier: LoginIdentifier = { kind: 'email', value: parsed.email }
    const limit = this.limiter.checkSend(identifierKey(identifier, this.pepper))
    if (!limit.allowed) return { status: 'rate-limited', retryAfterSeconds: limit.retryAfterSeconds }
    try {
      const result = await provider.request({ identifier })
      if (result.status !== 'accepted') return result
    } catch (error) {
      const failure = mapOtpError(error)
      return failure.status === 'invalid-or-expired' ? { status: 'temporarily-unavailable' } : failure
    }
    this.pending = { identifier, sentAt: this.now() }
    const developmentCode = this.deps.mode === 'development-mock' ? this.deps.takeDevelopmentCode?.() : undefined
    return { status: 'code-sent', auth: await this.status(), ...(developmentCode ? { developmentCode } : {}) }
  }

  async verifyCode(input: unknown): Promise<AuthVerifyResult> {
    const provider = this.deps.provider
    if (!provider) return { status: 'unavailable' }
    const pending = this.pending
    if (!pending) return { status: 'no-pending-code' }
    const token = typeof input === 'string' && input.length <= AUTH_INPUT_MAX_LENGTH ? normalizeOtpToken(input) : null
    if (token === null) return { status: 'invalid-code' }
    const key = identifierKey(pending.identifier, this.pepper)
    const limit = this.limiter.checkVerify(key)
    if (!limit.allowed) return { status: 'rate-limited', retryAfterSeconds: limit.retryAfterSeconds }
    let result
    try {
      result = await provider.verify({ identifier: pending.identifier, token })
    } catch (error) {
      result = mapOtpError(error)
    }
    if (result.status !== 'verified') {
      if (result.status === 'invalid-or-expired') this.limiter.recordVerifyFailure(key)
      return result
    }
    this.limiter.recordVerifySuccess(key)
    // Only the session is stored; local data is not uploaded, merged or overwritten (Phase 5A rule).
    const now = this.now()
    await this.deps.sessions.save({
      session: result.session,
      clock: { startedAt: now, lastActiveAt: now },
      email: pending.identifier.value
    })
    this.pending = null
    return { status: 'signed-in', auth: await this.status() }
  }

  /** Leaves the code step ("Use another email"); the code itself simply expires. */
  async cancel(): Promise<AuthStatus> {
    this.pending = null
    return this.status()
  }

  async signOut(): Promise<AuthStatus> {
    this.pending = null
    await this.deps.sessions.clear()
    return this.status()
  }
}
