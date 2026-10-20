import { FolderOpen } from 'lucide-react'
import { APPEARANCES, type Appearance } from '../../../shared/appearance'
import { NOTIFICATION_DURATION_MAX_SEC, NOTIFICATION_DURATION_MIN_SEC } from '../../../shared/constants'
import {
  WIDGET_ANIMATIONS,
  WIDGET_OPACITY_MAX,
  WIDGET_OPACITY_MIN,
  WIDGET_SHAPES,
  type WidgetAnimation,
  type WidgetShape
} from '../../../shared/widget'
import { POSITIONS, type NotificationPosition } from '../../../shared/themes'
import type { CloseAction, LanguageSetting, ReminderSettings, WidgetSettings } from '../../../shared/types'
import { AccountSection } from '../components/AccountSection'
import { Button } from '../components/Button'
import { PageHeader } from '../components/PageHeader'
import { RangeSetting, Row, Section, Select, Toggle } from '../components/SettingsRows'
import { ShortcutSetting } from '../components/ShortcutSetting'
import { useAppStore, useT } from '../store/appStore'

export function SettingsPage(): React.JSX.Element {
  const t = useT()
  const settings = useAppStore((s) => s.settings)
  const appInfo = useAppStore((s) => s.appInfo)
  const updateSettings = useAppStore((s) => s.updateSettings)
  // macOS has a menu bar icon and its own notifications instead of the Windows tray and toasts.
  const mac = window.lifeUnlocked.platform === 'darwin'
  const updateWidget = (patch: Partial<WidgetSettings>): void =>
    void updateSettings({ widget: { ...settings.widget, ...patch } })
  const updateReminders = (patch: Partial<ReminderSettings>): void =>
    void updateSettings({ reminders: { ...settings.reminders, ...patch } })
  const reminderLabel = (m: number): string =>
    m === 0
      ? t('reminder.atTime')
      : m === 60
        ? t('reminder.hour')
        : m === 1440
          ? t('reminder.day')
          : t('reminder.minutes', { n: m })

  return (
    <>
      <PageHeader title={t('nav.settings')} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        <div className="flex max-w-2xl flex-col gap-6">
          <Section title={t('settings.general')}>
            <Row label={t('settings.language')}>
              <Select
                label={t('settings.language')}
                value={settings.language}
                options={[
                  { value: 'system', label: t('settings.language.system') },
                  { value: 'zh-CN', label: '简体中文' },
                  { value: 'en', label: 'English' }
                ]}
                onChange={(v) => void updateSettings({ language: v as LanguageSetting })}
              />
            </Row>
            <Row label={t('settings.closeAction')}>
              <Select
                label={t('settings.closeAction')}
                value={settings.closeAction}
                options={[
                  { value: 'tray', label: t(mac ? 'settings.closeAction.trayMac' : 'settings.closeAction.tray') },
                  { value: 'quit', label: t('settings.closeAction.quit') }
                ]}
                onChange={(v) => void updateSettings({ closeAction: v as CloseAction })}
              />
            </Row>
          </Section>

          <Section title={t('settings.appearance')} hint={t('settings.appearance.hint')}>
            <Row label={t('settings.appearance.app')}>
              <Select
                label={t('settings.appearance.app')}
                value={settings.appearance}
                options={APPEARANCES.map((a) => ({ value: a, label: t(`appearance.${a}`) }))}
                onChange={(v) => void updateSettings({ appearance: v as Appearance })}
              />
            </Row>
          </Section>

          <Section title={t('settings.notifications')} hint={t('settings.notifications.hint')}>
            <Row label={t('settings.notificationPosition')}>
              <Select
                label={t('settings.notificationPosition')}
                value={settings.notificationPosition}
                options={POSITIONS.map((p) => ({ value: p, label: t(`position.${p}`) }))}
                onChange={(v) => void updateSettings({ notificationPosition: v as NotificationPosition })}
              />
            </Row>
            <Row label={t('settings.notificationDuration')}>
              <RangeSetting
                value={settings.notificationDurationSec}
                min={NOTIFICATION_DURATION_MIN_SEC}
                max={NOTIFICATION_DURATION_MAX_SEC}
                format={(v) => t('settings.notificationDuration.value', { seconds: v })}
                onCommit={(v) => void updateSettings({ notificationDurationSec: v })}
              />
            </Row>
            <Row label={t('settings.notificationVolume')}>
              <RangeSetting
                value={settings.notificationVolume}
                min={0}
                max={100}
                format={(v) => `${v}%`}
                onCommit={(v) => void updateSettings({ notificationVolume: v })}
              />
            </Row>
          </Section>

          <Section title={t('settings.widget')} hint={t('settings.widget.hint')}>
            <Row label={t('settings.widget.visible')}>
              <Toggle
                label={t('settings.widget.visible')}
                checked={settings.widget.visible}
                onChange={(visible) => updateWidget({ visible })}
              />
            </Row>
            <ShortcutSetting />
            <Row label={t('settings.widget.alwaysOnTop')}>
              <Toggle
                label={t('settings.widget.alwaysOnTop')}
                checked={settings.widget.alwaysOnTop}
                onChange={(alwaysOnTop) => updateWidget({ alwaysOnTop })}
              />
            </Row>
            <Row label={t('settings.widget.appearance')}>
              <Select
                label={t('settings.widget.appearance')}
                value={settings.widget.appearance}
                options={APPEARANCES.map((a) => ({ value: a, label: t(`appearance.${a}`) }))}
                onChange={(v) => updateWidget({ appearance: v as Appearance })}
              />
            </Row>
            <Row label={t('settings.widget.shape')}>
              <Select
                label={t('settings.widget.shape')}
                value={settings.widget.shape}
                options={WIDGET_SHAPES.map((s) => ({ value: s, label: t(`widget.shape.${s}`) }))}
                onChange={(v) => updateWidget({ shape: v as WidgetShape })}
              />
            </Row>
            <Row label={t('settings.widget.opacity')} hint={t('settings.widget.opacity.hint')}>
              <RangeSetting
                label={t('settings.widget.opacity')}
                value={settings.widget.opacity}
                min={WIDGET_OPACITY_MIN}
                max={WIDGET_OPACITY_MAX}
                format={(v) => `${v}%`}
                onPreview={(v) => void window.lifeUnlocked.widget.previewOpacity(v)}
                onCommit={(opacity) => updateWidget({ opacity })}
              />
            </Row>
            <Row label={t('settings.widget.animation')} hint={t('settings.widget.animation.hint')}>
              <Select
                label={t('settings.widget.animation')}
                value={settings.widget.animation}
                options={WIDGET_ANIMATIONS.map((a) => ({ value: a, label: t(`widget.animation.${a}`) }))}
                onChange={(v) => updateWidget({ animation: v as WidgetAnimation })}
              />
            </Row>
          </Section>

          <Section
            title={t('settings.reminders')}
            hint={`${t(mac ? 'settings.reminders.hintMac' : 'settings.reminders.hint')} ${t('settings.reminders.catchUp')}`}
          >
            <Row label={t('settings.reminders.enabled')}>
              <Toggle
                label={t('settings.reminders.enabled')}
                checked={settings.reminders.enabled}
                onChange={(enabled) => updateReminders({ enabled })}
              />
            </Row>
            <Row label={t('settings.reminders.default')}>
              <Select
                label={t('settings.reminders.default')}
                value={settings.reminders.defaultMinutes === null ? 'none' : String(settings.reminders.defaultMinutes)}
                options={[
                  { value: 'none', label: t('reminder.none') },
                  ...[0, 5, 15, 30, 60, 1440].map((m) => ({ value: String(m), label: reminderLabel(m) })),
                  ...(settings.reminders.defaultMinutes !== null &&
                  ![0, 5, 15, 30, 60, 1440].includes(settings.reminders.defaultMinutes)
                    ? [{ value: String(settings.reminders.defaultMinutes), label: reminderLabel(settings.reminders.defaultMinutes) }]
                    : [])
                ]}
                onChange={(v) => updateReminders({ defaultMinutes: v === 'none' ? null : Number(v) })}
              />
            </Row>
            <Row label={t('settings.reminders.allDayTime')}>
              <input
                type="time"
                aria-label={t('settings.reminders.allDayTime')}
                value={settings.reminders.allDayTime}
                onChange={(e) => e.target.value && updateReminders({ allDayTime: e.target.value })}
                className="h-9 rounded-lg bg-app px-3 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-accent"
              />
            </Row>
            <Row label={t('settings.reminders.sound')}>
              <Toggle
                label={t('settings.reminders.sound')}
                checked={settings.reminders.sound}
                onChange={(sound) => updateReminders({ sound })}
              />
            </Row>
          </Section>

          <AccountSection />

          <Section title={t('settings.data')}>
            <Row label={t('settings.dataLocation')} hint={appInfo?.dataDirectory}>
              <Button onClick={() => void window.lifeUnlocked.app.openDataDirectory()}>
                <FolderOpen size={15} />
                {t('settings.openDataFolder')}
              </Button>
            </Row>
          </Section>

          <Section title={t('settings.about')}>
            <Row label={t('app.name')} hint={t('app.tagline')}>
              <span className="text-sm text-muted">
                {t('settings.version')} {appInfo?.version}
              </span>
            </Row>
          </Section>
        </div>
      </div>
    </>
  )
}
