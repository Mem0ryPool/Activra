import { CircleDashed, Link2 } from 'lucide-react'
import { Select, type SelectOption } from '../components/Select'
import { useT } from '../store/appStore'

export interface TaskPickerOption {
  id: string
  label: string
}

/** The value standing for "No task" (task ids are never empty). */
const NONE = ''

/**
 * Chooses the task a focus is linked to (Phase 6.7), on the shared Select: "No task" first, then the
 * tasks in progress, each with a link icon; the chosen one is ticked and shown in the button.
 */
export function TaskPicker({
  options,
  value,
  onChange,
  disabled,
  labelId
}: {
  options: TaskPickerOption[]
  value: string | null
  onChange: (taskId: string | null) => void
  disabled?: boolean
  /** The id of the visible label. */
  labelId: string
}): React.JSX.Element {
  const t = useT()
  const items: SelectOption[] = [
    { value: NONE, label: t('focus.task.none'), icon: CircleDashed, muted: true, separatorAfter: true },
    ...options.map((o) => ({ value: o.id, label: o.label, icon: Link2 }))
  ]
  const current = value !== null && options.some((o) => o.id === value) ? value : NONE
  return (
    <Select
      value={current}
      options={items}
      onChange={(next) => onChange(next === NONE ? null : next)}
      labelledBy={labelId}
      disabled={disabled}
      testId="focus-task-picker"
      footer={options.length === 0 ? <span data-testid="focus-task-empty">{t('focus.task.empty')}</span> : undefined}
    />
  )
}
