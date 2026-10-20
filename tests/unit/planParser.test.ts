import { describe, expect, it } from 'vitest'
import { resolveDate, parseWeekdayList } from '../../src/shared/planner/dateExpressions'
import { addMonths, endOfWeek, spanDays, startOfWeek } from '../../src/shared/planner/dateMath'
import { draftReady, draftToInput, goalProblems } from '../../src/shared/planner/draft'
import { parseNumber } from '../../src/shared/planner/numbers'
import { parsePlanText, splitClauses } from '../../src/shared/planner/ruleParser'
import { categorize } from '../../src/shared/planner/templates'
import type { DraftGoal } from '../../src/shared/planner/types'

// 2026-10-16 is a Friday.
const FRIDAY = '2026-10-16'
const THURSDAY = '2026-10-15'

const parse = (text: string, today = THURSDAY) => parsePlanText(text, { today })
const codes = (g: DraftGoal) => g.issues.map((i) => i.code)

describe('Numbers', () => {
  it('reads digits, Chinese numerals and English words', () => {
    expect(parseNumber('20')).toBe(20)
    expect(parseNumber('二十')).toBe(20)
    expect(parseNumber('三十五')).toBe(35)
    expect(parseNumber('一百二十')).toBe(120)
    expect(parseNumber('两')).toBe(2)
    expect(parseNumber('十')).toBe(10)
    expect(parseNumber('twenty-one')).toBe(21)
    expect(parseNumber('three')).toBe(3)
    expect(parseNumber('abc')).toBeNull()
  })
})

describe('Date words', () => {
  it('resolves relative days and weekdays from today', () => {
    expect(resolveDate('明天', FRIDAY)).toEqual({ date: '2026-10-17', issue: null })
    expect(resolveDate('后天', FRIDAY)).toEqual({ date: '2026-10-18', issue: null })
    expect(resolveDate('下周三', FRIDAY)).toEqual({ date: '2026-10-21', issue: null })
    expect(resolveDate('本周日', FRIDAY)).toEqual({ date: '2026-10-18', issue: null })
    expect(resolveDate('周五', THURSDAY)).toEqual({ date: '2026-10-16', issue: null })
    expect(resolveDate('tomorrow', FRIDAY)).toEqual({ date: '2026-10-17', issue: null })
    expect(resolveDate('Friday', THURSDAY)).toEqual({ date: '2026-10-16', issue: null })
  })

  it('flags a weekday said on that same day, and "next Friday", as ambiguous', () => {
    expect(resolveDate('周五', FRIDAY)).toEqual({ date: FRIDAY, issue: 'ambiguous-date' })
    expect(resolveDate('Friday', FRIDAY)?.issue).toBe('ambiguous-date')
    expect(resolveDate('next Friday', FRIDAY)?.issue).toBe('ambiguous-date')
  })

  it('handles month ends, explicit dates and dates without a year across the year end', () => {
    expect(resolveDate('月底', FRIDAY)?.date).toBe('2026-10-31')
    expect(resolveDate('下个月底', '2026-01-31')?.date).toBe('2026-02-28')
    expect(resolveDate('10月20日', FRIDAY)).toEqual({ date: '2026-10-20', issue: null })
    expect(resolveDate('1月5日', FRIDAY)).toEqual({ date: '2027-01-05', issue: 'year-assumed' })
    expect(resolveDate('2027-03-01', FRIDAY)).toEqual({ date: '2027-03-01', issue: null })
    expect(resolveDate('2月30日', FRIDAY)).toBeNull()
    expect(resolveDate('Nov 3rd', FRIDAY)?.date).toBe('2026-11-03')
    expect(resolveDate('end of the month', FRIDAY)?.date).toBe('2026-10-31')
  })

  it('counts months and weeks on the calendar, across months and years', () => {
    expect(spanDays('2026-01-31', 1, 'month')).toBe(28)
    expect(spanDays('2026-10-16', 1, 'month')).toBe(31)
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(startOfWeek('2026-11-01')).toBe('2026-10-26')
    expect(endOfWeek('2026-12-30')).toBe('2027-01-03')
  })

  it('reads weekday lists', () => {
    expect(parseWeekdayList('一三五')).toEqual([1, 3, 5])
    expect(parseWeekdayList('周二和周日')).toEqual([0, 2])
    expect(parseWeekdayList('Mondays and Thursdays')).toEqual([1, 4])
  })
})

