import type { Translate } from '../i18n'
import type { AchievementStyle } from '../themes'
import { dayKey } from '../dates'
import { addDays } from '../recurrence'
import { habitStreak, isCountedCheckin, reachedMilestone, weekStartOf } from './streak'
import type { Habit, HabitCheckin } from './types'

/**
 * What one successful check-in is answered with (Phase 6.6.1, 6.6.2c). Only one feedback per
 * check-in; the highest level that applies wins and the others at most add a line to the same card:
 *
 * 1. 'weekly-goal': a weekly habit's counted check-ins this week just went from below the target to it.
 * 2. 'record': the current streak just went past the longest streak there was before this check-in
 *    (there must have been one of at least 1; the very first check-in is not a record).
 * 3. 'milestone': the streak reached one of the milestones (Phase 6.6) without beating the record.
 * 4. 'checkin': none of the above; the light card.
 *
 * 'claimed' (Phase 6.6.2c): the check-in reaches one of 1–3 again in the same period after an
 * earlier check-in already reached it and was cancelled (the week for a weekly goal, the check-in's
 * day for a record or milestone). The celebration is not repeated; a quiet card says the goal is met
 * and its reward was already given for that period. Whether it was already reached is replayed from
 * the stored check-in records (each keeps when it was made and when it was cancelled), so it is the
 * same after a restart, and nothing new is stored. A plain check-in, or a cancel that leaves the goal
 * unmet, never says "claimed".
 *
 * Everything is derived from the check-in records, never from what the page shows. There are no
 * points or rewards to give out, and the data file is unchanged.
 */
export type HabitCelebration = 'weekly-goal' | 'record' | 'milestone'
export type HabitFeedbackLevel = HabitCelebration | 'claimed' | 'checkin'

export interface HabitFeedback {
  level: HabitFeedbackLevel
  /** For 'claimed': the celebration this period already had. */
  claimed: HabitCelebration | null
  /** Days for daily and custom habits, weeks for weekly ones. */
  unit: 'day' | 'week'
  /** The current streak after the check-in. */
  streak: number
  /** Whether the check-in set a new longest streak (also when a higher level is shown). */
  record: boolean
  /** The milestone reached, if any (also when a higher level is shown). */
  milestone: number | null
  /** Weekly habits: counted check-ins in the check-in's week, and the target. */
  week: { count: number; target: number } | null
}

function weekCount(habit: Habit, checkins: readonly HabitCheckin[], date: string): number {
  const start = weekStartOf(date)
  const end = addDays(start, 6)
  const days = new Set<string>()
  for (const c of checkins) {
    if (c.habitId === habit.id && isCountedCheckin(c) && c.date >= start && c.date <= end && c.date >= habit.startDate) days.add(c.date)
  }
  return days.size
}

/** What the check-in reaches on its own, before looking at earlier check-ins of the period. */
function reached(habit: Habit, before: readonly HabitCheckin[], after: readonly HabitCheckin[], checkin: HabitCheckin, today: string): HabitFeedback {
  const was = habitStreak(habit, before, today)
  const now = habitStreak(habit, after, today)
  const record = was.longest >= 1 && now.longest > was.longest && now.current === now.longest
  const milestone = reachedMilestone(habit, was.current, now.current)
  let week: HabitFeedback['week'] = null
  let goalReached = false
  if (habit.frequency.kind === 'weekly') {
    const target = habit.frequency.timesPerWeek
    const countBefore = weekCount(habit, before, checkin.date)
    const count = weekCount(habit, after, checkin.date)
    week = { count, target }
    goalReached = countBefore < target && count >= target
  }
  const level: HabitFeedbackLevel = goalReached ? 'weekly-goal' : record ? 'record' : milestone !== null ? 'milestone' : 'checkin'
  return { level, claimed: null, unit: now.unit, streak: now.current, record, milestone, week }
}

/** The records as they stood just before `at`: later check-ins left out, later cancels not yet made. */
function recordsAt(checkins: readonly HabitCheckin[], at: string): HabitCheckin[] {
  return checkins
    .filter((c) => c.checkedAt < at)
    .map((c) => (c.undoneAt !== null && c.undoneAt >= at ? { ...c, undoneAt: null } : c))
}

/** Whether a check-in made earlier in the same period (and cancelled since) already reached `level`. */
function alreadyReached(habit: Habit, before: readonly HabitCheckin[], checkin: HabitCheckin, feedback: HabitFeedback, level: HabitCelebration): boolean {
  const samePeriod =
    level === 'weekly-goal'
      ? (c: HabitCheckin): boolean => weekStartOf(c.date) === weekStartOf(checkin.date)
      : (c: HabitCheckin): boolean => c.date === checkin.date
  for (const earlier of before) {
    if (earlier.habitId !== habit.id || earlier.undoneAt === null || earlier.checkedAt > checkin.checkedAt || !samePeriod(earlier)) continue
    const then = recordsAt(before, earlier.checkedAt)
    const was = reached(habit, then, [...then, { ...earlier, undoneAt: null }], earlier, dayKey(new Date(earlier.checkedAt)))
    if (level === 'weekly-goal' && was.level === 'weekly-goal') return true
    if (level === 'record' && was.record && was.streak === feedback.streak) return true
    if (level === 'milestone' && was.milestone === feedback.milestone) return true
  }
  return false
}

