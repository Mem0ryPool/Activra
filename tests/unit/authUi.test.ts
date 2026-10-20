import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AuthService } from '../../src/main/auth/authService'
import { DevelopmentOtpProvider } from '../../src/main/auth/developmentOtpProvider'
import { AUTH_SESSION_FILE, AuthSessionStore, type SecretEncryptor } from '../../src/main/auth/sessionStore'

const root = path.resolve(__dirname, '../..')
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')

/** Stand-in for safeStorage: reversible, but never leaves the plain text in the output. */
const fakeEncryptor = (available = true): SecretEncryptor => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(`enc:${Buffer.from(plain).toString('hex')}`),
  decryptString: (encrypted) => {
    const text = encrypted.toString()
    if (!text.startsWith('enc:')) throw new Error('cannot decrypt')
    return Buffer.from(text.slice(4), 'hex').toString()
  }
})

async function setup(options: { available?: boolean; mode?: 'development-mock' | 'unavailable' } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'activra-auth-'))
  let now = Date.UTC(2026, 9, 18, 9, 0, 0)
  const clock = (): number => now
  const sessions = new AuthSessionStore(dir, fakeEncryptor(options.available ?? true))
  const provider = options.mode === 'unavailable' ? null : new DevelopmentOtpProvider(clock, 'test')
  const auth = new AuthService({
    mode: options.mode ?? 'development-mock',
    provider,
    sessions,
    now: clock,
    takeDevelopmentCode: () => provider?.delivery.takeAll().at(-1)?.token
  })
  return { dir, auth, sessions, clock, advance: (ms: number) => (now += ms) }
}

const wrongCode = (code: string): string => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

describe('Phase 5C optional sign-in (main process)', () => {
  it('without an approved provider stays guest-only and accepts nothing', async () => {
    const { auth, dir } = await setup({ mode: 'unavailable' })
    expect(await auth.status()).toEqual({ mode: 'unavailable', state: 'signed-out' })
    expect(await auth.requestCode('me@example.test')).toEqual({ status: 'unavailable' })
    expect(await auth.verifyCode('123456')).toEqual({ status: 'unavailable' })
    expect(await readdir(dir)).toEqual([])
  })

  it('validates the email in the main process and keeps +86 phone sign-in unavailable', async () => {
    const { auth } = await setup()
    for (const bad of ['', '   ', 'no-at-sign', 'a@b', 42, null, { email: 'x@y.z' }, `${'a'.repeat(320)}@example.test`]) {
      expect(await auth.requestCode(bad)).toEqual({ status: 'invalid-email' })
    }
    expect(await auth.requestCode('13800138000')).toEqual({ status: 'channel-unavailable' })
    expect(await auth.requestCode('+86 138 0013 8000')).toEqual({ status: 'channel-unavailable' })
    expect(await auth.requestCode('+1 415 555 0100')).toEqual({ status: 'channel-unavailable' })
    expect(await auth.status()).toEqual({ mode: 'development-mock', state: 'signed-out' })
  })

  it('goes signed-out → code-sent → signed-in with a mock code and returns no token to the page', async () => {
    const { auth } = await setup()
    const sent = await auth.requestCode('  Me@Example.TEST ')
    if (sent.status !== 'code-sent') throw new Error(sent.status)
    expect(sent.auth).toEqual({ mode: 'development-mock', state: 'code-sent', email: 'Me@example.test', resendInSeconds: 60 })
    expect(sent.developmentCode).toMatch(/^\d{6}$/)
    expect(await auth.verifyCode('12ab56')).toEqual({ status: 'invalid-code' })
    expect(await auth.verifyCode(wrongCode(sent.developmentCode!))).toEqual({ status: 'invalid-or-expired' })
    const verified = await auth.verifyCode(` ${sent.developmentCode} `)
    expect(verified).toEqual({ status: 'signed-in', auth: { mode: 'development-mock', state: 'signed-in', email: 'Me@example.test' } })
    expect(JSON.stringify(verified)).not.toMatch(/token|refresh|access/i)
    expect(await auth.verifyCode(sent.developmentCode)).toEqual({ status: 'no-pending-code' })
  })

  it('enforces the resend cooldown, verify lockout and code expiry', async () => {
    const { auth, advance } = await setup()
    const first = await auth.requestCode('me@example.test')
    if (first.status !== 'code-sent') throw new Error(first.status)
    advance(20_000)
    expect(await auth.status()).toMatchObject({ state: 'code-sent', resendInSeconds: 40 })
    expect(await auth.requestCode('me@example.test')).toEqual({ status: 'rate-limited', retryAfterSeconds: 40 })
    for (let i = 0; i < 5; i++) expect(await auth.verifyCode(wrongCode(first.developmentCode!))).toEqual({ status: 'invalid-or-expired' })
    expect(await auth.verifyCode(first.developmentCode)).toMatchObject({ status: 'rate-limited' })
    advance(60_000)
    const second = await auth.requestCode('me@example.test')
    if (second.status !== 'code-sent') throw new Error(second.status)
    advance(10 * 60_000)
    expect(await auth.verifyCode(second.developmentCode)).toEqual({ status: 'invalid-or-expired' })
  })

  it('stores the session only encrypted, restores it, signs out, and ends it when it expires', async () => {
    const { auth, dir, sessions, clock, advance } = await setup()
    const sent = await auth.requestCode('me@example.test')
    if (sent.status !== 'code-sent') throw new Error(sent.status)
    await auth.verifyCode(sent.developmentCode)
    const stored = await sessions.load()
    const onDisk = await readFile(path.join(dir, AUTH_SESSION_FILE), 'utf8')
    expect(onDisk).not.toContain(stored!.session.refreshToken)
    expect(onDisk).not.toContain(stored!.session.accessToken)
    expect(onDisk).not.toContain('me@example.test')

    const reopened = new AuthService({ mode: 'development-mock', provider: null, sessions: new AuthSessionStore(dir, fakeEncryptor()), now: clock })
    expect(await reopened.status()).toMatchObject({ state: 'signed-in', email: 'me@example.test' })

    advance(24 * 3_600_000)
    expect(await auth.status()).toEqual({ mode: 'development-mock', state: 'signed-out' })
    expect(await readdir(dir)).toEqual([])

    const again = await auth.requestCode('me@example.test')
    if (again.status !== 'code-sent') throw new Error(again.status)
    await auth.verifyCode(again.developmentCode)
    expect(await auth.signOut()).toEqual({ mode: 'development-mock', state: 'signed-out' })
    expect(await readdir(dir)).toEqual([])
  })

  it('never writes a session without OS encryption and drops an unreadable session file', async () => {
    const plain = await setup({ available: false })
    const sent = await plain.auth.requestCode('me@example.test')
    if (sent.status !== 'code-sent') throw new Error(sent.status)
    expect(await plain.auth.verifyCode(sent.developmentCode)).toMatchObject({ status: 'signed-in' })
    expect(await readdir(plain.dir)).toEqual([])

    const { dir, sessions } = await setup()
    await writeFile(path.join(dir, AUTH_SESSION_FILE), JSON.stringify({ version: 1, ciphertext: 'bm90IGVuY3J5cHRlZA==' }))
    expect(await sessions.load()).toBeNull()
    expect(await readdir(dir)).toEqual([])
  })

  it('the development mock refuses production', () => {
    expect(() => new DevelopmentOtpProvider(Date.now, 'production')).toThrow()
  })
})

