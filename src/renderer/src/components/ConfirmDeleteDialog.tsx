import { useState } from 'react'
import type { Task } from '../../../shared/types'
import { useTaskName } from '../hooks/useTaskName'
import { useAppStore, useT } from '../store/appStore'
import { Button } from './Button'
import { Dialog } from './Dialog'

export function ConfirmDeleteDialog({ task, onClose }: { task: Task; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const deleteTask = useAppStore((s) => s.deleteTask)
  const taskName = useTaskName()
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title={t('delete.title')}
      onClose={onClose}
      width="max-w-sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await deleteTask(task.id)
              } finally {
                onClose()
              }
            }}
          >
            {t('common.delete')}
          </Button>
        </>
      }
    >
      <p className="text-sm break-words text-muted">{t(task.recurrence ? 'delete.body.repeat' : 'delete.body', { title: taskName(task) })}</p>
    </Dialog>
  )
}
