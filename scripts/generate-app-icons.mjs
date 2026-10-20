/* global process, console, Buffer, Image, btoa, document */
// Renders every app, window, tray and installer icon from the one approved vector source,
// src/renderer/src/assets/activra-icon.svg (Activra icon, draft v1 approved in Phase 6.4). The design is
// never changed here: each size is the same SVG rasterized by Chromium at that size.
// Run: node scripts/generate-app-icons.mjs  (needs Playwright's Chromium; set CHROMIUM_PATH if needed)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const source = path.join(root, 'src/renderer/src/assets/activra-icon.svg')

/** Sizes in build/icon.ico (installer, uninstaller, exe, shortcuts, taskbar). Windows picks the closest. */
export const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
/** Electron picks tray.png / tray@1.5x.png / … by display scale; the Windows tray is 16 px at 100 %. */
const TRAY_PNGS = { 'tray.png': 16, 'tray@1.25x.png': 20, 'tray@1.5x.png': 24, 'tray@2x.png': 32, 'tray@3x.png': 48 }
const TRAY_ICO_SIZES = [16, 20, 24, 32, 40, 48, 64]

const svg = readFileSync(source, 'utf8')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage()
await page.setContent('<html><body style="margin:0;background:transparent"></body></html>')

/** RGBA pixels and PNG bytes of the source drawn at size × size (straight, not premultiplied, alpha). */
async function render(size) {
  const { rgba, png } = await page.evaluate(
    async ({ svgText, size }) => {
      const img = new Image(size, size)
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)))
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, size, size)
      const data = ctx.getImageData(0, 0, size, size).data
      return { rgba: Array.from(data), png: canvas.toDataURL('image/png').split(',')[1] }
    },
    { svgText: svg, size }
  )
  return { size, rgba: Uint8Array.from(rgba), png: Buffer.from(png, 'base64') }
}

/** 32-bit BMP (DIB) entry: bottom-up BGRA plus an all-zero AND mask, as Windows expects for small sizes. */
function dib({ size, rgba }) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // XOR + AND masks
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4
      const to = ((size - 1 - y) * size + x) * 4
      pixels[to] = rgba[from + 2]
      pixels[to + 1] = rgba[from + 1]
      pixels[to + 2] = rgba[from]
      pixels[to + 3] = rgba[from + 3]
    }
  }
  const maskRow = Math.ceil(size / 32) * 4
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)])
}

/** .ico with BMP entries up to 64 px and PNG entries above (the usual layout for Windows icons). */
function ico(images) {
  const entries = images.map((im) => (im.size <= 64 ? dib(im) : im.png))
  const dir = Buffer.alloc(6 + 16 * images.length)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(images.length, 4)
  let offset = dir.length
  images.forEach((im, i) => {
    const at = 6 + 16 * i
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, at)
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, at + 1)
    dir.writeUInt16LE(1, at + 4)
    dir.writeUInt16LE(32, at + 6)
    dir.writeUInt32LE(entries[i].length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += entries[i].length
  })
  return Buffer.concat([dir, ...entries])
}

const cache = new Map()
const get = async (size) => {
  if (!cache.has(size)) cache.set(size, await render(size))
  return cache.get(size)
}
const write = (file, data) => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, data)
  console.log('wrote', path.relative(root, file))
}

write(path.join(root, 'build/icon.ico'), ico(await Promise.all(ICO_SIZES.map(get))))
write(path.join(root, 'build/icon.png'), (await get(1024)).png)
write(path.join(root, 'src/main/assets/app/icon.ico'), ico(await Promise.all(ICO_SIZES.map(get))))
write(path.join(root, 'src/main/assets/app/icon.png'), (await get(256)).png)
const tray = path.join(root, 'src/main/assets/tray')
for (const [name, size] of Object.entries(TRAY_PNGS)) write(path.join(tray, name), (await get(size)).png)
write(path.join(tray, 'tray.ico'), ico(await Promise.all(TRAY_ICO_SIZES.map(get))))
await browser.close()
