# Data file versions and migration

All app data lives in `life-unlocked-data.json` in the data folder (Settings → Data → Open folder;
on Windows `%APPDATA%\Life Unlocked`). It is owned by `DataStore` (`src/main/storage/dataStore.ts`)
and written atomically (temp file + rename).

## Safety rules (Phase 5)

- **Atomic and flushed:** every write goes to its own temp file, which is flushed to disk before it
  is renamed over the real file. A crash or power cut leaves either the old file or the complete
  new one. Leftover `*.tmp` files are harmless and can be deleted.
- **Quit waits for writes:** quitting (tray menu, close with "quit") waits up to
  3 seconds for changes still being written. (Windows shutdown or sign-out ends the app without
  this step; the atomic write still keeps the file whole, a change made in the last instant may be lost.)
- **Daily backups:** once per local day, before the first change of that day, the data file is
  copied to `backups/life-unlocked-data-YYYY-MM-DD.json` (the state the previous day ended with).
  The newest 10 copies are kept; only files with exactly that name pattern are ever removed.
- **Unreadable file:** a data file that is not valid JSON, is empty, or is not a JSON object is never
  overwritten. It is renamed to `life-unlocked-data.json.corrupt-<time>`, the newest readable daily
  backup is copied into its place, and a dialog says what happened (with "Open data folder"). With
  no usable backup the app starts empty and says so; the broken file is still kept.
- **File from a newer version:** a file with a higher `schemaVersion` is copied byte for byte to
  `life-unlocked-data.v<N>-backup.json` before anything is written, and a dialog recommends
  installing the newer version again.
- **Log:** `logs/main.log` (rotated to `main.old.log` past 1 MB) holds the app's own messages
  (start, migration, recovery, errors). Task titles and settings are never written to it.

### Restoring a backup by hand

1. Quit Life Unlocked from the tray menu (closing the window may only hide it).
2. In the data folder, rename `life-unlocked-data.json` (for example to `…-before-restore.json`).
3. Copy the backup you want (from `backups/`, or a `.v1-backup.json`) and rename the copy to
   `life-unlocked-data.json`.
4. Start Life Unlocked. An older version's file is migrated again as described below.

## Versions

| `schemaVersion` | Added in | Contents |
| --- | --- | --- |
| 1 | Phase 1 | `tasks`, `settings` |
| 2 | Phase 4B | adds `completions`: one record per completion (`id`, `taskId`, `occurrence`, `completedAt`, `undoneAt`, `title`) |
| 3 | Phase 6 | adds `plans` (Smart Achievement Planner); `tasks`, `completions` and `settings` are unchanged |
| 4 | Phase 6.1 | adds `window` to tasks (null for every existing task) and interval goals with `nodeTaskIds` to plans |
| 5 | Phase 6.6 | adds `habits` and `habitCheckins`; `tasks`, `completions`, `plans` and `settings` are unchanged |

Fields added to tasks within version 2 (missing fields load as their defaults, so no version bump):

| Field | Default | Meaning |
| --- | --- | --- |
| `recurrence` | `null` | repeat rule: `preset`, `unit`, `interval`, `weekdays`, `startDate`, `endDate` |
| `recurrenceHistory` | `[]` | earlier rules and the last day each decided (`{ rule, until }`), oldest first |
| `skippedOccurrences` | `[]` | dates skipped with "Skip this time" |
| `due` | `null` | deadline `{ date, time }`; `date` is null for a repeating task, `time` null for date only |
| `reminderMinutes` | `null` | remind this many minutes before (0–10080); dropped without a deadline |

Settings gain `reminders` (`enabled`, `defaultMinutes`, `sound`, `allDayTime`), restored field by
field like the widget settings. Sent reminders are remembered in a separate file,
`reminder-state.json` (entries older than 30 days are forgotten); deleting it can at most re-send
reminders of the last 30 minutes.

## Migration 1 → 2

Runs automatically on the first start of a 4B build. Nothing is written until the first change.

1. Before anything else, the original file is copied, byte for byte, to
   `life-unlocked-data.v1-backup.json` next to it. An existing backup is never replaced.
2. Each task with `status: "completed"` gets exactly one completion record with id
   `migrated-<taskId>`, its own `completedAt` and its title. No record is invented for a task that
   was not completed, and ids are derived from the task, so loading the same file twice gives the
   same result.
3. Tasks and settings are restored field by field exactly as before; nothing else changes.
4. The result is checked: every completed one-off task has exactly one counted record, every other
   task none. A mismatch is logged (`[DataStore] Completion check failed …`).

The same reconciliation runs on every load, so a hand-edited file is repaired the same way: for a
one-off task its own `status` decides; records of tasks that no longer exist are dropped.

## Migration 2 → 3 (Phase 6)

Runs automatically on the first start of a Phase 6 build; nothing else in the file changes.

1. Before the first write, the version 2 file is copied byte for byte to
   `life-unlocked-data.v2-backup.json` (an existing copy is never replaced).
