import { useAppStore } from '../store/appStore'

export function useFormatDate(): (iso: string) => string {
  const locale = useAppStore((s) => s.locale)
  return (iso) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}