describe('The example from the spec', () => {
  const text = '未来30天，每天背20个英语单词，每周健身3次，周五之前完成数学作业，然后学习Python基础。'

  it('finds four goals with their own rules', () => {
    const draft = parse(text)
    expect(draft.language).toBe('zh')
    expect(draft.unparsed).toEqual([])
    expect(draft.goals.map((g) => g.title)).toEqual(['背20个英语单词', '健身', '完成数学作业', '学习Python基础'])
    const [words, gym, homework, python] = draft.goals as [DraftGoal, DraftGoal, DraftGoal, DraftGoal]

    // A definite 30-day goal, every day, never an endless repeat.
    expect(words).toMatchObject({ kind: 'count', days: 30, required: 30, every: 1, category: 'vocabulary' })
    expect(words.quantity).toEqual({ amount: 20, unit: '英语单词' })

    // 3 times in each week. 30 days is not whole weeks: rounded down and flagged, never guessed silently.
    expect(gym).toMatchObject({ kind: 'weekly', perWeek: 3, weeks: 4, weekdays: null, category: 'fitness' })
    expect(codes(gym)).toEqual(['weeks-rounded'])

    // Thursday → this Friday, required on time.
    expect(homework).toMatchObject({ kind: 'once', due: '2026-10-16', onTime: true, category: 'homework', afterPrevious: false })
    expect(codes(homework)).toEqual([])

    // "然后": a step after the homework, not after everything; the 30 days do not apply to it.
    expect(python).toMatchObject({ kind: 'once', due: null, afterPrevious: true, category: 'coding' })
  })

  it('offers the "全成就！" achievement for the whole plan', () => {
    const draft = parse(text)
    expect(draft.master?.name).toBe('全成就！')
    expect(draft.master?.icon).toBe('crown')
  })

  it('asks before importing: the rounded weeks must be confirmed first', () => {
    const draft = parse(text)
    expect(draftReady(draft, THURSDAY)).toBe(false)
    expect(goalProblems(draft.goals[1] as DraftGoal, THURSDAY)).toEqual(['unconfirmed'])
    const confirmed = { ...draft, goals: draft.goals.map((g) => ({ ...g, issues: [] })) }
    expect(draftReady(confirmed, THURSDAY)).toBe(true)
    const input = draftToInput(confirmed, THURSDAY)
    expect(input.goals[3]?.afterKey).toBe(input.goals[2]?.key)
    expect(input.goals[0]?.afterKey).toBeNull()
    expect(input.goals[1]?.condition).toEqual({ kind: 'weekly', startDate: null, weeks: 4, perWeek: 3, weekdays: null })
  })

  it('said on a Friday, "周五之前" could mean today or next week: flagged', () => {
    const homework = parse(text, FRIDAY).goals[2] as DraftGoal
    expect(homework.due).toBe(FRIDAY)
    expect(codes(homework)).toContain('ambiguous-date')
  })

  it('reads the same plan in English', () => {
    const draft = parse('For the next 30 days, read 10 pages every day, work out 3 times a week, finish the math homework by Friday, then learn Python basics.')
    expect(draft.language).toBe('en')
    expect(draft.goals.map((g) => g.title)).toEqual(['Read 10 pages', 'Work out', 'Finish the math homework', 'Learn Python basics'])
    expect(draft.goals[0]).toMatchObject({ kind: 'count', days: 30, required: 30 })
    expect(draft.goals[1]).toMatchObject({ kind: 'weekly', perWeek: 3, weeks: 4 })
    expect(draft.goals[2]).toMatchObject({ kind: 'once', due: '2026-10-16', onTime: true })
    expect(draft.goals[3]).toMatchObject({ afterPrevious: true })
    expect(draft.master?.name).toBe('All Achievements!')
  })
})

describe('Repeating goals', () => {
  it('"持续30天" after a goal belongs to that goal', () => {
    const [goal] = parse('每天背单词，坚持21天').goals
    expect(goal).toMatchObject({ kind: 'count', days: 21, required: 21 })
  })

  it('never invents a length: "每天喝水" waits for the user', () => {
    const [goal] = parse('每天喝水').goals
    expect(goal).toMatchObject({ kind: 'count', days: null, required: null })
    expect(goalProblems(goal as DraftGoal, THURSDAY)).toEqual(expect.arrayContaining(['missing-duration', 'missing-count']))
  })

  it('reads streaks', () => {
    expect(parse('连续7天早起').goals[0]).toMatchObject({ kind: 'streak', required: 7, days: 7, category: 'sleep' })
    expect(parse('Meditate 7 days in a row').goals[0]).toMatchObject({ kind: 'streak', required: 7, days: 7 })
    expect(parse('未来30天里连续14天跑步').goals[0]).toMatchObject({ kind: 'streak', required: 14, days: 30 })
  })

  it('reads fixed weekdays and their weeks', () => {
    expect(parse('每周一三五跑步5公里，持续4周').goals[0]).toMatchObject({
      kind: 'weekly',
      weekdays: [1, 3, 5],
      perWeek: 3,
      weeks: 4,
      quantity: { amount: 5, unit: '公里' }
    })
    expect(parse('Run on Mondays and Thursdays for 6 weeks').goals[0]).toMatchObject({ weekdays: [1, 4], perWeek: 2, weeks: 6 })
    expect(parse('工作日每天学习1小时，持续2周').goals[0]).toMatchObject({ weekdays: [1, 2, 3, 4, 5], perWeek: 5, weeks: 2 })
  })

  it('reads "每周三次" as three times a week, "每周三" as Wednesdays', () => {
    expect(parse('每周三次游泳，坚持8周').goals[0]).toMatchObject({ kind: 'weekly', perWeek: 3, weekdays: null, weeks: 8 })
    expect(parse('每周三游泳，坚持8周').goals[0]).toMatchObject({ kind: 'weekly', perWeek: 1, weekdays: [3], weeks: 8 })
  })

  it('reads totals within a range ("本月去健身房10次")', () => {
    // From Thursday Oct 15 to Oct 31: 17 days, 10 of them.
    expect(parse('本月去健身房10次').goals[0]).toMatchObject({ kind: 'count', days: 17, required: 10, title: '去健身房' })
  })

  it('every other day', () => {
    expect(parse('隔天跑步，持续两周').goals[0]).toMatchObject({ kind: 'count', every: 2, days: 14, required: 7 })
  })

  it('a start date moves the window', () => {
    expect(parse('从下周一开始，每天跑步30分钟，持续3周').goals[0]).toMatchObject({ startDate: '2026-10-19', days: 21, required: 21 })
  })

  it('crosses a month end: "未来7天" from Oct 29 ends on Nov 4', () => {
    const draft = parse('未来7天每天跑步', '2026-10-29')
    expect(draft.goals[0]).toMatchObject({ days: 7, required: 7 })
  })

  it('a month of days follows the calendar', () => {
    expect(parse('接下来一个月每天读书', '2026-02-01').goals[0]).toMatchObject({ days: 28 })
  })
})

