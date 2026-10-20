import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { UndoToasts } from './components/UndoToasts'
import { HabitNoticeToast } from './habits/HabitNoticeToast'
import { AchievementsPage } from './pages/AchievementsPage'
import { PlansPage } from './pages/PlansPage'
import { HabitsPage } from './pages/HabitsPage'
import { FocusPage } from './pages/FocusPage'
import { CalendarPage } from './pages/CalendarPage'
import { FocusMode } from './focus/FocusMode'
import { SettingsPage } from './pages/SettingsPage'
import { StatisticsPage } from './pages/StatisticsPage'
import { TasksPage } from './pages/TasksPage'
import { ThemesPage } from './pages/ThemesPage'
import { useAppearance } from './hooks/useAppearance'
import { useAppStore } from './store/appStore'

export function App(): React.JSX.Element {
  const ready = useAppStore((s) => s.ready)
  const page = useAppStore((s) => s.page)
  const init = useAppStore((s) => s.init)
  useAppearance(useAppStore((s) => s.settings.appearance))
  const t = useAppStore((s) => s.t)
  const undoToasts = useAppStore((s) => s.undoToasts)
  const undoCompletion = useAppStore((s) => s.undoCompletion)
  const dismissUndoToast = useAppStore((s) => s.dismissUndoToast)
  const habitNotice = useAppStore((s) => s.habitNotice)
  const focusMode = useAppStore((s) => s.focusMode)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="flex h-full">
      {/* Focus mode covers the window; what is under it cannot be reached by Tab or a screen reader meanwhile. */}
      <div className="contents" inert={ready && focusMode}>
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {!ready ? (
            <div className="drag h-10 shrink-0" />
          ) : page === 'tasks' ? (
            <TasksPage />
          ) : page === 'plans' ? (
            <PlansPage />
          ) : page === 'habits' ? (
            <HabitsPage />
          ) : page === 'focus' ? (
            <FocusPage />
          ) : page === 'calendar' ? (
            <CalendarPage />
          ) : page === 'achievements' ? (
            <AchievementsPage />
          ) : page === 'themes' ? (
            <ThemesPage />
          ) : page === 'statistics' ? (
            <StatisticsPage />
          ) : (
            <SettingsPage />
          )}
        </main>
      </div>
      {ready && focusMode && <FocusMode />}
      <HabitNoticeToast notice={habitNotice} t={t} />
      <UndoToasts
        entries={undoToasts}
        t={t}
        onUndo={(id) => void undoCompletion(id).catch((error) => console.error('[Undo] Failed', error))}
        onDismiss={dismissUndoToast}
      />
    </div>
  )
}
