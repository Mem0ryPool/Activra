import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { backupFileName, DATA_FILE_NAME, DataStore, TaskNotFoundError } from '../../src/main/storage/dataStore'

let dir: string
let clock: number
let seq: number

function makeStore(): DataStore {
  return new DataStore({
    directory: dir,
    now: () => new Date(clock),
    createId: () => `task-${++seq}`
  })
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lu-store-'))
  clock = Date.parse('2026-10-15T10:00:00Z')
  seq = 0
})

describe('DataStore', () => {
  it('creates, edits and deletes tasks and persists them', async () => {
    const store = makeStore()
    await store.load()
    const task = await store.createTask({ title: 'Math homework', description: '', timerDurationSec: 1800, themeOverride: null })
    expect(task.status).toBe('active')
    expect(task.timerConfig).toEqual({ kind: 'countdown', durationSec: 1800, startedAt: '2026-10-15T10:00:00.000Z' })

    clock += 60_000
    await store.updateTask(task.id, { title: 'Math homework ch.3', timerDurationSec: null, themeOverride: null })
    await store.createTask({ title: 'Gym', description: 'Leg day', timerDurationSec: null, themeOverride: null })
    await store.deleteTask(task.id)

    const reloaded = makeStore()
    await reloaded.load()
    expect(reloaded.listTasks().map((t) => t.title)).toEqual(['Gym'])
  })

  it('completes a task only once, even with concurrent requests', async () => {
    const store = makeStore()
    await store.load()
    const task = await store.createTask({ title: 'Pass the final', description: '', timerDurationSec: null, themeOverride: null })
    const results = await Promise.all([store.completeTask(task.id), store.completeTask(task.id), store.completeTask(task.id)])
    expect(results.filter((r) => r.unlocked)).toHaveLength(1)
    const again = await store.completeTask(task.id)
    expect(again.unlocked).toBe(false)
    expect(again.task.completedAt).toBe('2026-10-15T10:00:00.000Z')
  })

  it('restarts the countdown only when its length changes or restart is requested', async () => {
    const store = makeStore()
    await store.load()
    const task = await store.createTask({ title: 'Read', description: '', timerDurationSec: 600, themeOverride: null })
    clock += 120_000
    const same = await store.updateTask(task.id, { title: 'Read more', timerDurationSec: 600, themeOverride: null })
    expect(same.timerConfig?.startedAt).toBe(task.timerConfig?.startedAt)
    const restarted = await store.updateTask(task.id, { timerDurationSec: 600, restartTimer: true })
    expect(restarted.timerConfig?.startedAt).toBe(new Date(clock).toISOString())
  })

  it('throws for unknown ids', async () => {
    const store = makeStore()
    await store.load()
    await expect(store.completeTask('missing')).rejects.toBeInstanceOf(TaskNotFoundError)
  })

  it('keeps a corrupt data file aside and starts empty', async () => {
    await writeFile(path.join(dir, DATA_FILE_NAME), '{not json', 'utf8')
    const store = makeStore()
    await store.load()
    expect(store.listTasks()).toEqual([])
    const files = await readdir(dir)
    expect(files.some((f) => f.startsWith(`${DATA_FILE_NAME}.corrupt-`))).toBe(true)
  })

  it('drops malformed tasks and invalid settings fields on load', async () => {
    await writeFile(
      path.join(dir, DATA_FILE_NAME),
      JSON.stringify({
        schemaVersion: 1,
        tasks: [{ id: 'a', title: 'ok', createdAt: '2026-01-01T00:00:00Z', status: 'active' }, { id: 5 }, 'junk'],
        settings: { language: 'en', notificationVolume: 999 }
      }),
      'utf8'
    )
    const store = makeStore()
    await store.load()
    expect(store.listTasks()).toHaveLength(1)
    expect(store.getSettings()).toMatchObject({ language: 'en', notificationVolume: 70 })
  })

  it('writes a readable JSON file with settings', async () => {
    const store = makeStore()
    await store.load()
    await store.updateSettings({ language: 'zh-CN' })
    const data = JSON.parse(await readFile(store.filePath, 'utf8'))
    expect(data.settings.language).toBe('zh-CN')
    expect(data.schemaVersion).toBe(5)
  })
})

