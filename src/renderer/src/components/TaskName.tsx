import type { TaskDisplayName } from '../../../shared/planner/displayName'

/**
 * A task's name as one line (Phase 6.3). A long name is cut with "…", but a timed plan step's
 * position (" · 第2/4次") always stays visible; the whole name is in the tooltip.
 */
export function TaskName({
  display,
  className = '',
  testId
}: {
  display: TaskDisplayName
  className?: string
  testId?: string
}): React.JSX.Element {
  if (!display.suffix) {
    return (
      <span className={`block truncate ${className}`} title={display.full} data-testid={testId}>
        {display.full}
      </span>
    )
  }
  return (
    <span className={`flex min-w-0 ${className}`} title={display.full} data-testid={testId}>
      <span className="min-w-0 truncate">{display.name}</span>
      <span className="shrink-0 whitespace-pre">{display.suffix}</span>
    </span>
  )
}
