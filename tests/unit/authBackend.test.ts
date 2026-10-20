import { describe, expect, it } from 'vitest'
import { MockEmailOtpDelivery, MockSmsOtpDelivery } from '../../src/main/auth/mockOtpDelivery'
import {
  normalizeOtpToken,
  supabaseOtpRequest,
  supabaseOtpVerification
} from '../../src/main/auth/otpProvider'

const email = { kind: 'email' as const, value: 'person@example.com' }
const phone = { kind: 'phone' as const, value: '+8613800138000' }

describe('Supabase OTP contract', () => {
  it('maps one generic request to Supabase email or SMS OTP with automatic account creation', () => {
    expect(supabaseOtpRequest({ identifier: email, captchaToken: 'captcha' })).toEqual({
      email: email.value,
      options: { shouldCreateUser: true, captchaToken: 'captcha' }
    })
    expect(supabaseOtpRequest({ identifier: phone })).toEqual({
      phone: phone.value,
      options: { shouldCreateUser: true, channel: 'sms' }
    })
  })

  it('uses Supabase email and sms verification types and accepts only six-digit tokens', () => {
    expect(supabaseOtpVerification({ identifier: email, token: '123456' })).toEqual({
      email: email.value,
      token: '123456',
      type: 'email'
    })
    expect(supabaseOtpVerification({ identifier: phone, token: '654321' })).toEqual({
      phone: phone.value,
      token: '654321',
      type: 'sms'
    })
    expect(normalizeOtpToken(' 123456 ')).toBe('123456')
    expect(normalizeOtpToken('12345')).toBeNull()
    expect(normalizeOtpToken('12345x')).toBeNull()
  })
})

describe('development OTP delivery', () => {
  it('captures email and SMS in memory without contacting a provider', async () => {
    const emails = new MockEmailOtpDelivery('test')
    const messages = new MockSmsOtpDelivery('development')
    await emails.deliver({ identifier: email, token: '123456' })
    await messages.deliver({ identifier: phone, token: '654321' })
    expect(emails.takeAll()).toEqual([{ identifier: email, token: '123456' }])
    expect(messages.takeAll()).toEqual([{ identifier: phone, token: '654321' }])
    expect(emails.takeAll()).toEqual([])
  })

  it('rejects the wrong channel, invalid tokens, and production use', async () => {
    const emails = new MockEmailOtpDelivery('test')
    await expect(emails.deliver({ identifier: phone, token: '123456' })).rejects.toThrow('Invalid mock OTP delivery')
    await expect(emails.deliver({ identifier: email, token: '12345' })).rejects.toThrow('Invalid mock OTP delivery')
    expect(() => new MockSmsOtpDelivery('production')).toThrow('disabled in production')
  })
})
