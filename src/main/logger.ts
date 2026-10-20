import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { format } from 'node:util'

/** The current log is moved to `main.old.log` when it grows past this size at startup. */
const MAX_BYTES = 1024 * 1024

/**
 * Copies the main process's console output into `<userData>/logs/main.log`, so problems on an
 * installed copy (which has no console) can be looked at afterwards. Tasks and settings are never
 * logged, only messages the app already prints. Logging can never break the app.
 */
export function startFileLog(userDataDir: string): string {
  const dir = path.join(userDataDir, 'logs')
  const file = path.join(dir, 'main.log')
  try {
    mkdirSync(dir, { recursive: true })
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) {
      rmSync(path.join(dir, 'main.old.log'), { force: true })
      renameSync(file, path.join(dir, 'main.old.log'))
    }
  } catch {
    // Keep going; each line below tries again on its own.
  }
  const write = (level: string, args: unknown[]): void => {
    try {
      appendFileSync(file, `${new Date().toISOString()} ${level} ${format(...args)}\n`, 'utf8')
    } catch {
      // A full disk or a locked file must not take the app down.
    }
  }
  for (const level of ['info', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      write(level.toUpperCase(), args)
    }
  }
  process.on('unhandledRejection', (reason) => console.error('[App] Unhandled rejection', reason))
  write('INFO', [`[App] Started, pid ${process.pid}`])
  return file
}
