import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../..')
const file = (name: string): Buffer => readFileSync(path.join(root, name))

interface IcoEntry {
  size: number
  png: boolean
  data: Buffer
}

function readIco(buf: Buffer): IcoEntry[] {
  expect(buf.readUInt16LE(0)).toBe(0)
  expect(buf.readUInt16LE(2)).toBe(1)
  return Array.from({ length: buf.readUInt16LE(4) }, (_, i) => {
    const at = 6 + 16 * i
    const data = buf.subarray(buf.readUInt32LE(at + 12), buf.readUInt32LE(at + 12) + buf.readUInt32LE(at + 8))
    return { size: buf[at] || 256, png: data.subarray(1, 4).toString('latin1') === 'PNG', data }
  })
}

/** Alpha of pixel (x, y) in a 32-bit BMP icon entry (rows stored bottom-up, BGRA). */
function dibAlpha(entry: IcoEntry, x: number, y: number): number {
  const s = entry.size
  return entry.data[40 + ((s - 1 - y) * s + x) * 4 + 3] as number
}

const pngSize = (buf: Buffer): number[] => [buf.readUInt32BE(16), buf.readUInt32BE(20)]

describe('Activra icon assets', () => {
  it('come from the approved vector source, unchanged', () => {
    // Draft v1 approved by the owner in Phase 6.4 (Life-Unlocked-brand/activra-icon-draft-v1/activra-icon.svg).
    expect(createHash('sha256').update(file('src/renderer/src/assets/activra-icon.svg')).digest('hex')).toBe(
      '5b131f723b90bfc7002716d17ffc9966fe19fe752178b1441682269e56914f44'
    )
  })

  it('build/icon.ico has every Windows size, BMP up to 64 px and PNG above, with transparent corners', () => {
    for (const ico of ['build/icon.ico', 'src/main/assets/app/icon.ico']) {
      const entries = readIco(file(ico))
      expect(entries.map((e) => e.size)).toEqual([16, 20, 24, 32, 40, 48, 64, 128, 256])
      for (const e of entries) {
        expect(e.png, `${ico} ${e.size}`).toBe(e.size > 64)
        if (e.png) expect(pngSize(e.data)).toEqual([e.size, e.size])
        else {
          expect(dibAlpha(e, 0, 0)).toBe(0)
          expect(dibAlpha(e, e.size - 1, e.size - 1)).toBe(0)
          expect(dibAlpha(e, e.size >> 1, e.size >> 1)).toBe(255)
        }
      }
    }
  })

  it('tray images match the scale Electron picks them for', () => {
    const tray = { 'tray.png': 16, 'tray@1.25x.png': 20, 'tray@1.5x.png': 24, 'tray@2x.png': 32, 'tray@3x.png': 48 }
    for (const [name, size] of Object.entries(tray)) expect(pngSize(file(`src/main/assets/tray/${name}`)), name).toEqual([size, size])
    expect(readIco(file('src/main/assets/tray/tray.ico')).map((e) => e.size)).toEqual([16, 20, 24, 32, 40, 48, 64])
    expect(pngSize(file('src/main/assets/app/icon.png'))).toEqual([256, 256])
    expect(pngSize(file('build/icon.png'))).toEqual([1024, 1024])
  })

  it('the exe, installer, uninstaller, window and sidebar use the Activra icon', () => {
    const builder = file('electron-builder.yml').toString()
    expect(builder).toMatch(/^\s+icon: build\/icon\.ico$/m)
    expect(builder).toMatch(/^\s+installerIcon: build\/icon\.ico$/m)
    expect(builder).toMatch(/^\s+uninstallerIcon: build\/icon\.ico$/m)
    const main = file('src/main/windows/mainWindow.ts').toString()
    expect(main).toContain("'../assets/app/icon.ico?asset'")
    expect(main).toContain("'../assets/app/icon.png?asset'")
    expect(file('src/renderer/src/components/Sidebar.tsx').toString()).toContain("'../assets/activra-icon.svg'")
  })
})
