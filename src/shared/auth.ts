export type LoginIdentifier =
  | { kind: 'email'; value: string }
  | { kind: 'phone'; value: string }

export type LoginIdentifierError = 'required' | 'invalid-email' | 'invalid-phone' | 'unsupported-phone-country'

export type LoginIdentifierResult =
  | { ok: true; identifier: LoginIdentifier }
  | { ok: false; error: LoginIdentifierError }

const EMAIL_MAX_LENGTH = 254
const EMAIL_LOCAL_MAX_LENGTH = 64
const CN_MOBILE = /^1[3-9]\d{9}$/
const PHONE_CHARACTERS = /^[+\d\s()-]+$/

function parseEmail(value: string): LoginIdentifierResult {
  const parts = value.split('@')
  if (parts.length !== 2) return { ok: false, error: 'invalid-email' }
  const [local = '', domain = ''] = parts
  const labels = domain.split('.')
  const invalidLocalCharacter = [...local].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return /\s/u.test(character) || code <= 0x1f || code === 0x7f
  })
  const validLocal =
    local.length > 0 &&
    local.length <= EMAIL_LOCAL_MAX_LENGTH &&
    !local.startsWith('.') &&
    !local.endsWith('.') &&
    !local.includes('..') &&
    !invalidLocalCharacter
  const validDomain =
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        !label.startsWith('-') &&
        !label.endsWith('-') &&
        /^[\p{L}\p{N}-]+$/u.test(label)
    )
  if (value.length > EMAIL_MAX_LENGTH || !validLocal || !validDomain) {
    return { ok: false, error: 'invalid-email' }
  }
  // The provider remains authoritative for mailbox equivalence; only domains are case-insensitive here.
  return { ok: true, identifier: { kind: 'email', value: `${local}@${domain.toLowerCase()}` } }
}

/** Parses the future login field without contacting a provider. Phone sign-in is intentionally +86-only. */
export function parseLoginIdentifier(input: unknown): LoginIdentifierResult {
  if (typeof input !== 'string' || input.trim().length === 0) return { ok: false, error: 'required' }
  const value = input.trim()
  if (value.includes('@')) return parseEmail(value)
  if (!PHONE_CHARACTERS.test(value)) return { ok: false, error: 'invalid-phone' }

  const compact = value.replace(/[\s()-]/g, '')
  let national = compact
  if (compact.startsWith('+')) {
    if (!compact.startsWith('+86')) return { ok: false, error: 'unsupported-phone-country' }
    national = compact.slice(3)
  } else if (compact.startsWith('0086')) {
    national = compact.slice(4)
  } else if (compact.startsWith('86') && compact.length === 13) {
    national = compact.slice(2)
  }
  if (!CN_MOBILE.test(national)) return { ok: false, error: 'invalid-phone' }
  return { ok: true, identifier: { kind: 'phone', value: `+86${national}` } }
}

/**
 * Phase 5C: what the renderer may know about sign-in. No token, refresh token or OTP secret ever appears
 * here, except `developmentCode` in the development-only mock flow (no message is sent there).
 */
export type AuthMode =
  /** No provider is configured (hosted Supabase not approved yet): the app stays guest-only. */
  | 'unavailable'
  /** Development builds only: codes are generated locally and shown in the window; nothing is sent. */
  | 'development-mock'

export type AuthStatus =
  | { mode: AuthMode; state: 'signed-out' }
  | { mode: AuthMode; state: 'code-sent'; email: string; resendInSeconds: number }
  | { mode: AuthMode; state: 'signed-in'; email: string }

export type AuthRequestResult =
  | { status: 'code-sent'; auth: AuthStatus; developmentCode?: string }
  | { status: 'invalid-email' }
  /** +86 phone sign-in exists in the shared contract but is not offered yet. */
  | { status: 'channel-unavailable' }
  | { status: 'unavailable' }
  | { status: 'rate-limited'; retryAfterSeconds: number }
  | { status: 'temporarily-unavailable' }

export type AuthVerifyResult =
  | { status: 'signed-in'; auth: AuthStatus }
  | { status: 'invalid-code' }
  | { status: 'invalid-or-expired' }
  | { status: 'no-pending-code' }
  | { status: 'unavailable' }
  | { status: 'rate-limited'; retryAfterSeconds: number }
  | { status: 'temporarily-unavailable' }

/**
 * Phase 5C offers email only: input that parses as a phone number (or tries to) is answered "phone
 * sign-in is not available yet"; anything else that fails is an invalid email.
 */
export function parseEmailLogin(input: unknown): { ok: true; email: string } | { ok: false; error: 'required' | 'invalid-email' | 'phone-unavailable' } {
  const parsed = parseLoginIdentifier(input)
  if (parsed.ok) return parsed.identifier.kind === 'email' ? { ok: true, email: parsed.identifier.value } : { ok: false, error: 'phone-unavailable' }
  if (parsed.error === 'required') return { ok: false, error: 'required' }
  const phoneLike = typeof input === 'string' && PHONE_CHARACTERS.test(input.trim()) && /\d/.test(input)
  return { ok: false, error: phoneLike ? 'phone-unavailable' : 'invalid-email' }
}

/** Longest value accepted from the page for the login field (RFC 5321 path limit) and the code field. */
export const AUTH_INPUT_MAX_LENGTH = 320