describe('Deadlines, chains and uncertainty', () => {
  it('a range on a one-off goal is its deadline', () => {
    expect(parse('这个月读完一本书').goals[0]).toMatchObject({ kind: 'once', due: '2026-10-31', onTime: true })
  })

  it('places a date without a year in next year and asks', () => {
    const [goal] = parse('1月5日之前完成论文').goals
    expect(goal).toMatchObject({ due: '2027-01-05' })
    expect(codes(goal as DraftGoal)).toEqual(['year-assumed'])
  })

  it('a deadline already past blocks the import until it is changed', () => {
    const [goal] = parse('10月1日之前交报告').goals
    expect(goal?.due).toBe('2027-10-01')
    const past = { ...(goal as DraftGoal), due: '2026-10-01', issues: [] }
    expect(goalProblems(past, THURSDAY)).toEqual(['date-past'])
  })

  it('separate goals stay independent; only "然后/then" chains', () => {
    const draft = parse('每天背单词持续10天，每周跑步两次持续两周，然后准备考试，再复习笔记')
    expect(draft.goals.map((g) => g.afterPrevious)).toEqual([false, false, true, true])
    const independent = parse('Read a book, call mom and clean the room')
    expect(independent.goals.every((g) => !g.afterPrevious)).toBe(true)
  })

  it('splits "…然后…" inside one sentence', () => {
    expect(splitClauses('先写完报告然后去跑步')).toEqual([
      { text: '先写完报告', chained: false },
      { text: '然后去跑步', chained: true }
    ])
  })

  it('flags vague words instead of making up a number', () => {
    const [goal] = parse('尽量多运动').goals
    expect(codes(goal as DraftGoal)).toEqual(['vague'])
    expect(goalProblems(goal as DraftGoal, THURSDAY)).toContain('unconfirmed')
  })

  it('more times than days is inconsistent', () => {
    const [goal] = parse('3天内跑步5次').goals
    expect(goal).toMatchObject({ kind: 'count', days: 3, required: 5 })
    expect(goalProblems(goal as DraftGoal, THURSDAY)).toContain('inconsistent')
  })

  it('keeps text it cannot use visible', () => {
    expect(parse('每天背单词持续10天，，。！').unparsed).toEqual([])
    expect(parse('未来30天').goals).toEqual([])
  })

  it('handles full-width digits and punctuation', () => {
    expect(parse('每天背单词，坚持２１天').goals[0]).toMatchObject({ days: 21 })
  })
})

describe('Templates', () => {
  it('match goals to categories in Chinese and English', () => {
    expect(categorize('背20个英语单词')).toBe('vocabulary')
    expect(categorize('完成数学作业')).toBe('homework')
    expect(categorize('学习Python基础')).toBe('coding')
    expect(categorize('Work out')).toBe('fitness')
    expect(categorize('Practice piano')).toBe('music')
    expect(categorize('喂猫')).toBe('general')
  })

  it('pick rarity from difficulty: a 30-day daily goal outranks a single task', () => {
    const draft = parse('每天背单词持续30天，明天之前交作业')
    expect(draft.goals[0]?.achievement.rarity).toBe('epic')
    expect(draft.goals[1]?.achievement.rarity).toBe('uncommon')
    // The plan achievement is one step above the hardest goal.
    expect(draft.master?.rarity).toBe('legendary')
  })
})
