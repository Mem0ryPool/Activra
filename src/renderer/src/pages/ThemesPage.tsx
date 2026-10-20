import { Check, ImagePlus, Music, Play, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { NOTIFICATION_DURATION_MAX_SEC, NOTIFICATION_DURATION_MIN_SEC } from '../../../shared/constants'
import {
  ANIMATIONS,
  BUILTIN_ICONS,
  BUILTIN_SOUNDS,
  POSITIONS,
  THEME_IDS,
  assetUrl,
  resolveAchievementStyle,
  type AnimationStyle,
  type CustomTheme,
  type NotificationPosition,
  type ThemeId
} from '../../../shared/themes'
import type { AssetKind } from '../../../shared/types'
import { AchievementCard } from '../achievement/AchievementCard'
import { ACHIEVEMENT_ICONS } from '../achievement/icons'
import { Button } from '../components/Button'
import { PageHeader } from '../components/PageHeader'
import { RangeSetting, Row, Section, Select } from '../components/SettingsRows'
import { useAppStore, useT } from '../store/appStore'

const SWATCHES = ['#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#ef4444', '#f97316', '#f5b83d', '#14b8a6']

function ThemeTile({ themeId }: { themeId: ThemeId }): React.JSX.Element {
  const t = useT()
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const active = settings.achievementTheme === themeId
  const style = resolveAchievementStyle(themeId, settings, settings.customTheme)

  return (
    <div
      data-testid={`theme-${themeId}`}
      className={`flex flex-col overflow-hidden rounded-[var(--radius-card)] bg-card ring-1 transition-shadow ${
        active ? 'ring-2 ring-accent' : 'ring-ink/[0.05]'
      }`}
    >
      <div className="flex h-28 items-center justify-center bg-sidebar px-3">
        <div style={{ zoom: 0.68 }}>
          <AchievementCard
            id={`preview-${themeId}`}
            heading={t('achievement.unlocked')}
            taskTitle={t('themes.sampleTask')}
            style={style}
            mode="static"
          />
        </div>
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{t(`theme.${themeId}`)}</p>
          <p className="line-clamp-2 text-xs text-muted" title={t(`theme.${themeId}.desc`)}>
            {t(`theme.${themeId}.desc`)}
          </p>
        </div>
        <Button variant="ghost" className="px-2.5" onClick={() => void window.lifeUnlocked.achievements.test(themeId)}>
          <Play size={14} />
          {t('themes.preview')}
        </Button>
        {active ? (
          <span className="inline-flex h-9 items-center gap-1.5 px-1 text-sm font-medium text-accent">
            <Check size={15} strokeWidth={2.5} />
            {t('themes.inUse')}
          </span>
        ) : (
          <Button onClick={() => void updateSettings({ achievementTheme: themeId })}>{t('themes.use')}</Button>
        )}
      </div>
    </div>
  )
}

function CustomEditor(): React.JSX.Element {
  const t = useT()
  const custom = useAppStore((s) => s.settings.customTheme)
  const update = useAppStore((s) => s.updateCustomTheme)
  const [importError, setImportError] = useState<string | null>(null)

  const importAsset = async (kind: AssetKind): Promise<void> => {
    setImportError(null)
    const result = await window.lifeUnlocked.achievements.importAsset(kind)
    if (result.status === 'rejected') {
      setImportError(
        t(result.reason === 'too-large' ? 'custom.importRejected.tooLarge' : 'custom.importRejected.unsupported')
      )
    } else if (result.status === 'imported') {
      useAppStore.setState({ settings: result.settings })
    }
  }

  const iconButton = (active: boolean): string =>
    `flex size-9 items-center justify-center rounded-lg ring-1 transition-colors ${
      active ? 'bg-accent/15 text-fg ring-accent' : 'text-muted ring-line hover:bg-ink/5 hover:text-fg'
    }`

  const soundOptions: { value: CustomTheme['sound']; label: string }[] = [
    ...BUILTIN_SOUNDS.map((s) => ({ value: s, label: t(`sound.${s}`) })),
    ...(custom.soundAssetId ? [{ value: 'imported' as const, label: t('sound.imported') }] : []),
    { value: 'none', label: t('sound.none') }
  ]

  return (
    <Section title={t('custom.title')} hint={t('custom.hint')}>
      <Row label={t('custom.icon')}>
        <div className="flex flex-wrap items-center justify-end gap-1.5" role="radiogroup" aria-label={t('custom.icon')}>
          {BUILTIN_ICONS.map((icon) => {
            const Icon = ACHIEVEMENT_ICONS[icon]
            return (
              <button
                key={icon}
                type="button"
                role="radio"
                aria-checked={custom.icon === icon}
                title={t(`icon.${icon}`)}
                aria-label={t(`icon.${icon}`)}
                onClick={() => void update({ icon })}
                className={iconButton(custom.icon === icon)}
              >
                <Icon size={17} />
              </button>
            )
          })}
          {custom.iconAssetId && (
            <button
              type="button"
              role="radio"
              aria-checked={custom.icon === 'imported'}
              title={t('custom.importedIcon')}
              aria-label={t('custom.importedIcon')}
              onClick={() => void update({ icon: 'imported' })}
              className={iconButton(custom.icon === 'imported')}
            >
              <img src={assetUrl(custom.iconAssetId)} alt="" className="size-6 rounded object-contain" />
            </button>
          )}
          <Button className="ml-1" onClick={() => void importAsset('icon')}>
            <ImagePlus size={15} />
            {t('custom.importIcon')}
          </Button>
        </div>
      </Row>
      <Row label={t('custom.color')}>
        <div className="flex items-center gap-1.5">
          {SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              onClick={() => void update({ accentColor: color })}
              className={`size-6 rounded-full ring-offset-2 ring-offset-card ${
                custom.accentColor === color ? 'ring-2 ring-fg' : ''
              }`}
              style={{ background: color }}
            />
          ))}
          <input
            type="color"
            aria-label={t('custom.color')}
            value={custom.accentColor}
            onChange={(e) => void update({ accentColor: e.target.value })}
            className="ml-1 h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
          />
        </div>
      </Row>
      <Row label={t('custom.sound')}>
        <Select
          label={t('custom.sound')}
          value={custom.sound}
          options={soundOptions}
          onChange={(v) => void update({ sound: v as CustomTheme['sound'] })}
        />
        <Button onClick={() => void importAsset('sound')}>
          <Music size={15} />
          {t('custom.importSound')}
        </Button>
      </Row>
      {importError && <p className="px-4 py-2 text-sm text-red-400">{importError}</p>}
      <Row label={t('custom.animation')}>
        <Select
          label={t('custom.animation')}
          value={custom.animation}
          options={ANIMATIONS.map((a) => ({ value: a, label: t(`animation.${a}`) }))}
          onChange={(v) => void update({ animation: v as AnimationStyle })}
        />
      </Row>
      <Row label={t('custom.position')}>
        <Select
          label={t('custom.position')}
          value={custom.position}
          options={POSITIONS.map((p) => ({ value: p, label: t(`position.${p}`) }))}
          onChange={(v) => void update({ position: v as NotificationPosition })}
        />
      </Row>
      <Row label={t('custom.duration')}>
        <RangeSetting
          value={custom.durationSec}
          min={NOTIFICATION_DURATION_MIN_SEC}
          max={NOTIFICATION_DURATION_MAX_SEC}
          format={(v) => t('settings.notificationDuration.value', { seconds: v })}
          onCommit={(v) => void update({ durationSec: v })}
        />
      </Row>
      <Row label={t('custom.volume')}>
        <RangeSetting
          value={custom.volume}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          onCommit={(v) => void update({ volume: v })}
        />
      </Row>
    </Section>
  )
}

export function ThemesPage(): React.JSX.Element {
  const t = useT()
  return (
    <>
      <PageHeader
        title={t('nav.themes')}
        subtitle={t('themes.subtitle')}
        actions={
          <Button variant="primary" onClick={() => void window.lifeUnlocked.achievements.test()}>
            <Sparkles size={16} />
            {t('themes.test')}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        <div className="flex max-w-4xl flex-col gap-6">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3">
            {THEME_IDS.map((id) => (
              <ThemeTile key={id} themeId={id} />
            ))}
          </div>
          <CustomEditor />
        </div>
      </div>
    </>
  )
}
