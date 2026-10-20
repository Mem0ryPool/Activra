import { useEffect, useState } from 'react'
import { resolveAppearance, type Appearance, type ResolvedAppearance } from '../../../shared/appearance'

const query = '(prefers-color-scheme: dark)'

/** Applies a light/dark choice to this page's <html>, following the OS live when set to 'system'. */
export function useAppearance(setting: Appearance): ResolvedAppearance {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = (): void => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  const resolved = resolveAppearance(setting, systemDark)
  useEffect(() => {
    document.documentElement.dataset.appearance = resolved
  }, [resolved])
  return resolved
}
