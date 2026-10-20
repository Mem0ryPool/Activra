import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ICON_MAX_BYTES, SOUND_MAX_BYTES } from '../shared/constants'
import type { AssetKind } from '../shared/types'
import { ASSET_ID_PATTERN } from '../shared/validation'

/** Extension each detected format is stored under. */
type Format = 'png' | 'jpg' | 'webp' | 'gif' | 'mp3' | 'wav' | 'ogg' | 'm4a'

const ICON_FORMATS: readonly Format[] = ['png', 'jpg', 'webp', 'gif']
const SOUND_FORMATS: readonly Format[] = ['mp3', 'wav', 'ogg', 'm4a']

export const IMPORT_FILTERS: Record<AssetKind, { name: string; extensions: string[] }> = {
  icon: { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
  sound: { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }
}

const MIME: Record<Format, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4'
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

/** Detects the real file type from its first bytes; the file extension is not trusted. */
export function sniffFormat(head: Uint8Array): Format | null {
  if (head.length < 12) return null
  if (head[0] === 0x89 && ascii(head, 1, 3) === 'PNG') return 'png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg'
  if (ascii(head, 0, 4) === 'GIF8') return 'gif'
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'webp'
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return 'wav'
  if (ascii(head, 0, 4) === 'OggS') return 'ogg'
  if (ascii(head, 4, 4) === 'ftyp') return 'm4a'
  if (ascii(head, 0, 3) === 'ID3') return 'mp3'
  if (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) return 'mp3'
  return null
}

export type ImportOutcome = { ok: true; assetId: string } | { ok: false; reason: 'too-large' | 'unsupported' }

/** Stores user-imported icons and sounds inside the app's own data folder. */
export class AssetStore {
  constructor(readonly directory: string) {}

  async import(kind: AssetKind, sourcePath: string): Promise<ImportOutcome> {
    const stat = await fs.stat(sourcePath)
    if (!stat.isFile()) return { ok: false, reason: 'unsupported' }
    if (stat.size > (kind === 'icon' ? ICON_MAX_BYTES : SOUND_MAX_BYTES)) return { ok: false, reason: 'too-large' }
    const data = await fs.readFile(sourcePath)
    const format = sniffFormat(data.subarray(0, 16))
    const allowed = kind === 'icon' ? ICON_FORMATS : SOUND_FORMATS
    if (!format || !allowed.includes(format)) return { ok: false, reason: 'unsupported' }
    const assetId = `${randomUUID()}.${format}`
    await fs.mkdir(this.directory, { recursive: true })
    await fs.writeFile(path.join(this.directory, assetId), data)
    return { ok: true, assetId }
  }

  /** Resolves an asset id to a path inside the asset folder, or null if the id is not one we generate. */
  resolve(assetId: string): { filePath: string; mime: string } | null {
    if (!ASSET_ID_PATTERN.test(assetId)) return null
    const format = assetId.split('.').pop() as Format
    return { filePath: path.join(this.directory, assetId), mime: MIME[format] }
  }

  async remove(assetId: string | null): Promise<void> {
    const resolved = assetId ? this.resolve(assetId) : null
    if (!resolved) return
    await fs.rm(resolved.filePath, { force: true })
  }
}