const input = (title: string) => ({ title, description: '', timerDurationSec: null, themeOverride: null })

function v1Task(id: string, title: string, completedAt: string | null): Record<string, unknown> {
  return {
    id,
    title,
    description: '',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: completedAt ?? '2026-10-01T08:00:00.000Z',
    completedAt,
    status: completedAt ? 'completed' : 'active',
    timerConfig: null,
    themeOverride: null
  }
}

describe('Completion records and undo', () => {
  it('records each completion with its own id and a title snapshot', async () => {
    const store = makeStore()
    await store.load()
    const task = await store.createTask(input('Run 5 km'))
    const { event } = await store.completeTask(task.id)
    expect(event).toEqual({
      id: 'task-2',
      taskId: task.id,
      occurrence: null,
      completedAt: '2026-10-15T10:00:00.000Z',
      undoneAt: null,
      title: 'Run 5 km'
    })
    expect(store.listCompletions()).toHaveLength(1)
  })

  it('undo marks the record, reopens the task, and is idempotent', async () => {
    const store = makeStore()
    await store.load()
    const task = await store.createTask(input('Read'))
    const { event } = await store.completeTask(task.id)
    clock += 2000
    const undone = await store.undoCompletion(event!.id)
    expect(undone.undone).toBe(true)
    expect(undone.task).toMatchObject({ status: 'active', completedAt: null })
    // The record stays, marked; it is not deleted.
    expect(store.listCompletions()).toEqual([{ ...event, undoneAt: '2026-10-15T10:00:02.000Z' }])
    // Concurrent and repeated undos change nothing more.
    const again = await Promise.all([store.undoCompletion(event!.id), store.undoCompletion(event!.id)])
    expect(again.map((r) => r.undone)).toEqual([false, false])
    expect((await store.undoCompletion('unknown')).undone).toBe(false)
  })

  it('completing again after an undo is a new completion with a new id', async () => {
    const store = makeStore()
    await store.load()
    const task = await store.createTask(input('Stretch'))
    const first = await store.completeTask(task.id)
    await store.undoCompletion(first.event!.id)
    const second = await store.completeTask(task.id)
    expect(second.unlocked).toBe(true)
    expect(second.event!.id).not.toBe(first.event!.id)
    const counted = store.listCompletions().filter((e) => !e.undoneAt)
    expect(counted.map((e) => e.id)).toEqual([second.event!.id])
  })

  it('undoing one completion leaves every other one alone', async () => {
    const store = makeStore()
    await store.load()
    const a = await store.createTask(input('A'))
    const b = await store.createTask(input('B'))
    const ea = await store.completeTask(a.id)
    const eb = await store.completeTask(b.id)
    await store.undoCompletion(ea.event!.id)
    expect(store.listTasks().find((t) => t.id === b.id)?.status).toBe('completed')
    expect(store.listCompletions().find((e) => e.id === eb.event!.id)?.undoneAt).toBeNull()
  })

  it('keeps completions and undos across a restart', async () => {
    const store = makeStore()
    await store.load()
    const a = await store.createTask(input('A'))
    const b = await store.createTask(input('B'))
    const ea = await store.completeTask(a.id)
    await store.completeTask(b.id)
    await store.undoCompletion(ea.event!.id)
    await store.flush()
    const reloaded = makeStore()
    await reloaded.load()
    expect(reloaded.listTasks().map((t) => t.status)).toEqual(['active', 'completed'])
    expect(reloaded.listCompletions().map((e) => !!e.undoneAt)).toEqual([true, false])
    expect(reloaded.loadReport).toMatchObject({ migrated: false, createdCompletions: 0 })
  })

  it('deleting a task removes its records too', async () => {
    const store = makeStore()
    await store.load()
    const a = await store.createTask(input('A'))
    await store.completeTask(a.id)
    await store.deleteTask(a.id)
    expect(store.listCompletions()).toEqual([])
  })
})

