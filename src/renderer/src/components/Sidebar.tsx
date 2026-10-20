import { BarChart3, CalendarDays, Flame, ListChecks, Palette, Settings, Sparkles, Timer, Trophy, type LucideIcon } from 'lucide-react'
import { formatCountdown } from '../../../shared/timer'
import { useFocusView } from '../focus/useFocusView'
import type { TranslationKey } from '../../../shared/i18n'
import activraIcon from '../assets/activra-icon.svg'
import { useAppStore, useT, type PageId } from '../store/appStore'

const items: { id: PageId; icon: LucideIcon; label: TranslationKey }[] = [
  { id: 'tasks', icon: ListChecks, label: 'nav.tasks' },
  { id: 'plans', icon: Sparkles, label: 'nav.plans' },
  { id: 'habits', icon: Flame, label: 'nav.habits' },
  { id: 'focus', icon: Timer, label: 'nav.focus' },
  { id: 'calendar', icon: CalendarDays, label: 'nav.calendar' },
  { id: 'achievements', icon: Trophy, label: 'nav.achievements' },
  { id: 'themes', icon: Palette, label: 'nav.themes' },
  { id: 'statistics', icon: BarChart3, label: 'nav.statistics' }
]

function NavButton({ id, icon: Icon, label }: (typeof items)[number]): React.JSX.Element {
  const t = useT()
  const active = useAppStore((s) => s.page === id)
  const setPage = useAppStore((s) => s.setPage)
  return (
    <button
      type="button"
      onClick={() => setPage(id)}
      aria-current={active ? 'page' : undefined}
      className={`no-drag relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
        active ? 'bg-ink/[0.07] font-medium text-fg' : 'text-muted hover:bg-ink/[0.04] hover:text-fg'
      }`}
    >
      {active && <span className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-accent" />}
      <Icon size={18} className={active ? 'text-accent' : ''} />
      <span className="truncate">{t(label)}</span>
      {id === 'focus' && <FocusNavTime />}
    </button>
  )
}

/** While a focus timer exists, its time stays visible from every page (paused: muted). */
function FocusNavTime(): React.JSX.Element | null {
  const view = useFocusView()
  if (!view.run) return null
  return (
    <span
      className={`ml-auto shrink-0 text-xs tabular-nums ${view.paused ? 'text-muted' : 'text-accent'}`}
      data-testid="focus-nav-time"
      data-state={view.paused ? 'paused' : 'running'}
    >
      {formatCountdown(view.remainingMs)}
    </span>
  )
}

export function Sidebar(): React.JSX.Element {
  const t = useT()
  return (
    <aside className="drag sidebar-top-pad flex w-56 shrink-0 flex-col border-r border-ink/[0.04] bg-sidebar">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <img src={activraIcon} alt="" width={32} height={32} className="size-8 shrink-0" draggable={false} />
        <span className="truncate text-[15px] font-semibold tracking-tight">{t('app.name')}</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 pt-2">
        {items.map((item) => (
          <NavButton key={item.id} {...item} />
        ))}
      </nav>
      <div className="px-3 pb-4">
        <NavButton id="settings" icon={Settings} label="nav.settings" />
      </div>
    </aside>
  )
}
