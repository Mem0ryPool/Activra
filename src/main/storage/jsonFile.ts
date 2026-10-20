import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const RETRIES = 5
/** Windows antivirus, indexers and backup tools briefly lock files; these codes are worth a retry. */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= RETRIES || !code || !TRANSIENT.has(code)) throw error
      await sleep(50 * (attempt + 1))
    }
  }
}

/**
 * Writes JSON atomically: write a temp file, flush it to disk, then rename over the target.
 * The flush means a power cut leaves either the old file or the complete new one, never an
 * empty file. Each write uses its own temp name, so two writes can never mix their bytes.
 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`
  try {
    const handle = await fs.open(tmpPath, 'w')
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await withRetry(() => fs.rename(tmpPath, filePath))
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

export type ReadJsonResult = { kind: 'missing' } | { kind: 'ok'; value: unknown } | { kind: 'corrupt' }

export async function readJson(filePath: string): Promise<ReadJsonResult> {
  let text: string
  try {
    text = await withRetry(() => fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    throw error
  }
  try {
    return { kind: 'ok', value: JSON.parse(text) as unknown }
  } catch {
    return { kind: 'corrupt' }
  }
}

/** Keeps an unreadable file aside instead of silently overwriting the user's data. */
export async function quarantineFile(filePath: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${filePath}.corrupt-${stamp}`
  await withRetry(() => fs.rename(filePath, target))
  return target
}
