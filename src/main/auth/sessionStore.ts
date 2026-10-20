import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readJson, writeJsonAtomic } from '../storage/jsonFile'
import type { OtpSession } from './otpProvider'
import type { SessionClock } from './sessionPolicy'

/** Kept apart from the data file: signing in or out never touches tasks, settings or backups. */
export const AUTH_SESSION_FILE = 'auth-session.json'

/** The OS keychain/DPAPI wrapper (Electron `safeStorage`), injected so tests need no Electron. */
export interface SecretEncryptor {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface StoredAuthSession {
  session: OtpSession
  clock: SessionClock
  email: string
}

function isStored(value: unknown): value is StoredAuthSession {
  const v = value as StoredAuthSession | null
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.email === 'string' &&
    typeof v.session?.accountId === 'string' &&
    typeof v.session.accessToken === 'string' &&
    typeof v.session.refreshToken === 'string' &&
    typeof v.session.expiresAt === 'string' &&
    typeof v.clock?.startedAt === 'number' &&
    typeof v.clock.lastActiveAt === 'number'
  )
}

/**
 * Main-process session persistence (Phase 5C). The whole session, refresh token included, is written
 * only as OS-encrypted ciphertext. Without OS encryption the session lives in memory for this run and
 * is never written in plain text. An unreadable file is a lost sign-in, not lost data: it is removed.
 */
export class AuthSessionStore {
  private readonly file: string
  private memory: StoredAuthSession | null = null

  constructor(
    directory: string,
    private readonly encryptor: SecretEncryptor
  ) {
    this.file = path.join(directory, AUTH_SESSION_FILE)
  }

  async load(): Promise<StoredAuthSession | null> {
    if (this.memory) return this.memory
    if (!this.encryptor.isEncryptionAvailable()) return null
    const read = await readJson(this.file).catch(() => ({ kind: 'corrupt' as const }))
    if (read.kind === 'missing') return null
    try {
      const value = read.kind === 'ok' ? (read.value as { ciphertext?: unknown }) : null
      if (typeof value?.ciphertext !== 'string') throw new Error('bad file')
      const parsed: unknown = JSON.parse(this.encryptor.decryptString(Buffer.from(value.ciphertext, 'base64')))
      if (!isStored(parsed)) throw new Error('bad session')
      this.memory = parsed
      return parsed
    } catch {
      await this.clear()
      return null
    }
  }

  async save(stored: StoredAuthSession): Promise<void> {
    this.memory = stored
    if (!this.encryptor.isEncryptionAvailable()) return
    const ciphertext = this.encryptor.encryptString(JSON.stringify(stored)).toString('base64')
    await writeJsonAtomic(this.file, { version: 1, ciphertext })
  }

  async clear(): Promise<void> {
    this.memory = null
    await fs.rm(this.file, { force: true })
  }
}
