import type { OtpSession } from './otpProvider'

export interface SessionPolicy {
  /** Refresh this long before the access token expires. */
  refreshSkewMs: number
  /** Signing in again is required this long after the session started (0 = no cap). */
  maxSessionMs: number
  /** Signing in again is required after this much inactivity (0 = no cap). */
  inactivityMs: number
}

const DAY_MS = 24 * 3_600_000

export const defaultSessionPolicy: SessionPolicy = {
  refreshSkewMs: 60_000,
  maxSessionMs: 30 * DAY_MS,
  inactivityMs: 14 * DAY_MS
}

export type SessionAction = 'use' | 'refresh' | 'sign-in-required'

export interface SessionClock {
  startedAt: number
  lastActiveAt: number
}

/** Decides what the main process must do before an authenticated call. Pure; no token is read or logged. */
export function sessionAction(
  session: Pick<OtpSession, 'expiresAt'> | null,
  clock: SessionClock,
  now: number,
  policy: SessionPolicy = defaultSessionPolicy
): SessionAction {
  if (!session) return 'sign-in-required'
  if (policy.maxSessionMs > 0 && now - clock.startedAt >= policy.maxSessionMs) return 'sign-in-required'
  if (policy.inactivityMs > 0 && now - clock.lastActiveAt >= policy.inactivityMs) return 'sign-in-required'
  const expiresAt = Date.parse(session.expiresAt)
  if (!Number.isFinite(expiresAt)) return 'sign-in-required'
  return expiresAt - now <= policy.refreshSkewMs ? 'refresh' : 'use'
}

/** Never serialize tokens: this is the only shape that may reach logs or the renderer. */
export function redactSession(session: OtpSession): { accountId: string; expiresAt: string } {
  return { accountId: session.accountId, expiresAt: session.expiresAt }
}
