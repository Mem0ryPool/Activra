import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('development IPC sender trust', () => {
  it('accepts the development server but rejects a URL that only shares its text prefix', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    const { isTrustedUrl } = await import('../../src/main/paths')

    expect(isTrustedUrl('http://localhost:5173/index.html')).toBe(true)
    expect(isTrustedUrl('http://localhost:5173@evil.example/index.html')).toBe(false)
  })
})
