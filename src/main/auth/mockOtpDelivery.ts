import type { LoginIdentifier } from '../../shared/auth'
import { normalizeOtpToken } from './otpProvider'

export interface OtpDelivery {
  identifier: LoginIdentifier
  token: string
}

export interface OtpDeliveryAdapter {
  deliver(message: OtpDelivery): Promise<void>
}

class MockOtpDeliveryAdapter implements OtpDeliveryAdapter {
  private readonly delivered: OtpDelivery[] = []

  constructor(
    private readonly channel: LoginIdentifier['kind'],
    environment = process.env['NODE_ENV']
  ) {
    if (environment === 'production') throw new Error('Mock OTP delivery is disabled in production')
  }

  async deliver(message: OtpDelivery): Promise<void> {
    if (message.identifier.kind !== this.channel || normalizeOtpToken(message.token) === null) {
      throw new Error('Invalid mock OTP delivery')
    }
    this.delivered.push({ identifier: { ...message.identifier }, token: message.token })
  }

  takeAll(): OtpDelivery[] {
    return this.delivered.splice(0).map((message) => ({ identifier: { ...message.identifier }, token: message.token }))
  }
}

export class MockEmailOtpDelivery extends MockOtpDeliveryAdapter {
  constructor(environment?: string) {
    super('email', environment)
  }
}

export class MockSmsOtpDelivery extends MockOtpDeliveryAdapter {
  constructor(environment?: string) {
    super('phone', environment)
  }
}
