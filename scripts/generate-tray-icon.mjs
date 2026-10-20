/* global process, console */
// Superseded in Phase 6.4: the tray now uses the Activra icon, made by scripts/generate-app-icons.mjs.
// Kept for reference only; it stops here so it can no longer overwrite the tray icons with the old trophy.
// (Formerly: renders the tray icon PNGs and .ico from an inline lucide "trophy" SVG, ISC license.)
console.error('scripts/generate-tray-icon.mjs is superseded: run node scripts/generate-app-icons.mjs')
process.exit(1)
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const out = path.resolve(import.meta.dirname, '../src/main/assets/tray')
mkdirSync(out, { recursive: true })

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
  <rect x="0.5" y="0.5" width="23" height="23" rx="5.5" fill="#f5b83d" stroke="#7a5310" stroke-width="1"/>
  <g transform="translate(3.6 3.4) scale(0.7)" fill="none" stroke="#111827" stroke-width="${size <= 20 ? 3.2 : 2.6}"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/>
    <path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/>
    <path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/>
    <path d="M4 22h16"/>
    <path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" fill="#111827"/>
    <path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/>
  </g>
</svg>`

// Electron picks tray.png / tray@1.5x.png / tray@2x.png by display scale; Windows tray is 16px at 100%.
const pngs = { 'tray.png': 16, 'tray@1.25x.png': 20, 'tray@1.5x.png': 24, 'tray@2x.png': 32, 'tray@3x.png': 48 }
const icoSizes = [16, 20, 24, 32, 48, 64, 256]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage()
const render = async (size, file) => {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`)
  writeFileSync(file, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }))
}
for (const [name, size] of Object.entries(pngs)) await render(size, path.join(out, name))
const icoParts = []
for (const size of icoSizes) {
  const file = path.join(out, `.ico-${size}.png`)
  await render(size, file)
  icoParts.push(file)
}
await browser.close()

execFileSync('python3', [
  '-c',
  `import sys
from PIL import Image
imgs=[Image.open(p).convert('RGBA') for p in sys.argv[2:]]
imgs[-1].save(sys.argv[1], format='ICO', sizes=[i.size for i in imgs], append_images=imgs[:-1])
import os
[os.remove(p) for p in sys.argv[2:]]`,
  path.join(out, 'tray.ico'),
  ...icoParts
])
console.log('Tray icons written to', out)
