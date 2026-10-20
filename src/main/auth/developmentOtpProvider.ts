import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { LoginIdentifier } from '../../shared/auth'
import type { Clock } from './otpGuards'
import { MockEmailOtpDelivery } from './mockOtpDelivery'
import type { OtpAuthProvider, OtpRequestInput, OtpRequestResult, OtpVerifyInput, OtpVerifyResult } from './otpProvider'

const CODE_TTL_MS = 10 * 60_000
const SESSION_TTL_MS = 24 * 3_600_000

type Pending = { key: string; code: string; expiresAt: number }

/**
 * Development-only stand-in for Supabase Auth (Phase 5C). It generates the code locally, "delivers" it to
 * the in-memory MockEmailOtpDelivery (which refuses NODE_ENV=production) and issues a fake session. It
 * makes no network call, sends no message and supports email only. Codes are single use and expire.
 */
export class DevelopmentOtpProvider implements OtpAuthProvider {
  readonly delivery: MockEmailOtpDelivery
  private readonly pepper = randomBytes(32)
  private pending: Pending | null = null

  constructor(
    private readonly now: Clock = Date.now,
    environment?: string
  ) {
    this.delivery = new MockEmailOtpDelivery(environment)
  }

  private key(identifier: LoginIdentifier): string {
    return createHmac('sha256', this.pepper).update(`${identifier.kind}:${identifier.value}`).digest('hex')
  }

  async request({ identifier }: OtpRequestInput): Promise<OtpRequestResult> {
    if (identifier.kind !== 'email') return { status: 'temporarily-unavailable' }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    this.pending = { key: this.key(identifier), code, expiresAt: this.now() + CODE_TTL_MS }
    await this.delivery.deliver({ identifier, token: code })
    return { status: 'accepted', retryAfterSeconds: 60 }
  }

  async verify({ identifier, token }: OtpVerifyInput): Promise<OtpVerifyResult> {
    const pending = this.pending
    if (!pending || pending.key !== this.key(identifier) || this.now() >= pending.expiresAt) {
      return { status: 'invalid-or-expired' }
    }
    const matches = token.length === pending.code.length && timingSafeEqual(Buffer.from(token), Buffer.from(pending.code))
    if (!matches) return { status: 'invalid-or-expired' }
    this.pending = null
    const accountHash = createHmac('sha256', 'activra-development-account').update(identifier.value).digest('hex')
    return {
      status: 'verified',
      session: {
        accountId: `dev-${accountHash.slice(0, 32)}`,
        accessToken: randomBytes(32).toString('base64url'),
        refreshToken: randomBytes(32).toString('base64url'),
        expiresAt: new Date(this.now() + SESSION_TTL_MS).toISOString()
      }
    }
  }
}