describe('Phase 5C security boundaries', () => {
  it('the page gets five narrow auth calls on the main window only; the widget gets none', () => {
    const preload = read('src/preload/index.ts')
    expect(preload.match(/IpcChannels\.auth\w+/g)).toEqual([
      'IpcChannels.authStatus',
      'IpcChannels.authRequestCode',
      'IpcChannels.authVerifyCode',
      'IpcChannels.authCancel',
      'IpcChannels.authSignOut'
    ])
    expect(read('src/preload/widget.ts')).not.toMatch(/auth/i)
    expect(read('src/preload/notification.ts')).not.toMatch(/auth/i)
    const handlers = read('src/main/ipc/authHandlers.ts')
    expect(handlers.match(/handle\(IpcChannels\.auth\w+, \([^)]*\) => \(mainOnly\(event\.sender\)/g)).toHaveLength(5)
  })

  it('no token reaches the renderer or its storage, and sign-in never touches local data', () => {
    const renderer = read('src/renderer/src/components/AccountSection.tsx') + read('src/shared/auth.ts') + read('src/shared/ipc.ts')
    expect(renderer).not.toMatch(/accessToken|refreshToken|localStorage|sessionStorage|indexedDB/)
    for (const file of ['src/main/auth/authService.ts', 'src/main/auth/sessionStore.ts', 'src/main/ipc/authHandlers.ts']) {
      expect(read(file)).not.toMatch(/DataStore|FocusStore|dataStore|focusStore/)
    }
    // Installed builds never run the mock; it is created only for development runs.
    expect(read('src/main/index.ts')).toMatch(/if \(!app\.isPackaged\) \{\s+try \{\s+devOtp = new DevelopmentOtpProvider\(\)/)
  })
})
