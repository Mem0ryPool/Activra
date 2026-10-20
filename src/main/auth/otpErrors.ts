export type OtpFailure =
  | { status: 'rate-limited'; retryAfterSeconds: number }
  | { status: 'invalid-or-expired' }
  | { status: 'temporarily-unavailable' }

const DEFAULT_RETRY_SECONDS = 60
const MAX_RETRY_SECONDS = 3600
const RATE_LIMIT_CODES = new Set(['over_request_rate_limit', 'over_email_send_rate_limit', 'over_sms_send_rate_limit'])
const REJECTED_CODES = new Set(['otp_expired', 'otp_disabled', 'invalid_credentials'])
const REJECTED_STATUSES = new Set([400, 401, 403, 422])

/** Provider-shaped error; only status/code are read, never the message (it may echo recipients). */
type ProviderErrorLike = { status?: unknown; code?: unknown }

function retrySeconds(value: unknown): number {
  const seconds = typeof value === 'number' && Number.isFinite(value) ? Math.ceil(value) : DEFAULT_RETRY_SECONDS
  return Math.min(Math.max(seconds, 1), MAX_RETRY_SECONDS)
}

/**
 * Collapses any provider failure to three public outcomes. Wrong, expired, reused and unknown-account
 * verification all become `invalid-or-expired`; unknown errors fail closed as `temporarily-unavailable`.
 */
export function mapOtpError(error: unknown, retryAfterSeconds?: number): OtpFailure {
  const { status, code } = (typeof error === 'object' && error !== null ? error : {}) as ProviderErrorLike
  if (status === 429 || (typeof code === 'string' && RATE_LIMIT_CODES.has(code))) {
    return { status: 'rate-limited', retryAfterSeconds: retrySeconds(retryAfterSeconds) }
  }
  if ((typeof code === 'string' && REJECTED_CODES.has(code)) || (typeof status === 'number' && REJECTED_STATUSES.has(status))) {
    return { status: 'invalid-or-expired' }
  }
  return { status: 'temporarily-unavailable' }
}