/**
 * The feedback for `checkin`, just added to `after` (`before` is the list without it, cancelled
 * check-ins included). `today` is the local day the check-in was made on (it may be the day after
 * `checkin.date` just after midnight).
 */
export function habitCheckinFeedback(
  habit: Habit,
  before: readonly HabitCheckin[],
  after: readonly HabitCheckin[],
  checkin: HabitCheckin,
  today: string
): HabitFeedback {
  const feedback = reached(habit, before, after, checkin, today)
  if (feedback.level === 'checkin' || feedback.level === 'claimed') return feedback
  return alreadyReached(habit, before, checkin, feedback, feedback.level)
    ? { ...feedback, level: 'claimed', claimed: feedback.level }
    : feedback
}

export interface HabitFeedbackCard {
  heading: string
  /** The habit's name, with the secondary line (if any) at its end. */
  taskTitle: string
  /** The secondary line, kept readable when a long name is shortened. */
  titleSuffix?: string
  /** A short third line (the 'claimed' card says its reward was already given). */
  detail?: string
  variant: 'habit-goal' | 'habit-record' | 'goal' | 'habit-checkin' | 'habit-claimed'
}

/** How long the light check-in card stays (Phase 6.6.2b); goal, record and milestone cards keep the theme's time. */
export const HABIT_CHECKIN_CARD_MS = 2000

/**
 * The card for a feedback. Since Phase 6.6.2b every successful check-in is answered in the same
 * notification corner: 'checkin' gets the light card (short, no particles, calm tone), the others
 * the gold, flame or milestone card. A weekly habit's light card names the week's count.
 */
export function habitFeedbackCard(habitName: string, feedback: HabitFeedback, t: Translate): HabitFeedbackCard {
  const weeks = feedback.unit === 'week'
  switch (feedback.level) {
    case 'weekly-goal': {
      const week = feedback.week ?? { count: 0, target: 0 }
      // The streak (or the record it set) rides along on the same card; no second card follows.
      const suffix = feedback.record
        ? t(weeks ? 'habits.feedback.alsoRecordWeeks' : 'habits.feedback.alsoRecordDays', { count: feedback.streak })
        : feedback.streak >= 2
          ? t(weeks ? 'habits.feedback.alsoStreakWeeks' : 'habits.feedback.alsoStreakDays', { count: feedback.streak })
          : ''
      return {
        heading: t('habits.feedback.weeklyGoal', { count: week.count, target: week.target }),
        taskTitle: habitName + suffix,
        ...(suffix ? { titleSuffix: suffix } : {}),
        variant: 'habit-goal'
      }
    }
    case 'record':
      return {
        heading: t(weeks ? 'habits.feedback.recordWeeks' : 'habits.feedback.recordDays', { count: feedback.streak }),
        taskTitle: habitName,
        variant: 'habit-record'
      }
    case 'milestone':
      return {
        heading: t(weeks ? 'habits.notify.weeks' : 'habits.notify.days', { count: feedback.milestone ?? feedback.streak }),
        taskTitle: habitName,
        variant: 'goal'
      }
    case 'claimed': {
      // The goal is met again after a cancel: no second celebration, but say so plainly.
      const week = feedback.week
      const period = t(weeks ? 'habits.feedback.periodWeek' : 'habits.feedback.periodDay')
      const reward = t(
        feedback.claimed === 'weekly-goal'
          ? 'habits.feedback.rewardGold'
          : feedback.claimed === 'record'
            ? 'habits.feedback.rewardRecord'
            : 'habits.feedback.rewardMilestone'
      )
      return {
        heading:
          weeks && week
            ? t('habits.feedback.claimedWeek', { count: week.count, target: week.target })
            : t('habits.feedback.claimedDay'),
        taskTitle: habitName,
        detail: t('habits.feedback.claimedDetail', { reward, period }),
        variant: 'habit-claimed'
      }
    }
    case 'checkin': {
      const suffix = feedback.week ? t('habits.feedback.alsoWeek', { count: feedback.week.count, target: feedback.week.target }) : ''
      return {
        heading: t('habits.feedback.checkedIn'),
        taskTitle: habitName + suffix,
        ...(suffix ? { titleSuffix: suffix } : {}),
        variant: 'habit-checkin'
      }
    }
  }
}

/**
 * The sound of the light check-in message (Phase 6.6.2): the calm 'soft' tone at the user's
 * notification volume, never the theme's louder sound or an imported file. Silent when the theme's
 * sound is off or the volume is 0, like every achievement sound.
 */
export function habitCheckinSound(style: Pick<AchievementStyle, 'sound' | 'volume'>): Pick<AchievementStyle, 'sound' | 'soundUrl' | 'volume'> {
  return { sound: style.sound === 'none' ? 'none' : 'soft', soundUrl: null, volume: style.volume }
}
