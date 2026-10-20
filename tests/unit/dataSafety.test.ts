import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BACKUP_DIR,
  DATA_FILE_NAME,
  DataStore,
  KEEP_BACKUPS,
  backupFileName,
  dailyBackupName
} from '../../src/main/storage/dataStore'
import { readJson, writeJsonAtomic } from '../../src/main/storage/jsonFile'

let dir: string
let clock: number
let seq: number

function makeStore(): DataStore {
  return new DataStore({ directory: dir, now: () => new Date(clock), createId: () => `id-${++seq}` })
}

const dataFile = (): string => path.join(dir, DATA_FILE_NAME)
const backupDir = (): string => path.join(dir, BACKUP_DIR)

async function storeWithTask(title: string): Promise<DataStore> {
  const store = makeStore()
  await store.load()
  await store.createTask({ title, description: '', timerDurationSec: null, themeOverride: null })
  return store
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lu-safety-'))
  clock = new Date(2026, 9, 15, 10, 0).getTime()
  seq = 0
})

describe('Daily backups', () => {
  it('copies the file as it was before the first change of each day', async () => {
    const first = await storeWithTask('Day one')
    await first.flush()
    // Nothing existed before the first write, so there was nothing to copy.
    expect(await readdir(backupDir()).catch(() => [])).toEqual([])

    clock = new Date(2026, 9, 16, 9, 0).getTime()
    const second = makeStore()
    await second.load()
    const copy = path.join(backupDir(), dailyBackupName('2026-10-16'))
    const saved = JSON.parse(await readFile(copy, 'utf8')) as { tasks: { title: string }[] }
    expect(saved.tasks.map((t) => t.title)).toEqual(['Day one'])

    // Later changes that day never replace the copy.
    await second.createTask({ title: 'Day two', description: '', timerDurationSec: null, themeOverride: null })
    const again = JSON.parse(await readFile(copy, 'utf8')) as { tasks: unknown[] }
    expect(again.tasks).toHaveLength(1)
  })

  it('makes a new copy when the app stays open past midnight', async () => {
    const store = await storeWithTask('Before midnight')
    clock = new Date(2026, 9, 16, 0, 5).getTime()
    await store.createTask({ title: 'After midnight', description: '', timerDurationSec: null, themeOverride: null })
    const copy = JSON.parse(await readFile(path.join(backupDir(), dailyBackupName('2026-10-16')), 'utf8')) as {
      tasks: { title: string }[]
    }
    expect(copy.tasks.map((t) => t.title)).toEqual(['Before midnight'])
  })

  it(`keeps only the newest ${KEEP_BACKUPS} copies and never touches other files`, async () => {
    await mkdir(backupDir(), { recursive: true })
    for (let d = 1; d <= 12; d++) {
      await writeFile(path.join(backupDir(), dailyBackupName(`2026-09-${String(d).padStart(2, '0')}`)), '{}')
    }
    await writeFile(path.join(backupDir(), 'my-notes.txt'), 'keep me')
    await (await storeWithTask('x')).flush()
    await storeWithTask('y').then((s) => s.flush())
    clock = new Date(2026, 9, 16, 9, 0).getTime()
    const store = makeStore()
    await store.load()
    const files = await readdir(backupDir())
    const copies = files.filter((f) => f.startsWith('life-unlocked-data-')).sort()
    expect(copies).toHaveLength(KEEP_BACKUPS)
    expect(copies.at(-1)).toBe(dailyBackupName('2026-10-16'))
    expect(copies[0]).toBe(dailyBackupName('2026-09-05'))
    expect(copies).toContain(dailyBackupName('2026-10-15'))
    expect(files).toContain('my-notes.txt')
  })
})

