import type { LoginIdentifier } from '../../shared/auth'

export type OtpRequestInput = {
  identifier: LoginIdentifier
  captchaToken?: string
}

export type OtpVerifyInput = {
  identifier: LoginIdentifier
  token: string
}

export type OtpRequestResult =
  | { status: 'accepted'; retryAfterSeconds: number }
  | { status: 'rate-limited'; retryAfterSeconds: number }
  | { status: 'temporarily-unavailable' }

export type OtpVerifyResult =
  | { status: 'verified'; session: OtpSession }
  | { status: 'invalid-or-expired' }
  | { status: 'rate-limited'; retryAfterSeconds: number }
  | { status: 'temporarily-unavailable' }

/** Main-process only. These values must never cross the preload boundary or enter logs. */
export interface OtpSession {
  accountId: string
  accessToken: string
  refreshToken: string
  expiresAt: string
}

export interface OtpAuthProvider {
  request(input: OtpRequestInput): Promise<OtpRequestResult>
  verify(input: OtpVerifyInput): Promise<OtpVerifyResult>
}

type SupabaseOtpOptions = { shouldCreateUser: true; captchaToken?: string }

export type SupabaseOtpRequest =
  | { email: string; options: SupabaseOtpOptions }
  | { phone: string; options: SupabaseOtpOptions & { channel: 'sms' } }

export type SupabaseOtpVerification =
  | { email: string; token: string; type: 'email' }
  | { phone: string; token: string; type: 'sms' }

export function normalizeOtpToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = value.trim()
  return /^\d{6}$/.test(token) ? token : null
}

/** Maps the provider-independent contract to Supabase Auth's supported signInWithOtp flow. */
export function supabaseOtpRequest(input: OtpRequestInput): SupabaseOtpRequest {
  const options: SupabaseOtpOptions = {
    shouldCreateUser: true,
    ...(input.captchaToken ? { captchaToken: input.captchaToken } : {})
  }
  return input.identifier.kind === 'email'
    ? { email: input.identifier.value, options }
    : { phone: input.identifier.value, options: { ...options, channel: 'sms' } }
}

/** Maps verification without implementing or storing OTP secrets in Activra. */
export function supabaseOtpVerification(input: OtpVerifyInput): SupabaseOtpVerification {
  return input.identifier.kind === 'email'
    ? { email: input.identifier.value, token: input.token, type: 'email' }
    : { phone: input.identifier.value, token: input.token, type: 'sms' }
}
