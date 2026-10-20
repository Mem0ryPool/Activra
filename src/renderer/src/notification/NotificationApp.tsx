import { useEffect, useState } from 'react'
import type { AchievementPayload } from '../../../shared/types'
import { AchievementCard } from '../achievement/AchievementCard'
import { playAchievementSound, stopAchievementSound } from '../achievement/sounds'

const EXIT_MS = 320

export function NotificationApp(): React.JSX.Element | null {
  const [current, setCurrent] = useState<AchievementPayload | null>(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(
    () =>
      window.achievement.onShow((payload) => {
        setLeaving(false)
        setCurrent(payload)
        try {
          playAchievementSound(payload.style)
        } catch (error) {
          console.warn('Sound failed', error)
        }
      }),
    []
  )

  // Main ended the card (its time is up, or a newer habit feedback replaced it): nothing may keep sounding.
  useEffect(
    () =>
      window.achievement.onClear(() => {
        setCurrent(null)
        setLeaving(false)
        stopAchievementSound()
      }),
    []
  )

  useEffect(() => {
    if (!current) return
    const id = window.setTimeout(() => setLeaving(true), Math.max(0, current.style.durationMs - EXIT_MS))
    return () => window.clearTimeout(id)
  }, [current])

  if (!current) return null

  const { position } = current.style
  return (
    <div
      data-testid="achievement-toast"
      data-theme={current.style.themeId}
      data-variant={current.variant ?? 'single'}
      className={`flex h-full p-5 ${position.endsWith('left') ? 'justify-start' : 'justify-end'} ${
        position.startsWith('top') ? 'items-start' : 'items-end'
      }`}
    >
      <AchievementCard
        key={current.id}
        id={current.id}
        heading={current.heading}
        taskTitle={current.taskTitle}
        titleSuffix={current.titleSuffix}
        detail={current.detail}
        style={current.style}
        mode="live"
        leaving={leaving}
        variant={current.variant}
      />
    </div>
  )
}
