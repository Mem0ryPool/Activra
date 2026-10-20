import { createHmac } from 'node:crypto'
import type { LoginIdentifier } from '../../shared/auth'

export type Clock = () => number

export interface RateLimitPolicy {
  resendCooldownMs: number
  maxSendsPerHour: number
  maxVerifyAttempts: number
  backoffBaseMs: number
  backoffMaxMs: number
}

export const defaultRateLimitPolicy: RateLimitPolicy = {
  resendCooldownMs: 60_000,
  maxSendsPerHour: 5,
  maxVerifyAttempts: 5,
  backoffBaseMs: 30_000,
  backoffMaxMs: 3_600_000
}

export type LimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number }

const HOUR_MS = 3_600_000
const blocked = (ms: number): LimitDecision => ({ allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(ms / 1000)) })

/** Keys limiter state by HMAC(identifier) so raw emails/phones are never held as map keys. */
export function identifierKey(identifier: LoginIdentifier, pepper: string): string {
  return createHmac('sha256', pepper).update(`${identifier.kind}:${identifier.value}`).digest('hex')
}

type Entry = { sends: number[]; failures: number; lockedUntil: number; lockouts: number }

/** In-memory reference for the gateway limits; the server enforces the same rules authoritatively. */
export class OtpRateLimiter {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly policy: RateLimitPolicy = defaultRateLimitPolicy,
    private readonly now: Clock = Date.now
  ) {}

  private entry(key: string): Entry {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { sends: [], failures: 0, lockedUntil: 0, lockouts: 0 }
      this.entries.set(key, entry)
    }
    return entry
  }

  /** Checks and, when allowed, records one send. */
  checkSend(key: string): LimitDecision {
    const entry = this.entry(key)
    const now = this.now()
    entry.sends = entry.sends.filter((at) => now - at < HOUR_MS)
    const last = entry.sends[entry.sends.length - 1]
    if (last !== undefined && now - last < this.policy.resendCooldownMs) {
      return blocked(this.policy.resendCooldownMs - (now - last))
    }
    const first = entry.sends[0]
    if (first !== undefined && entry.sends.length >= this.policy.maxSendsPerHour) {
      return blocked(HOUR_MS - (now - first))
    }
    entry.sends.push(now)
    return { allowed: true }
  }

  checkVerify(key: string): LimitDecision {
    const lockedUntil = this.entry(key).lockedUntil
    const now = this.now()
    return now < lockedUntil ? blocked(lockedUntil - now) : { allowed: true }
  }

  /** A wrong code counts; reaching the cap locks out with exponential backoff (base * 2^n, capped). */
  recordVerifyFailure(key: string): void {
    const entry = this.entry(key)
    entry.failures += 1
    if (entry.failures < this.policy.maxVerifyAttempts) return
    const delay = Math.min(this.policy.backoffBaseMs * 2 ** entry.lockouts, this.policy.backoffMaxMs)
    entry.lockedUntil = this.now() + delay
    entry.lockouts += 1
    entry.failures = 0
  }

  recordVerifySuccess(key: string): void {
    this.entries.delete(key)
  }
}

/** Rejects a repeated request id (nonce) inside its time-to-live; ids are opaque and bounded. */
export class ReplayGuard {
  private readonly seen = new Map<string, number>()

  constructor(
    private readonly ttlMs = 300_000,
    private readonly now: Clock = Date.now,
    private readonly maxEntries = 10_000
  ) {}

  /** Returns true the first time an id is seen within the ttl; false on replay, malformed id or full table. */
  claim(id: unknown): boolean {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(id)) return false
    const now = this.now()
    for (const [key, at] of this.seen) {
      if (now - at < this.ttlMs) break
      this.seen.delete(key)
    }
    if (this.seen.has(id) || this.seen.size >= this.maxEntries) return false
    this.seen.set(id, now)
    return true
  }
}
