import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AssetStore, sniffFormat } from '../../src/main/assets'
import { DEFAULT_SETTINGS } from '../../src/shared/constants'
import { DEFAULT_CUSTOM_THEME, resolveAchievementStyle } from '../../src/shared/themes'
import { ValidationError, validateCustomTheme, validateSettingsPatch, validateTaskInput } from '../../src/shared/validation'

const ASSET = '6f1c2b8e-1d2a-4f3b-9c4d-123456789abc.png'
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const WAV = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WAVEfmt ')

describe('resolveAchievementStyle', () => {
  it('defaults to Legendary with heavy particles and the bright chime', () => {
    expect(DEFAULT_SETTINGS.achievementTheme).toBe('legendary')
    const style = resolveAchievementStyle('legendary', DEFAULT_SETTINGS, DEFAULT_CUSTOM_THEME)
    expect(style).toMatchObject({ particles: 'heavy', sound: 'bright', animation: 'burst', durationMs: 5000, volume: 0.7 })
  })

  it('a new Custom theme starts with the bright chime and the burst animation', () => {
    expect(resolveAchievementStyle('custom', DEFAULT_SETTINGS, DEFAULT_CUSTOM_THEME)).toMatchObject({
      sound: 'bright',
      soundUrl: null,
      animation: 'burst',
      particles: 'heavy'
    })
  })

  it('built-in themes follow the global position, duration and volume', () => {
    const global = { notificationDurationSec: 4, notificationVolume: 0, notificationPosition: 'top-left' as const }
    expect(resolveAchievementStyle('classic', global, DEFAULT_CUSTOM_THEME)).toMatchObject({
      position: 'top-left',
      durationMs: 4000,
      volume: 0,
      particles: 'none'
    })
  })

  it('Custom uses its own options and imported assets', () => {
    const custom = {
      ...DEFAULT_CUSTOM_THEME,
      icon: 'imported' as const,
      iconAssetId: ASSET,
      sound: 'none' as const,
      position: 'top-right' as const,
      durationSec: 9,
      volume: 40,
      animation: 'slide' as const
    }
    expect(resolveAchievementStyle('custom', DEFAULT_SETTINGS, custom)).toMatchObject({
      iconUrl: `lu-asset://asset/${ASSET}`,
      sound: 'none',
      soundUrl: null,
      position: 'top-right',
      durationMs: 9000,
      volume: 0.4,
      particles: 'none'
    })
  })
})

describe('theme validation', () => {
  it('accepts a valid custom theme and normalizes the color', () => {
    expect(validateCustomTheme({ ...DEFAULT_CUSTOM_THEME, accentColor: '#AABBCC' }).accentColor).toBe('#aabbcc')
  })

  it.each([
    [{ accentColor: 'red' }],
    [{ accentColor: '#fff' }],
    [{ icon: 'skull' }],
    [{ icon: 'imported', iconAssetId: null }],
    [{ sound: 'imported', soundAssetId: null }],
    [{ iconAssetId: '../../../etc/passwd' }],
    [{ iconAssetId: `${ASSET}.exe` }],
    [{ animation: 'spin' }],
    [{ position: 'center' }],
    [{ durationSec: 60 }],
    [{ volume: -1 }],
    [{ extra: 1 }]
  ])('rejects %j', (patch) => {
    expect(() => validateCustomTheme({ ...DEFAULT_CUSTOM_THEME, ...patch })).toThrow(ValidationError)
  })

  it('validates theme ids in settings and tasks', () => {
    expect(validateSettingsPatch({ achievementTheme: 'classic' })).toEqual({ achievementTheme: 'classic' })
    expect(() => validateSettingsPatch({ achievementTheme: 'gold' })).toThrow(ValidationError)
    expect(validateTaskInput({ title: 'x', themeOverride: 'enhanced' }).themeOverride).toBe('enhanced')
    expect(() => validateTaskInput({ title: 'x', themeOverride: 'gold' })).toThrow(ValidationError)
  })
})

describe('assets', () => {
  it('detects formats from file contents', () => {
    expect(sniffFormat(PNG)).toBe('png')
    expect(sniffFormat(WAV)).toBe('wav')
    expect(sniffFormat(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
    expect(sniffFormat(new TextEncoder().encode('MZ executable header'))).toBeNull()
  })

  it('imports by content type, rejects mismatches and oversize files, and only resolves its own ids', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lu-assets-'))
    const store = new AssetStore(path.join(dir, 'assets'))
    const png = path.join(dir, 'icon.png')
    const fakePng = path.join(dir, 'evil.png')
    const big = path.join(dir, 'big.wav')
    await writeFile(png, PNG)
    await writeFile(fakePng, 'not really an image at all')
    await writeFile(big, Buffer.concat([Buffer.from(WAV), Buffer.alloc(6 * 1024 * 1024)]))

    const ok = await store.import('icon', png)
    expect(ok.ok).toBe(true)
    expect(await store.import('icon', fakePng)).toEqual({ ok: false, reason: 'unsupported' })
    expect(await store.import('sound', png)).toEqual({ ok: false, reason: 'unsupported' })
    expect(await store.import('sound', big)).toEqual({ ok: false, reason: 'too-large' })

    if (!ok.ok) throw new Error('unreachable')
    expect(ok.assetId).toMatch(/\.png$/)
    expect(store.resolve(ok.assetId)?.mime).toBe('image/png')
    expect(store.resolve('../secret.png')).toBeNull()
    await store.remove(ok.assetId)
    expect(await readdir(path.join(dir, 'assets'))).toEqual([])
  })
})

describe('the removed Activra Chime', () => {
  it('a saved Custom theme that used it keeps its other choices and plays the bright chime', async () => {
    const { validateSettingsPatch } = await import('../../src/shared/validation')
    const saved = { ...DEFAULT_CUSTOM_THEME, accentColor: '#ef4444', icon: 'flame', sound: 'chime' }
    expect(validateSettingsPatch({ customTheme: saved }).customTheme).toMatchObject({ sound: 'bright', accentColor: '#ef4444', icon: 'flame' })
  })
})
