import type { AchievementApi, LifeUnlockedApi, WidgetApi } from '../shared/ipc'

declare global {
  interface Window {
    lifeUnlocked: LifeUnlockedApi
    achievement: AchievementApi
    lifeUnlockedWidget: WidgetApi
  }
}

export {}