2. `plans` starts empty. Tasks, completion records and settings are read exactly as in version 2.
3. Going back to a Phase 5 build: it sees a newer file, keeps its own copy
   (`life-unlocked-data.v3-backup.json`) and shows the "newer version" notice. It keeps tasks,
   completions and settings but does not know `plans`, so plans (not their tasks) are lost on its
   next write; restore the v3 copy after reinstalling Phase 6 to get them back.

## Migration 3 → 4 (Phase 6.1)

Runs automatically on the first start of a Phase 6.1 build; nothing existing changes meaning.

1. Before the first write, the version 3 file is copied byte for byte to
   `life-unlocked-data.v3-backup.json` (an existing copy is never replaced).
2. Every task loads with `window: null`; every goal with `nodeTaskIds: []`. Completion records,
   settings and existing plans are read exactly as in version 3.
3. Going back to a Phase 6 build: it sees a newer file, keeps `life-unlocked-data.v4-backup.json` and
   shows the "newer version" notice. It drops plans with interval goals (it cannot read them) on its
   next write and treats their node tasks as ordinary one-off tasks; restore the v4 copy after
   reinstalling Phase 6.1 to get them back.

### Timed plan nodes (interval goals)

"接下来的4个小时内每个小时都喝水" is one goal with `condition: { kind: 'interval', start, minutes, count }`.
`start` (ISO instant) is set by the main process when the goal starts: when the plan is confirmed,
or when the step before it is achieved, floored to the minute. Each window becomes one one-off task
with `window: { start, end }` (ISO instants, end exclusive), listed in order in the goal's
`nodeTaskIds` (`taskId` is the first).

- `DataStore.completeTask` records a completion only while the task's window is open, by the clock at
  that moment. A node counts when its task has a completion whose time lies in the window; once the
  window has closed without one it is missed and the goal can no longer be achieved.
- Nothing is decided by a timer: the state is a function of the stored windows, the completion
  records and the current time, so restarts, sleep, midnight and time-zone changes give the same
  answer. Moving the clock only changes which windows are open now; recorded completions keep
  counting where they fall.
- A window, a node's repeat rule or deadline cannot be edited; renaming is allowed.

### Plans

Each plan: `id`, `title`, `sourceText`, `createdAt`, `updatedAt`, `goals`, `master` (the
"全成就！" achievement or null) and `unlocks`. Each goal: `id`, `title`, `category`, `quantity`,
`condition` (`once` / `count` / `weekly` / `streak` / `interval`, see `src/shared/planner/types.ts`), `after`
(the goal it waits for, or null), `taskId`, `nodeTaskIds` (interval goals only), `startedOn` and `achievement`.

- A goal is measured on its own task and that task's completion records only; progress is computed
  on demand (`src/shared/planner/progress.ts`) and never stored.
- `unlocks` work like completion records: a record is added when a goal (or the whole plan) meets its
  rule, and marked `revokedAt` when it no longer does (undo, deleted task). Records are never deleted;
  a later unlock is a new record, so a notification is never shown twice.
- A plan that cannot be read is dropped on load (logged; `loadReport.droppedPlans`); the rest of
  the file is kept. Deleting a plan keeps its tasks and their completion records.

## Migration 4 → 5 (Phase 6.6)

Runs automatically on the first start of a Phase 6.6 build; nothing existing changes meaning.

1. Before the first write, the version 4 file is copied byte for byte to
   `life-unlocked-data.v4-backup.json`. An existing copy is never replaced; if one exists and differs
   (e.g. upgrading again after going back to an older version), the file is kept as
   `life-unlocked-data.v4-backup-<time>.json` next to it.
2. Tasks, completion records, plans (with their unlocks) and settings are read exactly as in
   version 4; `habits` and `habitCheckins` start empty.
3. While there are habits, every write also writes `life-unlocked-habits-mirror.json` (habits and
   check-ins only, written atomically after the data file). Once it exists it is kept current, also
   after the last habit is deleted, so a stale copy can never bring deleted habits back.
4. Going back to an older build (schema 4, e.g. 1.0.0-rc.2): it sees a newer file, copies it to
   `life-unlocked-data.v5-backup.json` (only if that name is still free) and shows the "newer version"
   notice. Tasks, plans and settings work as before; on its next write it drops `habits` and
   `habitCheckins` from the data file. It never touches the mirror.
5. Upgrading again: a data file without `habits` takes the habits and check-ins from the mirror
   (logged; `loadReport.restoredHabits`), so nothing done before going back is lost. Habits cannot be
   changed by an older build, so the mirror is still current.

### Habits

Each habit: `id`, `name`, `note`, `frequency` (`{ kind: 'daily' }`, `{ kind: 'weekly', timesPerWeek }` or the
custom `{ kind: 'weekdays', weekdays }` with 0 = Sunday … 6 = Saturday),
`startDate` (local day it was created), `state` (`active` / `paused` / `archived`), `pauses`
(`{ from, until }` local dates, `until` null while still paused), `createdAt`, `updatedAt`, `archivedAt`.
Each check-in: `id`, `habitId`, `date` (local day), `checkedAt`, `undoneAt`.

- A check-in is never a task completion: statistics, the calendar, achievements, plans, the widget
  and the tray do not count it. Only a streak milestone (3/7/14/21/30/50/100/200/365 days, or
  2/4/8/12/26/52 weeks) shows an achievement card, once per habit, milestone and day.