describe('Unreadable data file', () => {
  it('restores the newest readable daily copy and keeps the broken file', async () => {
    await mkdir(backupDir(), { recursive: true })
    const good = { schemaVersion: 2, tasks: [], completions: [], settings: {} }
    const older = { ...good, tasks: [{ id: 'a', title: 'Older', createdAt: '2026-10-01T00:00:00Z', status: 'active' }] }
    const newer = { ...good, tasks: [{ id: 'b', title: 'Newer', createdAt: '2026-10-02T00:00:00Z', status: 'active' }] }
    await writeFile(path.join(backupDir(), dailyBackupName('2026-10-13')), JSON.stringify(older))
    await writeFile(path.join(backupDir(), dailyBackupName('2026-10-14')), JSON.stringify(newer))
    // The newest copy is itself broken, so the one before it is used.
    await writeFile(path.join(backupDir(), dailyBackupName('2026-10-15')), '{"tasks": [')
    await writeFile(dataFile(), '{"schemaVersion": 2, "tasks": [', 'utf8')

    const store = makeStore()
    await store.load()
    expect(store.listTasks().map((t) => t.title)).toEqual(['Newer'])
    const notice = store.startupNotice
    expect(notice?.kind).toBe('recovered')
    expect(notice?.kind === 'recovered' && path.basename(notice.restoredFrom)).toBe(dailyBackupName('2026-10-14'))
    // The restored data is already on disk, so it survives even without a further change.
    const reloaded = makeStore()
    await reloaded.load()
    expect(reloaded.listTasks().map((t) => t.title)).toEqual(['Newer'])
    expect(reloaded.startupNotice).toBeNull()
    const kept = (await readdir(dir)).find((f) => f.startsWith(`${DATA_FILE_NAME}.corrupt-`)) as string
    expect(await readFile(path.join(dir, kept), 'utf8')).toBe('{"schemaVersion": 2, "tasks": [')
  })

  it('says so when there is no copy to restore, and keeps the broken file', async () => {
    await writeFile(dataFile(), '', 'utf8')
    const store = makeStore()
    await store.load()
    expect(store.listTasks()).toEqual([])
    expect(store.startupNotice?.kind).toBe('unrecoverable')
    expect((await readdir(dir)).some((f) => f.startsWith(`${DATA_FILE_NAME}.corrupt-`))).toBe(true)
  })

  it.each([['null'], ['[]'], ['42'], ['"text"']])('never overwrites valid JSON that is not data (%s)', async (text) => {
    await writeFile(dataFile(), text, 'utf8')
    const store = makeStore()
    await store.load()
    await store.createTask({ title: 'New', description: '', timerDurationSec: null, themeOverride: null })
    const kept = (await readdir(dir)).find((f) => f.startsWith(`${DATA_FILE_NAME}.corrupt-`)) as string
    expect(await readFile(path.join(dir, kept), 'utf8')).toBe(text)
    expect(store.startupNotice?.kind).toBe('unrecoverable')
  })
})

describe('A file from a newer version', () => {
  it('is copied aside before anything is written, and reported', async () => {
    const raw = JSON.stringify({ schemaVersion: 6, tasks: [], completions: [], plans: [], settings: {}, futureField: [1, 2] })
    await writeFile(dataFile(), raw, 'utf8')
    const store = makeStore()
    await store.load()
    expect(store.startupNotice).toEqual({
      kind: 'newer-version',
      version: 6,
      backup: path.join(dir, backupFileName(6))
    })
    await store.createTask({ title: 'New', description: '', timerDurationSec: null, themeOverride: null })
    expect(await readFile(path.join(dir, backupFileName(6)), 'utf8')).toBe(raw)
  })
})

describe('Atomic writes', () => {
  it('leaves no temp files behind and concurrent writes never mix', async () => {
    const file = path.join(dir, 'state.json')
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeJsonAtomic(file, { i, pad: 'x'.repeat(5000) })))
    const result = await readJson(file)
    expect(result.kind).toBe('ok')
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('flush waits for every queued change', async () => {
    const store = makeStore()
    await store.load()
    for (let i = 0; i < 5; i++) {
      void store.createTask({ title: `T${i}`, description: '', timerDurationSec: null, themeOverride: null })
    }
    await store.flush()
    const saved = JSON.parse(await readFile(dataFile(), 'utf8')) as { tasks: unknown[] }
    expect(saved.tasks).toHaveLength(5)
  })
})

describe('Upgrading keeps everything', () => {
  it('a file written by v0.3 (version 1) and by v0.4b (version 2) keeps tasks, history and settings', async () => {
    const v1 = {
      schemaVersion: 1,
      tasks: [
        {
          id: 'done',
          title: '读完一本书',
          description: 'd',
          createdAt: '2026-10-01T08:00:00.000Z',
          updatedAt: '2026-10-02T08:00:00.000Z',
          completedAt: '2026-10-02T08:00:00.000Z',
          status: 'completed',
          timerConfig: null,
          themeOverride: 'legendary'
        }
      ],
      settings: { language: 'zh-CN', achievementTheme: 'enhanced', appearance: 'light', closeAction: 'quit' }
    }
    await writeFile(dataFile(), JSON.stringify(v1), 'utf8')
    const store = makeStore()
    await store.load()
    await store.updateSettings({})
    const v2Text = await readFile(dataFile(), 'utf8')

    // v0.4b → this version: the version 2 file loads to exactly the same state.
    const again = makeStore()
    await again.load()
    expect(again.loadReport?.migrated).toBe(false)
    expect(again.listTasks()).toEqual(store.listTasks())
    expect(again.listCompletions()).toEqual(store.listCompletions())
    expect(again.getSettings()).toEqual(store.getSettings())
    expect(again.getSettings()).toMatchObject({ language: 'zh-CN', achievementTheme: 'enhanced', appearance: 'light', closeAction: 'quit' })
    expect(again.listTasks()[0]).toMatchObject({ title: '读完一本书', status: 'completed', themeOverride: 'legendary' })
    expect(again.listCompletions()).toHaveLength(1)
    await again.updateSettings({})
    expect(await readFile(dataFile(), 'utf8')).toBe(v2Text)
  })
})
