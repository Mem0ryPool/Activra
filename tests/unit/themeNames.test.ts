import { describe, expect, it } from 'vitest'
import { createTranslator } from '../../src/shared/i18n'
import { THEME_IDS } from '../../src/shared/themes'

describe('theme display names', () => {
  it('are localized in Chinese', () => {
    const t = createTranslator('zh-CN')
    expect(THEME_IDS.map((id) => t(`theme.${id}`))).toEqual(['经典', '增强', '传奇', '自定义'])
    expect(t('custom.title')).toBe('自定义主题')
    expect(t('custom.hint')).not.toMatch(/Custom/)
    expect(t('settings.notifications.hint')).not.toMatch(/Classic|Enhanced|Legendary|Custom/)
  })

  it('stay in English in the English UI, with unchanged theme ids', () => {
    const t = createTranslator('en')
    expect(THEME_IDS).toEqual(['classic', 'enhanced', 'legendary', 'custom'])
    expect(THEME_IDS.map((id) => t(`theme.${id}`))).toEqual(['Classic', 'Enhanced', 'Legendary', 'Custom'])
    expect(t('custom.title')).toBe('Custom theme')
  })
})
