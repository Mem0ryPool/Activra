import { CheckCircle2, Crown, Flame, Timer, Trophy } from 'lucide-react'
import { useMemo, type CSSProperties } from 'react'
import type { AchievementStyle } from '../../../shared/themes'
import type { AchievementVariant } from '../../../shared/types'
import { ACHIEVEMENT_ICONS } from './icons'

interface Particle {
  dx: number
  dy: number
  size: number
  delay: number
  duration: number
}

const PARTICLE_COUNT = { none: 0, light: 10, heavy: 26 } as const

function makeParticles(level: AchievementStyle['particles'], seed: string): Particle[] {
  // Small deterministic PRNG so a re-render does not reshuffle a running animation.
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const rand = (): number => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
  return Array.from({ length: PARTICLE_COUNT[level] }, () => {
    if (level === 'light') {
      // Drift upward and outward.
      return {
        dx: (rand() - 0.3) * 120,
        dy: -30 - rand() * 50,
        size: 2 + rand() * 3,
        delay: 150 + rand() * 600,
        duration: 1200 + rand() * 900
      }
    }
    // Radial burst.
    const angle = rand() * Math.PI * 2
    const distance = 50 + rand() * 90
    return {
      dx: Math.cos(angle) * distance * 1.4,
      dy: Math.sin(angle) * distance * 0.7,
      size: 2 + rand() * 4,
      delay: 120 + rand() * 220,
      duration: 900 + rand() * 700
    }
  })
}

export interface AchievementCardProps {
  id: string
  heading: string
  taskTitle: string
  /** End of `taskTitle` kept visible when a long name is shortened (" · 第2/4次"). */
  titleSuffix?: string
  /** A short muted third line (a habit goal met again: its reward was already given). */
  detail?: string
  style: AchievementStyle
  /** 'live' animates (notification window); 'static' is a still preview (Themes page). */
  mode: 'live' | 'static'
  leaving?: boolean
  /**
   * Absent: one task completion. 'summary': a burst summary lists several names, so its text may use
   * two lines. 'goal': a plan goal or a habit milestone. 'habit-record' / 'habit-goal': a habit's new record (flame) or weekly goal (gold). 'plan': a plan's "All achievements!", drawn with a restrained gold frame and a crown.
   */
  variant?: AchievementVariant
}

export function AchievementCard({ id, heading, taskTitle, titleSuffix, detail, style, mode, leaving, variant }: AchievementCardProps): React.JSX.Element {
  const Icon = ACHIEVEMENT_ICONS[style.icon]
  const live = mode === 'live'
  const particles = useMemo(() => (live ? makeParticles(style.particles, id) : []), [live, style.particles, id])
  const fromLeft = style.position.endsWith('left')

  return (
    <div
      className="ach-wrap"
      data-theme={style.themeId}
      data-animation={style.animation}
      data-mode={mode}
      data-side={fromLeft ? 'left' : 'right'}
      data-leaving={leaving ? 'true' : undefined}
      data-variant={variant}
      style={{ '--accent': style.accentColor, '--duration': `${style.durationMs}ms` } as CSSProperties}
    >
      <div className="ach-card" data-testid="achievement-card">
        <div className="ach-shimmer" />
        <div className="ach-icon">
          <span className="ach-icon-ring" />
          {style.iconUrl ? (
            <img src={style.iconUrl} alt="" draggable={false} className="ach-icon-img" />
          ) : (
            <Icon size={28} strokeWidth={2} />
          )}
          {variant === 'habit-record' && (
            <span className="ach-master-badge ach-habit-badge" data-testid="achievement-habit-badge">
              <Flame size={12} strokeWidth={2.5} />
            </span>
          )}
          {variant === 'habit-goal' && (
            <span className="ach-master-badge ach-habit-badge" data-testid="achievement-habit-badge">
              <Trophy size={12} strokeWidth={2.5} />
            </span>
          )}
          {variant === 'habit-claimed' && (
            <span className="ach-master-badge ach-habit-badge" data-testid="achievement-habit-badge">
              <CheckCircle2 size={12} strokeWidth={2.5} />
            </span>
          )}
          {variant === 'focus' && (
            <span className="ach-master-badge ach-habit-badge" data-testid="achievement-focus-badge">
              <Timer size={12} strokeWidth={2.5} />
            </span>
          )}
          {variant === 'plan' && (
            <span className="ach-master-badge" data-testid="achievement-master-badge">
              <Crown size={12} strokeWidth={2.5} />
            </span>
          )}
        </div>
        <div className="ach-text">
          <p className="ach-heading">{heading}</p>
          {titleSuffix && taskTitle.endsWith(titleSuffix) ? (
            // A timed plan step: only the task name is shortened, "· 第2/4次" always stays readable.
            <p className="ach-title ach-title-split" title={taskTitle} aria-label={taskTitle}>
              <span className="ach-title-name">{taskTitle.slice(0, taskTitle.length - titleSuffix.length)}</span>
              <span className="ach-title-suffix">{titleSuffix}</span>
            </p>
          ) : (
            <p className="ach-title" title={taskTitle}>
              {taskTitle}
            </p>
          )}
          {detail && (
            <p className="ach-detail" title={detail} data-testid="achievement-detail">
              {detail}
            </p>
          )}
        </div>
        {live && <div className="ach-progress" />}
      </div>
      {particles.length > 0 && (
        <div className="ach-particles" aria-hidden="true">
          {particles.map((p, i) => (
            <span
              key={i}
              style={
                {
                  '--dx': `${p.dx}px`,
                  '--dy': `${p.dy}px`,
                  '--size': `${p.size}px`,
                  animationDelay: `${p.delay}ms`,
                  animationDuration: `${p.duration}ms`
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
