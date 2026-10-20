import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_DIR, DATA_FILE_NAME, DataStore, backupFileName } from '../../src/main/storage/dataStore'
import type { PlanInput } from '../../src/shared/planner/types'

/**
 * `fixtures/phase5-v2-data.json` was written by the Windows-validated Phase 5 build (81e665c) through
 * its own DataStore: a one-off task, a task with a deadline and reminder, and a repeating task whose
 * rule was edited (recurrenceHistory), with a skipped day, an undone and a redone completion, and
 * changed settings (language, theme, appearance, close to tray, widget). This build must open it as
 * it is and keep every one of those, plus the window state files next to it.
 */
const FIXTURE = path.join(__dirname, 'fixtures', 'phase5-v2-data.json')

let dir: string
let clock: number
let seq: number

const makeStore = (): DataStore =>
  new DataStore({ directory: dir, now: () => new Date(clock), createId: () => `id-${++seq}` })

const SIDE_FILES: Record<string, string> = {
  'window-state.json': JSON.stringify({ x: 120, y: 80, width: 900, height: 561, maximized: false }),
  'widget-state.json': JSON.stringify({ x: 1500, y: 60 }),
  'tray-state.json': JSON.stringify({ closeHintShown: true }),
  'reminder-state.json': JSON.stringify({ sent: ['p5-002@2026-10-20T17:00'] })
}

const plan: PlanInput = {
  title: 'New plan',
  sourceText: 'run every day for 3 days',
  goals: [
    {
      key: 'run',
      title: 'Run',
      category: 'general',
      quantity: null,
      condition: { kind: 'count', startDate: null, days: 3, every: 1, required: 3 },
      afterKey: null,
      achievement: { name: 'Runner', description: '', icon: 'target', rarity: 'common' }
    }
  ],
  master: null
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lu-upgrade-p5-'))
  clock = new Date(2026, 9, 14, 10, 0).getTime()
  seq = 0
})

describe('Upgrading a Phase 5 (81e665c) data file to the merged Phase 6 build', () => {
  it('keeps tasks, completion history, repeating rules, settings and window state; backs up before writing', async () => {
    const original = await readFile(FIXTURE, 'utf8')
    const v2 = JSON.parse(original) as {
      tasks: Record<string, unknown>[]
      completions: Record<string, unknown>[]
      settings: Record<string, unknown>
    }
    await writeFile(path.join(dir, DATA_FILE_NAME), original, 'utf8')
    for (const [name, text] of Object.entries(SIDE_FILES)) await writeFile(path.join(dir, name), text, 'utf8')
    await mkdir(path.join(dir, BACKUP_DIR))
    await writeFile(path.join(dir, BACKUP_DIR, 'life-unlocked-data-2026-10-13.json'), original, 'utf8')

    const store = makeStore()
    await store.load()
    expect(store.loadReport).toMatchObject({
      fromVersion: 2,
      migrated: true,
      createdCompletions: 0,
      droppedTasks: 0,
      droppedCompletions: 0,
      droppedPlans: 0
    })
    expect(store.startupNotice).toBeNull()
    // Loading alone writes nothing and announces nothing.
    expect(await readFile(path.join(dir, DATA_FILE_NAME), 'utf8')).toBe(original)
    expect(store.takePlanEvents()).toEqual({ unlocked: [], revoked: [] })

    const tasks = store.listTasks()
    // Fields Phase 5 leaves out when empty (description, themeOverride) load as their defaults, exactly
    // as Phase 5 itself reads them; `window` (schema 4) is null for every existing task; nothing else changes.
    expect(tasks).toEqual(v2.tasks.map((t) => ({ description: '', themeOverride: null, ...t, window: null })))
    expect(store.listCompletions()).toEqual(v2.completions)
    // Everything as saved, except the removed "Activra Chime", which now plays the bright chime.
    const customTheme = v2.settings.customTheme as Record<string, unknown>
    expect(store.getSettings()).toMatchObject({ ...v2.settings, customTheme: { ...customTheme, sound: customTheme.sound === 'chime' ? 'bright' : customTheme.sound } })
    expect(store.snapshot().plans).toEqual([])

    // The first change writes the current version (4), after copying the version 2 file byte for byte.
    await store.createPlan(plan)
    await store.flush()
    expect(await readFile(path.join(dir, backupFileName(2)), 'utf8')).toBe(original)
    const saved = JSON.parse(await readFile(path.join(dir, DATA_FILE_NAME), 'utf8'))
    expect(saved.schemaVersion).toBe(5)
    expect(saved.plans).toHaveLength(1)
    expect(saved.tasks.slice(0, v2.tasks.length)).toEqual(tasks)
    expect(saved.tasks).toHaveLength(v2.tasks.length + 1)
    expect(saved.completions).toEqual(v2.completions)
    expect(saved.settings).toEqual(store.getSettings())

    // Window, widget, tray and reminder state belong to other files and are untouched.
    for (const [name, text] of Object.entries(SIDE_FILES)) {
      expect(await readFile(path.join(dir, name), 'utf8')).toBe(text)
    }
    // The earlier daily backup is kept; today's is the version 2 file as it was before the change.
    const backups = (await readdir(path.join(dir, BACKUP_DIR))).sort()
    expect(backups).toEqual(['life-unlocked-data-2026-10-13.json', 'life-unlocked-data-2026-10-14.json'])
    expect(await readFile(path.join(dir, BACKUP_DIR, 'life-unlocked-data-2026-10-14.json'), 'utf8')).toBe(original)

    // Opening again: no second migration, same state, the backup is never replaced.
    const again = makeStore()
    await again.load()
    expect(again.loadReport).toMatchObject({ fromVersion: 5, migrated: false })
    expect(again.listTasks()).toEqual(store.listTasks())
    expect(again.listCompletions()).toEqual(v2.completions)
    expect(again.getSettings()).toEqual(store.getSettings())
    expect(again.takePlanEvents()).toEqual({ unlocked: [], revoked: [] })
    expect(await readFile(path.join(dir, backupFileName(2)), 'utf8')).toBe(original)
  })
})
