import { describe, expect, it } from 'vitest'
import { mapOtpError } from '../../src/main/auth/otpErrors'
import { defaultRateLimitPolicy, identifierKey, OtpRateLimiter, ReplayGuard } from '../../src/main/auth/otpGuards'
import { redactSession, sessionAction } from '../../src/main/auth/sessionPolicy'

const email = { kind: 'email' as const, value: 'person@example.com' }

describe('OTP error mapping', () => {
  it('collapses provider failures to three public outcomes without leaking details', () => {
    expect(mapOtpError({ status: 429 }, 42)).toEqual({ status: 'rate-limited', retryAfterSeconds: 42 })
    expect(mapOtpError({ status: 429 }, 99999)).toEqual({ status: 'rate-limited', retryAfterSeconds: 3600 })
    expect(mapOtpError({ code: 'over_sms_send_rate_limit' })).toEqual({ status: 'rate-limited', retryAfterSeconds: 60 })
    expect(mapOtpError({ code: 'otp_expired', message: 'person@example.com' })).toEqual({ status: 'invalid-or-expired' })
    expect(mapOtpError({ status: 422 })).toEqual({ status: 'invalid-or-expired' })
    expect(mapOtpError(new Error('boom'))).toEqual({ status: 'temporarily-unavailable' })
    expect(mapOtpError({ status: 500 })).toEqual({ status: 'temporarily-unavailable' })
    expect(mapOtpError(null)).toEqual({ status: 'temporarily-unavailable' })
  })
})

describe('OTP rate limiter', () => {
  it('enforces resend cooldown and the hourly send cap', () => {
    let now = 0
    const limiter = new OtpRateLimiter(defaultRateLimitPolicy, () => now)
    expect(limiter.checkSend('a')).toEqual({ allowed: true })
    now = 10_000
    expect(limiter.checkSend('a')).toEqual({ allowed: false, retryAfterSeconds: 50 })
    for (let i = 0; i < 4; i += 1) {
      now += 61_000
      expect(limiter.checkSend('a')).toEqual({ allowed: true })
    }
    now += 61_000
    expect(limiter.checkSend('a').allowed).toBe(false)
    expect(limiter.checkSend('b')).toEqual({ allowed: true })
    now = 3_600_001 + 10_000
    expect(limiter.checkSend('a')).toEqual({ allowed: true })
  })

  it('locks verification after the attempt cap with exponential backoff', () => {
    let now = 0
    const limiter = new OtpRateLimiter(defaultRateLimitPolicy, () => now)
    for (let i = 0; i < 5; i += 1) limiter.recordVerifyFailure('a')
    expect(limiter.checkVerify('a')).toEqual({ allowed: false, retryAfterSeconds: 30 })
    now = 30_000
    expect(limiter.checkVerify('a')).toEqual({ allowed: true })
    for (let i = 0; i < 5; i += 1) limiter.recordVerifyFailure('a')
    expect(limiter.checkVerify('a')).toEqual({ allowed: false, retryAfterSeconds: 60 })
    limiter.recordVerifySuccess('a')
    expect(limiter.checkVerify('a')).toEqual({ allowed: true })
  })

  it('keys state by HMAC so raw identifiers are not retained', () => {
    const key = identifierKey(email, 'pepper')
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(key).not.toContain('person')
    expect(identifierKey(email, 'other')).not.toBe(key)
  })
})

describe('replay guard', () => {
  it('accepts an id once per ttl and rejects malformed ids', () => {
    let now = 0
    const guard = new ReplayGuard(1000, () => now)
    const id = 'request-id-0123456789'
    expect(guard.claim(id)).toBe(true)
    expect(guard.claim(id)).toBe(false)
    expect(guard.claim('short')).toBe(false)
    expect(guard.claim(42)).toBe(false)
    now = 1000
    expect(guard.claim(id)).toBe(true)
  })

  it('fails closed when full', () => {
    const guard = new ReplayGuard(1000, () => 0, 1)
    expect(guard.claim('a'.repeat(16))).toBe(true)
    expect(guard.claim('b'.repeat(16))).toBe(false)
  })
})

describe('session policy', () => {
  const hour = 3_600_000
  const day = 24 * hour
  const session = { expiresAt: new Date(2 * hour).toISOString() }
  const clock = { startedAt: 0, lastActiveAt: 0 }

  it('uses, refreshes or requires sign-in', () => {
    expect(sessionAction(session, clock, hour)).toBe('use')
    expect(sessionAction(session, clock, 2 * hour - 30_000)).toBe('refresh')
    expect(sessionAction(null, clock, 0)).toBe('sign-in-required')
    expect(sessionAction({ expiresAt: 'nope' }, clock, 0)).toBe('sign-in-required')
  })

  it('enforces maximum age and inactivity', () => {
    const far = { expiresAt: new Date(100 * day).toISOString() }
    expect(sessionAction(far, clock, 31 * day)).toBe('sign-in-required')
    expect(sessionAction(far, clock, 15 * day)).toBe('sign-in-required')
    expect(sessionAction(far, { startedAt: 0, lastActiveAt: 14 * day }, 15 * day)).toBe('use')
  })

  it('redacts tokens', () => {
    const redacted = redactSession({ accountId: 'u1', accessToken: 'secret-a', refreshToken: 'secret-r', expiresAt: 'x' })
    expect(JSON.stringify(redacted)).not.toContain('secret')
  })
})