describe('Migration from version 1', () => {
  it('creates one record per completed task, backs up the old file once, and keeps everything else', async () => {
    const original = JSON.stringify({
      schemaVersion: 1,
      tasks: [
        v1Task('a', 'Morning run', '2026-10-10T07:00:00.000Z'),
        v1Task('b', 'Still going', null),
        v1Task('c', 'Math homework', '2026-10-12T19:30:00.000Z')
      ],
      settings: { language: 'zh-CN', achievementTheme: 'classic' }
    })
    await writeFile(path.join(dir, DATA_FILE_NAME), original, 'utf8')
    const store = makeStore()
    await store.load()

    expect(store.listTasks().map((t) => [t.id, t.status])).toEqual([
      ['a', 'completed'],
      ['b', 'active'],
      ['c', 'completed']
    ])
    expect(store.listCompletions()).toEqual([
      { id: 'migrated-a', taskId: 'a', occurrence: null, completedAt: '2026-10-10T07:00:00.000Z', undoneAt: null, title: 'Morning run' },
      { id: 'migrated-c', taskId: 'c', occurrence: null, completedAt: '2026-10-12T19:30:00.000Z', undoneAt: null, title: 'Math homework' }
    ])
    expect(store.getSettings()).toMatchObject({ language: 'zh-CN', achievementTheme: 'classic' })
    expect(store.loadReport).toMatchObject({ fromVersion: 1, migrated: true, createdCompletions: 2, droppedTasks: 0 })

    // The backup is the old file byte for byte.
    const backup = path.join(dir, backupFileName(1))
    expect(await readFile(backup, 'utf8')).toBe(original)

    // Nothing is written until something changes; then the file is version 2 and the backup stays.
    await store.updateSettings({ language: 'en' })
    const data = JSON.parse(await readFile(store.filePath, 'utf8'))
    expect(data.schemaVersion).toBe(5)
    expect(data.completions).toHaveLength(2)
    expect(await readFile(backup, 'utf8')).toBe(original)

    // Loading again does not migrate twice or duplicate records.
    const again = makeStore()
    await again.load()
    expect(again.listCompletions().map((e) => e.id)).toEqual(['migrated-a', 'migrated-c'])
    expect(again.loadReport).toMatchObject({ migrated: false, createdCompletions: 0 })
  })

  it('never replaces an existing backup', async () => {
    await writeFile(path.join(dir, backupFileName(1)), 'older backup', 'utf8')
    await writeFile(
      path.join(dir, DATA_FILE_NAME),
      JSON.stringify({ schemaVersion: 1, tasks: [v1Task('a', 'A', '2026-10-10T07:00:00.000Z')], settings: {} }),
      'utf8'
    )
    const store = makeStore()
    await store.load()
    expect(await readFile(path.join(dir, backupFileName(1)), 'utf8')).toBe('older backup')
    expect(store.listCompletions()).toHaveLength(1)
  })

  it('repairs a hand-edited file: records follow the task status, orphans are dropped', async () => {
    await writeFile(
      path.join(dir, DATA_FILE_NAME),
      JSON.stringify({
        schemaVersion: 5,
        tasks: [v1Task('a', 'A', '2026-10-10T07:00:00.000Z'), v1Task('b', 'B', null)],
        completions: [
          { id: 'e1', taskId: 'a', occurrence: null, completedAt: '2026-10-09T07:00:00.000Z', undoneAt: null, title: 'A' },
          { id: 'e2', taskId: 'a', occurrence: null, completedAt: '2026-10-10T07:00:00.000Z', undoneAt: null, title: 'A' },
          { id: 'e3', taskId: 'b', occurrence: null, completedAt: '2026-10-10T07:00:00.000Z', undoneAt: null, title: 'B' },
          { id: 'e4', taskId: 'gone', occurrence: null, completedAt: '2026-10-10T07:00:00.000Z', undoneAt: null, title: 'X' },
          { id: 'bad' }
        ],
        settings: {}
      }),
      'utf8'
    )
    const store = makeStore()
    await store.load()
    const counted = store.listCompletions().filter((e) => !e.undoneAt)
    expect(counted.map((e) => e.id)).toEqual(['e2'])
    expect(store.listCompletions().map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
    expect(store.loadReport).toMatchObject({ migrated: false, droppedCompletions: 2 })
  })
})
