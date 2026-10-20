import { AlertTriangle, ArrowLeft, Check, CopyCheck, Crown, Eye, Link2, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { dayKey } from '../../../shared/dates'
import { floorToMinute, intervalWindows } from '../../../shared/timeWindow'
import { categorize } from '../../../shared/planner/templates'
import {
  draftCondition,
  draftMasterEligible,
  draftReady,
  draftToInput,
  goalProblems,
  LIMITS,
  refreshAchievement,
  refreshMaster,
} from '../../../shared/planner/draft'
import { fieldHints, fieldRange, type DraftField, type FieldHint } from '../../../shared/planner/fieldHints'
import { suggestPlanTitle } from '../../../shared/planner/naming'
import { findSimilarPlans, type PlanMatch } from '../../../shared/planner/similarity'
import type { TranslationKey } from '../../../shared/i18n'
import { ruleBasedParser } from '../../../shared/planner/ruleParser'
import type { DraftGoal, DraftIssueCode, GoalKind, PlanDraft, PlanParser } from '../../../shared/planner/types'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { useNow } from '../hooks/useNow'
import { formatWindow } from '../lib/windowText'
import { weekdayName } from '../lib/recurrenceText'
import { useAppStore, useT } from '../store/appStore'
import { PlanBadge, RarityLabel } from './PlanBadge'
import { Select } from '../components/Select'

const inputClass =
  'w-full rounded-lg bg-app px-3 py-2 text-sm text-fg ring-1 ring-line outline-none placeholder:text-muted/60 focus:ring-2 focus:ring-accent'

/** An input that needs changing: a red ring (the ring color is swapped, not stacked, so it really shows). */
const fieldClass = (bad: unknown): string =>
  bad ? inputClass.replace('ring-1 ring-line', 'ring-2 ring-danger') : inputClass

/** The parser behind the wizard. Swap this for another `PlanParser` (e.g. an AI one) to change how text is read. */
const parser: PlanParser = ruleBasedParser

/** Clickable examples: a short name; clicking fills in the sentence it stands for (still editable). */
const EXAMPLES = ['water', 'fitness', 'study'] as const

/** Which fields a guess is about: editing one of them settles it, like pressing Confirm. */
const ISSUE_FIELDS: Record<DraftIssueCode, (keyof DraftGoal)[]> = {
  'weeks-rounded': ['weeks'],
  'ambiguous-date': ['due', 'startDate'],
  'year-assumed': ['due', 'startDate'],
  'date-past': ['due', 'startDate'],
  vague: ['kind'],
  inconsistent: [],
  'missing-duration': ['days', 'weeks', 'slots'],
  'missing-count': ['required', 'perWeek'],
  'chain-date': ['due', 'afterPrevious'],
  'interval-assumed': ['slots', 'intervalMinutes'],
  'hourly-unsupported': ['kind']
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** The label each field has in the form, used to name it in the summary ("缺少「时段数」"). */
const FIELD_LABEL: Record<DraftField, TranslationKey> = {
  title: 'wizard.goal.title',
  due: 'wizard.goal.due',
  start: 'wizard.goal.start',
  days: 'wizard.goal.days',
  required: 'wizard.goal.required',
  every: 'wizard.goal.every',
  weeks: 'wizard.goal.weeks',
  perWeek: 'wizard.goal.perWeek',
  weekdays: 'wizard.field.weekdays',
  length: 'wizard.goal.length',
  slots: 'wizard.goal.slots',
  slotMinutes: 'wizard.goal.slotMinutes'
}

/** What to change in one field, shown right below it and announced with it (aria-describedby). */
function FieldHintText({ hint }: { hint: FieldHintView | null }): React.JSX.Element | null {
  if (!hint) return null
  return (
    <span id={hint.id} data-testid="goal-problem" data-code={hint.problem} data-field={hint.field} className="text-xs leading-snug text-danger-fg">
      {hint.text}
    </span>
  )
}

interface FieldHintView {
  id: string
  field: DraftField
  problem: FieldHint['problem']
  text: string
}

function NumberInput({
  label,
  value,
  min = 1,
  max,
  invalid,
  hint,
  onChange,
  testId
}: {
  label: string
  value: number | null
  min?: number
  max: number
  /** Highlighted without a message of its own (a guess to confirm is explained in its own box). */
  invalid?: boolean
  hint?: FieldHintView | null
  onChange: (value: number | null) => void
  testId: string
}): React.JSX.Element {
  const bad = !!hint || !!invalid
  return (
    <label className="flex min-w-24 flex-1 flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ''}
        data-testid={testId}
        aria-invalid={bad || undefined}
        aria-describedby={hint?.id}
        onChange={(e) => {
          const raw = e.target.value
          onChange(raw === '' ? null : Math.max(min, Math.min(max, Math.floor(Number(raw)))))
        }}
        className={fieldClass(bad)}
      />
      <FieldHintText hint={hint ?? null} />
    </label>
  )
}

/** The windows an interval goal would get if imported now; they are placed for real when the plan is imported. */
function SlotPreview({ goal }: { goal: DraftGoal }): React.JSX.Element | null {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  // Follows the clock, so the times shown are the ones the import would use (to the minute).
  const now = useNow(true, 5_000)
  const condition = draftCondition(goal)
  if (condition?.kind !== 'interval' || goalProblems(goal, dayKey(new Date(now))).includes('out-of-range')) return null
  const windows = intervalWindows(new Date(floorToMinute(now)).toISOString(), condition.minutes, condition.count)
  return (
    <div className="flex flex-col gap-1 text-xs text-muted" data-testid="goal-slot-preview">
      <span>{t('wizard.goal.slotsFrom')}</span>
      <ol className="flex flex-wrap gap-x-3 gap-y-1">
        {windows.map((w, i) => (
          <li key={w.start} data-testid="goal-slot" className="tabular-nums">
            {t('plans.goal.slot', { n: i + 1 })} {formatWindow(w, now, t, locale)}
          </li>
        ))}
      </ol>
    </div>
  )
}

function GoalEditor({
  goal,
  index,
  previous,
  today,
  language,
  onChange,
  onRemove
}: {
  goal: DraftGoal
  index: number
  previous: DraftGoal | null
  today: string
  language: PlanDraft['language']
  onChange: (goal: DraftGoal) => void
  onRemove: () => void
}): React.JSX.Element {
  const t = useT()
  const locale = useAppStore((s) => s.locale)
  // Each problem is explained once, next to the field that fixes it; the summary above only names it.
  const hints = fieldHints(goal, today)
  const hintFor = (field: DraftField): FieldHintView | null => {
    const hint = hints.find((h) => h.field === field)
    return hint ? { ...hint, id: `${goal.key}-${field}-hint`, text: hintText(hint) } : null
  }

  /** Applies an edit: settles guesses about the edited fields and regenerates the achievement text. */
  const edit = (patch: Partial<DraftGoal>): void => {
    const fields = Object.keys(patch) as (keyof DraftGoal)[]
    let next: DraftGoal = {
      ...goal,
      ...patch,
      issues: goal.issues.filter((issue) => !ISSUE_FIELDS[issue.code].some((f) => fields.includes(f)))
    }
    if (patch.title !== undefined) next.category = categorize(patch.title)
    // Switching the kind fills in what the new kind needs from what is already there; nothing is invented.
    if (patch.kind === 'count' && next.days !== null && next.required === null) next.required = Math.ceil(next.days / next.every)
    if (patch.kind === 'weekly' && next.weeks === null && next.days !== null) next.weeks = Math.max(1, Math.floor(next.days / 7))
    if (patch.kind === 'streak' && next.days === null && next.required !== null) next.days = next.required
    next = refreshAchievement(next, language, true)
    onChange(next)
  }

  const kinds: GoalKind[] = ['once', 'count', 'weekly', 'streak', 'interval']
  /** The exact change a field needs ("请填写要做几个时段（每段 60 分钟）…"). */
  const hintText = ({ field, problem }: FieldHint): string => {
    if (problem === 'title') return t('wizard.problem.title')
    if (problem === 'date-past') return t('wizard.problem.date-past')
    if (problem === 'inconsistent' && (field === 'required' || field === 'perWeek' || field === 'length')) {
      return t(`wizard.hint.inconsistent.${field}`)
    }
    if (problem === 'out-of-range') {
      const minutes = goal.intervalMinutes ?? 60
      if (field === 'slots' && goal.slots !== null && goal.slots * minutes > LIMITS.intervalSpanMinutes) {
        return t('wizard.hint.span', { minutes, max: Math.floor(LIMITS.intervalSpanMinutes / minutes) })
      }
      const range = fieldRange(field)
      if (range) return t('wizard.hint.range', range)
    }
    if (field === 'days' || field === 'required' || field === 'weeks' || field === 'perWeek' || field === 'weekdays' || field === 'length' || field === 'slots' || field === 'slotMinutes') {
      return t(`wizard.hint.missing.${field}`, { minutes: goal.intervalMinutes ?? 60 })
    }
    return t('wizard.notReady')
  }
  const startHint = hintFor('start')
  const startField = goal.kind !== 'once' && (
    <label className="flex min-w-36 flex-1 flex-col gap-1">
      <span className="text-xs text-muted">{t('wizard.goal.start')}</span>
      {goal.afterPrevious ? (
        <span className="flex h-9 items-center text-sm text-muted">{t('wizard.goal.startChain')}</span>
      ) : (
        <input
          type="date"
          value={goal.startDate ?? today}
          min={today}
          data-testid="goal-start"
          aria-invalid={!!startHint || undefined}
          aria-describedby={startHint?.id}
          onChange={(e) => edit({ startDate: e.target.value && e.target.value !== today ? e.target.value : null })}
          className={fieldClass(startHint)}
        />
      )}
      <FieldHintText hint={startHint} />
    </label>
  )

  return (
    <section data-testid="wizard-goal" data-goal={goal.key} className="flex flex-col gap-3 rounded-xl bg-app/50 p-4 ring-1 ring-line">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted">{t('wizard.goal', { n: index + 1 })}</span>
        {goal.afterPrevious && previous && (
          <span className="inline-flex min-w-0 items-center gap-1 truncate text-xs text-accent">
            <Link2 size={12} />
            {t('plans.goal.chainAfter', { title: previous.title })}
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('wizard.goal.remove')}
          title={t('wizard.goal.remove')}
          className="ml-auto rounded-md p-1 text-muted hover:bg-ink/5 hover:text-fg"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-48 flex-[2] flex-col gap-1">
          <span className="text-xs text-muted">{t('wizard.goal.title')}</span>
          <input
            value={goal.title}
            maxLength={LIMITS.titleLength}
            data-testid="goal-title"
            aria-invalid={!!hintFor('title') || undefined}
            aria-describedby={hintFor('title')?.id}
            onChange={(e) => edit({ title: e.target.value })}
            className={fieldClass(hintFor('title'))}
          />
          <FieldHintText hint={hintFor('title')} />
        </label>
        <label className="flex min-w-36 flex-1 flex-col gap-1">
          <span className="text-xs text-muted">{t('wizard.goal.kind')}</span>
          <Select
            value={goal.kind}
            testId="goal-kind"
            label={t('wizard.goal.kind')}
            size="sm"
            onChange={(kind: GoalKind) => edit({ kind })}
            options={kinds.map((k) => ({ value: k, label: t(`wizard.kind.${k}`) }))}
          />
        </label>
      </div>

      {goal.kind === 'once' && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="text-xs text-muted">{t('wizard.goal.due')}</span>
            <input
              type="date"
              value={goal.due ?? ''}
              data-testid="goal-due"
              aria-invalid={!!hintFor('due') || undefined}
              aria-describedby={hintFor('due')?.id}
              onChange={(e) => edit({ due: e.target.value || null, onTime: e.target.value ? goal.onTime : false })}
              className={fieldClass(hintFor('due'))}
            />
            <FieldHintText hint={hintFor('due')} />
          </label>
          <label className="flex h-9 flex-[2] cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={goal.onTime && goal.due !== null}
              disabled={goal.due === null}
              onChange={(e) => edit({ onTime: e.target.checked })}
            />
            {t('wizard.goal.onTime')}
          </label>
        </div>
      )}
      {goal.kind === 'count' && (
        <div className="flex flex-wrap gap-3">
          {startField}
          <NumberInput testId="goal-days" label={t('wizard.goal.days')} value={goal.days} max={LIMITS.days} hint={hintFor('days')} onChange={(days) => edit({ days })} />
          <NumberInput
            testId="goal-required"
            label={t('wizard.goal.required')}
            value={goal.required}
            max={LIMITS.days}
            hint={hintFor('required')}
            onChange={(required) => edit({ required })}
          />
          <NumberInput testId="goal-every" label={t('wizard.goal.every')} value={goal.every} max={LIMITS.every} hint={hintFor('every')} onChange={(every) => edit({ every: every ?? 1 })} />
        </div>
      )}
      {goal.kind === 'weekly' && (
        <>
          <div className="flex flex-wrap gap-3">
            {startField}
            <NumberInput testId="goal-weeks" label={t('wizard.goal.weeks')} value={goal.weeks} max={LIMITS.weeks} hint={hintFor('weeks')} invalid={goal.issues.some((i) => i.code === 'weeks-rounded')} onChange={(weeks) => edit({ weeks })} />
            <NumberInput testId="goal-per-week" label={t('wizard.goal.perWeek')} value={goal.perWeek} max={7} hint={hintFor('perWeek')} onChange={(perWeek) => edit({ perWeek })} />
          </div>
          <fieldset className="flex flex-col gap-1" aria-describedby={hintFor('weekdays')?.id} aria-invalid={!!hintFor('weekdays') || undefined}>
            <legend className="mb-1 text-xs text-muted">{t('wizard.goal.weekdays')}</legend>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                aria-pressed={goal.weekdays === null}
                onClick={() => edit({ weekdays: null })}
                className={`h-8 rounded-md px-2.5 text-xs ring-1 transition-colors ${goal.weekdays === null ? 'bg-accent/15 font-medium text-accent ring-accent/40' : 'text-muted ring-line hover:text-fg'}`}
              >
                {t('wizard.goal.anyDay')}
              </button>
              {WEEK_ORDER.map((d) => {
                const on = goal.weekdays?.includes(d) ?? false
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const set = new Set(goal.weekdays ?? [])
                      if (on) set.delete(d)
                      else set.add(d)
                      edit({ weekdays: set.size ? [...set].sort((a, b) => a - b) : null })
                    }}
                    className={`h-8 min-w-10 rounded-md px-2 text-xs ring-1 transition-colors ${on ? 'bg-accent/15 font-medium text-accent ring-accent/40' : 'text-muted ring-line hover:text-fg'}`}
                  >
                    {weekdayName(d, locale)}
                  </button>
                )
              })}
            </div>
            <FieldHintText hint={hintFor('weekdays')} />
          </fieldset>
        </>
      )}
      {goal.kind === 'streak' && (
        <div className="flex flex-wrap gap-3">
          {startField}
          <NumberInput testId="goal-length" label={t('wizard.goal.length')} value={goal.required} max={LIMITS.days} hint={hintFor('length')} onChange={(required) => edit({ required })} />
          <NumberInput testId="goal-days" label={t('wizard.goal.days')} value={goal.days} max={LIMITS.days} hint={hintFor('days')} onChange={(days) => edit({ days })} />
        </div>
      )}

      {goal.kind === 'interval' && (
        <>
          <div className="flex flex-wrap items-start gap-3">
            <NumberInput
              testId="goal-slots"
              label={t('wizard.goal.slots')}
              value={goal.slots}
              max={LIMITS.slots}
              hint={hintFor('slots')}
              onChange={(slots) => edit({ slots })}
            />
            <NumberInput
              testId="goal-slot-minutes"
              label={t('wizard.goal.slotMinutes')}
              value={goal.intervalMinutes}
              min={LIMITS.intervalMinutes.min}
              max={LIMITS.intervalMinutes.max}
              hint={hintFor('slotMinutes')}
              onChange={(intervalMinutes) => edit({ intervalMinutes })}
            />
          </div>
          <SlotPreview goal={goal} />
        </>
      )}

      {goal.quantity && (
        <p className="text-xs text-muted">{t('wizard.goal.quantity', { amount: goal.quantity.amount, unit: goal.quantity.unit })}</p>
      )}
      {index > 0 && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={goal.afterPrevious}
            data-testid="goal-after"
            onChange={(e) => edit({ afterPrevious: e.target.checked })}
          />
          {t('wizard.goal.after')}
        </label>
      )}

      {goal.issues.map((issue, i) => (
        <div key={`${issue.code}-${i}`} data-testid="goal-issue" data-code={issue.code} className="flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="flex-1">{t(`wizard.issue.${issue.code}`, { text: issue.text })}</span>
          <button
            type="button"
            data-testid="issue-confirm"
            onClick={() => onChange({ ...goal, issues: goal.issues.filter((_, j) => j !== i) })}
            className="shrink-0 rounded-md px-2 py-0.5 font-medium ring-1 ring-warn/40 hover:bg-warn/15"
          >
            {t('wizard.confirm')}
          </button>
        </div>
      ))}

      <div className="flex items-center gap-3 border-t border-line/70 pt-3">
        <PlanBadge spec={goal.achievement} unlocked />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              value={goal.achievement.name}
              maxLength={LIMITS.nameLength}
              aria-label={t('wizard.achievement.name')}
              data-testid="goal-achievement-name"
              onChange={(e) => onChange({ ...goal, achievement: { ...goal.achievement, name: e.target.value } })}
              className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-sm font-medium outline-none ring-line hover:ring-1 focus:ring-2 focus:ring-accent"
            />
            <RarityLabel rarity={goal.achievement.rarity} />
          </div>
          <p className="truncate px-1 text-xs text-muted" title={goal.achievement.description}>
            {goal.achievement.description}
          </p>
        </div>
      </div>
    </section>
  )
}