- Only today can be checked in (yesterday too in the first 10 minutes after midnight); there is no
  checking in for earlier days. Paused and archived habits cannot be checked in. Each day counts at
  most once: the check and the record happen before any await, and a duplicate found on load
  (hand edits only) is marked undone.
- Deleting a habit (asked first; archiving is offered instead) removes it and its check-ins for good.
- Cancelling marks the check-in `undoneAt`; only today's (and yesterday's in the grace minutes) can
  be cancelled, so a past day can never be lost by mistake.
- Streaks are derived on demand (`src/shared/habits/streak.ts`), never stored. Daily: the run of
  checked-in days ending today, or yesterday while today is still open. Weekly (Monday weeks): the run
  of weeks with at least `timesPerWeek` check-ins; the current week only counts once it is met.
  Custom: like daily, on the chosen days only; other days are not scheduled, cannot be checked in
  and neither break nor extend the streak.
  Paused days, and days before the start, neither break nor extend a streak; a week with such days
  that is not met is excused. A new frequency applies to the whole history.
- The day of a check-in is decided by the main process when it is made and never recomputed, so a
  later time-zone change keeps it on its date.

## Focus timer file (Phase 6.7, no schema change)

The focus timer keeps its own file, `life-unlocked-focus.json`, next to the data file. The data file
stays schema 5 and is never written by the timer. The file holds `version` (1), `durations` (minutes),
`state` (the current run: `startedAt`, `resumedAt`, `elapsedMs`; the next phase, the chosen task, the
cycle) and `sessions` (one record per focus run that ended: `completed` or `ended-early`, with the
seconds actually focused; a run's id is its record's id, so it is recorded at most once).

- Time is derived from timestamps, so background windows, sleep and restarts do not drift. A run that
  ran out while the app was closed is recorded at the moment it ran out; a clock set back while closed
  re-bases the run (never negative time). A system time change while running is detected by comparing
  wall and monotonic time and re-bases the running stretch.
- Daily copies go to `backups/life-unlocked-focus-YYYY-MM-DD.json` (newest 10 kept). An unreadable file
  is renamed to `life-unlocked-focus.json.corrupt-<time>` and the timer starts empty; tasks, habits and
  settings are not affected.
- Rollback: an older version never reads or writes this file, so going back and forth keeps both the
  data file and the focus records.

## Undo rules

- Undoing marks the record with `undoneAt`; it is never deleted. Achievements, statistics, the
  calendar, the streak and the widget only count records without `undoneAt`.
- An undo withdraws exactly the achievement of that one completion. Plan achievements that depended
  on it (a goal's count, the plan's "全成就！") are re-checked by the same rules and withdrawn too
  if they no longer hold.
- Completing the task again creates a new record with a new id (a new achievement).
- An achievement toast that is still waiting is dropped; one already on screen finishes playing.
- Undo is idempotent: undoing the same record twice changes nothing the second time.
- Deleting a task removes its records too, as before.

## Repeating tasks

- A repeating task is a template: its own `status` stays `active`. Occurrences are not stored ahead
  of time; each day is derived from the rule. Completing one stores a completion record with that
  date as `occurrence` (instance id `<taskId>@<date>`).
- Only today's occurrence can be completed (yesterday's too in the first 10 minutes after
  midnight, for a click that raced the date change). A missed day is never completed
  automatically and never unlocks anything; it is only shown as "not done" in the calendar.
- Editing the rule applies from today on: the previous rule moves into `recurrenceHistory` with
  `until` = yesterday, so past days keep the plan they had. Past completions never change.
- Days before the task was created are never planned (no invented history).

## Deadlines and reminders

- A deadline never completes or fails a task. Past it, the task shows "Overdue …" with how long.
- Timed deadline: overdue from that time. Date only: due by the end of the day, overdue from
  00:00 the next day; its reminder is counted from the "reminder time for date-only deadlines"
  setting (default 09:00) on the due day.
- Each reminder has a key (`task@occurrence@date+time@offset`). It is recorded before it is shown,
  so it is sent at most once; editing the deadline or offset makes a new key.
- Catch-up after sleep, a closed app or a clock change: reminders up to 30 minutes late are still
  sent, older ones are recorded as skipped silently, more than 3 at once become one summary.

## Rolling back to an older version

- **Recommended:** quit Life Unlocked, then replace `life-unlocked-data.json` with
  `life-unlocked-data.v1-backup.json` (rename it). This returns to exactly the data you had before
  the upgrade; anything done after the upgrade is lost.
- **Without the backup:** an older version (e.g. v0.3) can read a version 2 file: tasks, their
  completed state and settings load normally. It ignores `completions` and drops it on its next
  write. Undone completions are already shown as "in progress" in the task itself, so nothing
  reappears. If you later upgrade again, the records are recreated from the completed tasks.
  Repeating tasks show up there as ordinary in-progress tasks and lose their repeat rule on the
  older version's next write; their completion history is lost with `completions`. Deadlines and
  reminder settings are dropped the same way. Use the backup if that matters.
