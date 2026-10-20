/**
 * Achievement theme model. Built-in themes are data, so a future theme is
 * one more entry here plus its CSS, without touching the notification pipeline.
 */

export const THEME_IDS = ['classic', 'enhanced', 'legendary', 'custom'] as const
export type ThemeId = (typeof THEME_IDS)[number]
export type BuiltInThemeId = Exclude<ThemeId, 'custom'>

export const BUILTIN_ICONS = ['trophy', 'star', 'crown', 'medal', 'flame', 'target'] as const
export type BuiltInIcon = (typeof BUILTIN_ICONS)[number]

export const BUILTIN_SOUNDS = ['soft', 'bright', 'fanfare'] as const
/** Removed built-in sounds and what a saved setting naming one plays instead. */
export const RETIRED_SOUNDS: Readonly<Record<string, BuiltInSound>> = { chime: 'bright' }
export type BuiltInSound = (typeof BUILTIN_SOUNDS)[number]

export const ANIMATIONS = ['fade', 'slide', 'pop', 'burst'] as const
export type AnimationStyle = (typeof ANIMATIONS)[number]

export const POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const
export type NotificationPosition = (typeof POSITIONS)[number]

export type ParticleLevel = 'none' | 'light' | 'heavy'

export interface CustomTheme {
  /** A built-in icon, or 'imported' to use `iconAssetId`. */
  icon: BuiltInIcon | 'imported'
  iconAssetId: string | null
  accentColor: string
  /** A built-in sound, 'imported' to use `soundAssetId`, or 'none' for silence. */
  sound: BuiltInSound | 'imported' | 'none'
  soundAssetId: string | null
  animation: AnimationStyle
  position: NotificationPosition
  durationSec: number
  /** 0–100 */
  volume: number
}

export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  icon: 'star',
  iconAssetId: null,
  accentColor: '#22c55e',
  sound: 'bright',
  soundAssetId: null,
  animation: 'burst',
  position: 'bottom-right',
  durationSec: 5,
  volume: 70
}

interface BuiltInThemeSpec {
  icon: BuiltInIcon
  accentColor: string
  sound: BuiltInSound
  animation: AnimationStyle
  particles: ParticleLevel
}

export const BUILTIN_THEMES: Record<BuiltInThemeId, BuiltInThemeSpec> = {
  classic: { icon: 'trophy', accentColor: '#e0b14a', sound: 'soft', animation: 'slide', particles: 'none' },
  enhanced: { icon: 'trophy', accentColor: '#3b82f6', sound: 'bright', animation: 'pop', particles: 'light' },
  legendary: { icon: 'crown', accentColor: '#f5b83d', sound: 'bright', animation: 'burst', particles: 'heavy' }
}

/** Everything the notification window needs to draw and play one achievement. */
export interface AchievementStyle {
  themeId: ThemeId
  icon: BuiltInIcon
  /** Set when a custom imported icon should replace the built-in one. */
  iconUrl: string | null
  accentColor: string
  sound: BuiltInSound | 'none'
  soundUrl: string | null
  animation: AnimationStyle
  particles: ParticleLevel
  position: NotificationPosition
  durationMs: number
  /** 0–1 */
  volume: number
}

export interface GlobalNotificationSettings {
  notificationDurationSec: number
  notificationVolume: number
  notificationPosition: NotificationPosition
}

export const ASSET_SCHEME = 'lu-asset'

export function assetUrl(assetId: string): string {
  return `${ASSET_SCHEME}://asset/${assetId}`
}

export function resolveAchievementStyle(
  themeId: ThemeId,
  global: GlobalNotificationSettings,
  custom: CustomTheme
): AchievementStyle {
  if (themeId === 'custom') {
    const importedIcon = custom.icon === 'imported' && custom.iconAssetId ? assetUrl(custom.iconAssetId) : null
    const importedSound = custom.sound === 'imported' && custom.soundAssetId ? assetUrl(custom.soundAssetId) : null
    return {
      themeId,
      icon: custom.icon === 'imported' ? 'trophy' : custom.icon,
      iconUrl: importedIcon,
      accentColor: custom.accentColor,
      sound: custom.sound === 'none' ? 'none' : custom.sound === 'imported' ? (importedSound ? 'soft' : 'none') : custom.sound,
      soundUrl: importedSound,
      animation: custom.animation,
      particles: custom.animation === 'burst' ? 'heavy' : 'none',
      position: custom.position,
      durationMs: custom.durationSec * 1000,
      volume: custom.volume / 100
    }
  }
  const spec = BUILTIN_THEMES[themeId]
  return {
    themeId,
    icon: spec.icon,
    iconUrl: null,
    accentColor: spec.accentColor,
    sound: spec.sound,
    soundUrl: null,
    animation: spec.animation,
    particles: spec.particles,
    position: global.notificationPosition,
    durationMs: global.notificationDurationSec * 1000,
    volume: global.notificationVolume / 100
  }
}
