import type { LanguageSetting, Locale } from '../types'
import { en, type TranslationKey } from './en'
import { zhCN } from './zh-CN'

export type { TranslationKey }

const dictionaries: Record<Locale, Record<TranslationKey, string>> = { en, 'zh-CN': zhCN }

/** Maps an OS locale such as "zh-Hans-CN" or "en-US" to a supported locale. */
export function matchLocale(systemLocale: string | undefined): Locale {
  return systemLocale?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function resolveLocale(setting: LanguageSetting, systemLocale: Locale): Locale {
  return setting === 'system' ? systemLocale : setting
}

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

export function createTranslator(locale: Locale): Translate {
  const dict = dictionaries[locale]
  return (key, params) => {
    const template = dict[key] ?? en[key]
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match
    )
  }
}