/**
 * What still stops the import, in plain words, above the goals: "目标 1「喝水」：缺少持续时长 [去修改]".
 * The button moves to the field to fill in (or the guess to confirm). Nothing is guessed for the user.
 */
function NeedsSummary({ draft, today }: { draft: PlanDraft; today: string }): React.JSX.Element | null {
  const t = useT()
  // One line per field to change (named, not explained: the field itself says what to enter), plus
  // guesses still waiting for confirmation.
  const items = draft.goals.flatMap((goal, index) => [
    ...fieldHints(goal, today).map(({ field, problem }) => ({ goal, index, problem, field: field as DraftField | null })),
    ...(goal.issues.length > 0 ? [{ goal, index, problem: 'unconfirmed' as const, field: null }] : [])
  ])
  const summary = ({ problem, field }: (typeof items)[number]): string => {
    if (problem === 'title' || problem === 'date-past' || problem === 'unconfirmed' || field === null) {
      return t(`wizard.needs.p.${problem === 'title' || problem === 'date-past' ? problem : 'unconfirmed'}`)
    }
    const label = t(FIELD_LABEL[field])
    if (problem === 'out-of-range') return t('wizard.needs.range', { field: label })
    if (problem === 'inconsistent') return t('wizard.needs.inconsistent', { field: label })
    return t('wizard.needs.missing', { field: label })
  }
  if (items.length === 0) return null
  const focus = (key: string, field: DraftField | null): void => {
    const section = document.querySelector<HTMLElement>(`[data-testid=wizard-goal][data-goal="${CSS.escape(key)}"]`)
    // The field to fill in first, else the guess to confirm, else the task name.
    const target = [
      field ? `[aria-describedby="${CSS.escape(`${key}-${field}-hint`)}"]` : '',
      '[aria-invalid=true]',
      '[data-testid=issue-confirm]',
      '[data-testid=goal-title]'
    ]
      .filter(Boolean)
      .map((selector) => section?.querySelector<HTMLElement>(selector))
      .map((el) => (el?.tagName === 'FIELDSET' ? el.querySelector<HTMLElement>('button') : el))
      .find((el) => el)
    section?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target?.focus({ preventScroll: true })
  }
  return (
    <div id="wizard-needs" className="flex flex-col gap-1.5 rounded-lg bg-warn/10 px-3 py-2.5 text-xs text-warn" data-testid="wizard-needs" role="status">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle size={14} className="shrink-0" />
        {t('wizard.needs.title', { count: items.length })}
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const { goal, index, problem, field } = item
          return (
          <li key={`${goal.key}-${field ?? problem}`} data-testid="wizard-need" data-code={problem} data-field={field ?? undefined} className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              {t('wizard.needs.item', { n: index + 1, title: goal.title.trim() || '…', problem: summary(item) })}
            </span>
            <button
              type="button"
              onClick={() => focus(goal.key, field)}
              className="shrink-0 rounded-md px-2 py-0.5 font-medium ring-1 ring-warn/40 hover:bg-warn/15"
            >
              {t('wizard.needs.fix')}
            </button>
          </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Shown instead of importing when a running plan already asks for the same thing (Phase 6.3). It does
 * not block: the user can open that plan, import anyway, or keep editing. Nothing is changed or deleted.
 */
function DuplicateNotice({
  matches,
  draft,
  busy,
  onView,
  onCreate,
  onEdit
}: {
  matches: PlanMatch[]
  draft: PlanDraft
  busy: boolean
  onView: (planId: string) => void
  onCreate: () => void
  onEdit: () => void
}): React.JSX.Element {
  const t = useT()
  const heading = useRef<HTMLParagraphElement>(null)
  useEffect(() => heading.current?.focus(), [matches])
  const exact = matches[0]?.level === 'exact'
  const first = matches[0] as PlanMatch
  return (
    <div
      role="alert"
      data-testid="wizard-duplicate"
      data-level={first.level}
      className="flex flex-col gap-2 rounded-lg bg-accent/10 px-3 py-3 text-sm ring-1 ring-accent/30"
    >
      <p ref={heading} tabIndex={-1} className="flex items-center gap-1.5 font-medium outline-none">
        <CopyCheck size={15} className="shrink-0 text-accent" aria-hidden="true" />
        {t(exact ? 'wizard.duplicate.exact.title' : 'wizard.duplicate.similar.title')}
      </p>
      <ul className="flex flex-col gap-1 text-xs">
        {matches.slice(0, 3).map((match) => (
          <li key={match.plan.id} data-testid="wizard-duplicate-plan" data-plan={match.plan.id} data-level={match.level} className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate font-medium" title={match.plan.title}>
              {match.plan.title}
            </span>
            <span className={`shrink-0 rounded px-1.5 py-px text-[11px] ring-1 ${match.level === 'exact' ? 'text-accent ring-accent/40' : 'text-muted ring-line'}`}>
              {t(`wizard.duplicate.level.${match.level}`)}
            </span>
            <span className="min-w-0 truncate text-muted">
              {t('wizard.duplicate.goals', {
                titles: match.goals.map((g) => t('wizard.duplicate.quote', { title: draft.goals[g.newIndex]?.title ?? '' })).join(t('wizard.duplicate.separator'))
              })}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{t(exact ? 'wizard.duplicate.exact.body' : 'wizard.duplicate.similar.body')}</p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button data-testid="duplicate-view" onClick={() => onView(first.plan.id)}>
          <Eye size={15} />
          {t('wizard.duplicate.view')}
        </Button>
        <Button data-testid="duplicate-create" disabled={busy} onClick={onCreate}>
          <Check size={15} />
          {busy ? t('wizard.importing') : t('wizard.duplicate.create')}
        </Button>
        <Button variant="ghost" data-testid="duplicate-edit" onClick={onEdit}>
          <Pencil size={15} />
          {t('wizard.duplicate.edit')}
        </Button>
      </div>
    </div>
  )
}

export function PlanWizard({ onClose, onViewPlan }: { onClose: () => void; onViewPlan?: (planId: string) => void }): React.JSX.Element {
  const t = useT()
  const createPlan = useAppStore((s) => s.createPlan)
  const plans = useAppStore((s) => s.plans)
  const tasks = useAppStore((s) => s.tasks)
  const completions = useAppStore((s) => s.completions)
  /** Running plans that already ask for the same thing; shown before importing. Null = not checked or dismissed. */
  const [duplicates, setDuplicates] = useState<PlanMatch[] | null>(null)
  /** Set synchronously on the first click, so a second click before React re-renders cannot import twice. */
  const submitting = useRef(false)
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<PlanDraft | null>(null)
  const [masterOn, setMasterOn] = useState(true)
  /** Once the user types a plan name, edits to the goals no longer rename the plan. */
  const [titleEdited, setTitleEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const today = useMemo(() => dayKey(new Date()), [])

  /** The name the goals suggest, numbered if another plan already has it. */
  const suggestTitle = (goals: readonly DraftGoal[], source: PlanDraft): string =>
    suggestPlanTitle(goals, { language: source.language, today, sourceText: source.sourceText, taken: plans.map((p) => p.title) })
  const preview = (): void => {
    const parsed = parser.parse(text, { today })
    setDraft(refreshMaster({ ...parsed, title: suggestTitle(parsed.goals, parsed) }, masterOn))
    setTitleEdited(false)
    setError(false)
    setDuplicates(null)
  }
  const updateGoals = (goals: DraftGoal[]): void => {
    if (!draft) return
    // A step needs a goal before it.
    const fixed = goals.map((g, i) => (i === 0 && g.afterPrevious ? { ...g, afterPrevious: false } : g))
    // Filling in a missing length ("每小时喝水" + 4 slots) can make a better name possible.
    const title = titleEdited ? draft.title : suggestTitle(fixed, draft)
    setDraft(refreshMaster({ ...draft, title, goals: fixed }, masterOn))
    // The plan changed: it is checked again on the next import.
    setDuplicates(null)
  }
  const ready = draft ? draftReady(draft, today) : false

  const create = async (): Promise<void> => {
    if (!draft || !ready || submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(false)
    try {
      await createPlan(draftToInput(draft, today))
      onClose()
    } catch (e) {
      console.error('[Plans] Import failed', e)
      submitting.current = false
      setError(true)
      setBusy(false)
    }
  }
  /** Import: first looks for a running plan that asks for the same (on this device only), then creates. */
  const submit = async (): Promise<void> => {
    if (!draft || !ready || submitting.current) return
    const matches = findSimilarPlans(draftToInput(draft, today), plans, tasks, completions, Date.now())
    if (matches.length > 0) {
      setDuplicates(matches)
      return
    }
    await create()
  }
  const viewPlan = (planId: string): void => {
    if (onViewPlan) onViewPlan(planId)
    else onClose()
  }
  const keepEditing = (): void => {
    setDuplicates(null)
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-testid=wizard-plan-title]')?.focus())
  }

  return (
    <Dialog
      title={t('wizard.title')}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        draft ? (
          <div className="flex w-full items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null)
                setDuplicates(null)
              }}
            >
              <ArrowLeft size={15} />
              {t('wizard.back')}
            </Button>
            <span className="min-w-0 flex-1 truncate text-right text-xs text-muted" data-testid="wizard-status">
              {error ? <span className="text-danger-fg">{t('wizard.error')}</span> : !ready && draft.goals.length > 0 ? t('wizard.notReady') : ''}
            </span>
            <Button
              variant="primary"
              data-testid="wizard-import"
              disabled={!ready || busy || duplicates !== null}
              aria-describedby={!ready && draft.goals.length > 0 ? 'wizard-needs' : undefined}
              onClick={() => void submit()}
            >
              <Check size={15} />
              {busy ? t('wizard.importing') : t('wizard.import')}
            </Button>
          </div>
        ) : (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" data-testid="wizard-parse" disabled={!text.trim()} onClick={preview}>
              <Sparkles size={15} />
              {t('wizard.parse')}
            </Button>
          </>
        )
      }
    >
      {!draft ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('wizard.input.label')}</span>
            <textarea
              autoFocus
              rows={5}
              value={text}
              maxLength={LIMITS.sourceLength}
              data-testid="wizard-input"
              placeholder={t('wizard.input.placeholder')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) preview()
              }}
              className={`${inputClass} resize-none leading-relaxed`}
            />
          </label>
          <p className="text-xs text-muted">{t('plans.offline')}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted">{t('wizard.input.examples')}</span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                data-testid="wizard-example"
                data-example={example}
                title={t(`wizard.example.${example}.text`)}
                onClick={() => {
                  setText(t(`wizard.example.${example}.text`))
                  // Back to the text, so it can be edited right away.
                  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid=wizard-input]')?.focus())
                }}
                className="h-7 rounded-full px-3 text-xs text-muted ring-1 ring-line transition-colors hover:bg-ink/[0.04] hover:text-fg"
              >
                {t(`wizard.example.${example}.label`)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="wizard-preview">
          {draft.goals.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted" data-testid="wizard-nothing">
              {t('wizard.nothing')}
            </p>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">{t('wizard.planTitle')}</span>
                <input
                  value={draft.title}
                  maxLength={LIMITS.titleLength}
                  data-testid="wizard-plan-title"
                  onChange={(e) => {
                    setTitleEdited(true)
                    setDraft({ ...draft, title: e.target.value })
                    setDuplicates(null)
                  }}
                  className={inputClass}
                />
              </label>
              {duplicates && duplicates.length > 0 && (
                <DuplicateNotice
                  matches={duplicates}
                  draft={draft}
                  busy={busy}
                  onView={viewPlan}
                  onCreate={() => void create()}
                  onEdit={keepEditing}
                />
              )}
              <NeedsSummary draft={draft} today={today} />
              {draft.goals.map((goal, i) => (
                <GoalEditor
                  key={goal.key}
                  goal={goal}
                  index={i}
                  previous={draft.goals[i - 1] ?? null}
                  today={today}
                  language={draft.language}
                  onChange={(next) => updateGoals(draft.goals.map((g) => (g.key === goal.key ? next : g)))}
                  onRemove={() => updateGoals(draft.goals.filter((g) => g.key !== goal.key))}
                />
              ))}
              {draftMasterEligible(draft.goals) && (
                <section className="flex items-center gap-3 rounded-xl p-4 ring-1 ring-gold/35" data-testid="wizard-master">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent"
                      checked={masterOn}
                      data-testid="wizard-master-toggle"
                      onChange={(e) => {
                        setMasterOn(e.target.checked)
                        setDraft(refreshMaster(draft, e.target.checked))
                        setDuplicates(null)
                      }}
                    />
                    <span className="text-sm">{t('wizard.master')}</span>
                  </label>
                  {draft.master && (
                    <div className="ml-auto flex min-w-0 items-center gap-2">
                      <Crown size={16} className="shrink-0 text-gold" />
                      <span className="truncate text-sm font-semibold text-gold">{draft.master.name}</span>
                      <RarityLabel rarity={draft.master.rarity} />
                    </div>
                  )}
                </section>
              )}
            </>
          )}
          {draft.unparsed.length > 0 && (
            <div className="rounded-lg px-3 py-2 text-xs text-muted ring-1 ring-line" data-testid="wizard-unparsed">
              <p className="mb-1">{t('wizard.unparsed')}</p>
              <ul className="list-inside list-disc">
                {draft.unparsed.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
