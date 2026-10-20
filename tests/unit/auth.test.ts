import { describe, expect, it } from 'vitest'
import { parseLoginIdentifier } from '../../src/shared/auth'

describe('parseLoginIdentifier', () => {
  it('accepts one email entry and normalizes only its case-insensitive domain', () => {
    expect(parseLoginIdentifier(' User+tag@Example.COM ')).toEqual({
      ok: true,
      identifier: { kind: 'email', value: 'User+tag@example.com' }
    })
    expect(parseLoginIdentifier('用户@例子.公司')).toEqual({
      ok: true,
      identifier: { kind: 'email', value: '用户@例子.公司' }
    })
  })

  it.each(['a@localhost', '.a@example.com', 'a..b@example.com', 'a@-example.com', 'a@@example.com']) (
    'rejects malformed email %s',
    (value) => expect(parseLoginIdentifier(value)).toEqual({ ok: false, error: 'invalid-email' })
  )

  it.each([
    ['13800138000', '+8613800138000'],
    ['+86 138-0013-8000', '+8613800138000'],
    ['0086 (138) 0013 8000', '+8613800138000'],
    ['86 13800138000', '+8613800138000']
  ])('normalizes mainland phone %s to E.164', (value, expected) => {
    expect(parseLoginIdentifier(value)).toEqual({ ok: true, identifier: { kind: 'phone', value: expected } })
  })

  it('rejects unsupported countries, malformed numbers, and missing values', () => {
    expect(parseLoginIdentifier('+1 202 555 0123')).toEqual({ ok: false, error: 'unsupported-phone-country' })
    expect(parseLoginIdentifier('12800138000')).toEqual({ ok: false, error: 'invalid-phone' })
    expect(parseLoginIdentifier('1380013800x')).toEqual({ ok: false, error: 'invalid-phone' })
    expect(parseLoginIdentifier('  ')).toEqual({ ok: false, error: 'required' })
    expect(parseLoginIdentifier(null)).toEqual({ ok: false, error: 'required' })
  })
})
