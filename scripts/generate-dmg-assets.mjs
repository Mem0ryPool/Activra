/* global process, console, document, Buffer, Image, btoa */
// Renders the macOS DMG assets from the approved Activra icon (src/renderer/src/assets/activra-icon.svg,
// unchanged): the window background (build/dmg-background.png 540×380 and @2x 1080×760) and the volume
// icon build/icon.icns. Windows and app icons stay with scripts/generate-app-icons.mjs.
// electron-builder joins the two into a Retina TIFF (tiffutil) when it builds the DMG on a Mac.
// The icon positions here must match dmg.contents in electron-builder.yml (centers, iconSize 96).
// Run: node scripts/generate-dmg-assets.mjs  (needs Playwright's Chromium; set CHROMIUM_PATH if needed)
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const icon = readFileSync(path.join(root, 'src/renderer/src/assets/activra-icon.svg'), 'utf8')
export const WIDTH = 540
export const HEIGHT = 380
/** Icon centers in dmg.contents: the app on the left, the Applications link on the right. */
const APP = { x: 140, y: 200 }
const APPLICATIONS = { x: 400, y: 200 }

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    position: relative;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
    background:
      radial-gradient(420px 260px at 50% 108%, rgba(23, 132, 252, 0.10), rgba(23, 132, 252, 0) 70%),
      linear-gradient(#FFFFFF, #F2F6FC);
  }
  .brand { position: absolute; top: 28px; left: 0; right: 0; display: flex; justify-content: center; align-items: center; gap: 10px; }
  .brand svg { width: 30px; height: 30px; }
  .brand span { font-size: 21px; font-weight: 600; letter-spacing: 0.2px; color: #0B1B3A; }
  .hint { position: absolute; top: 76px; left: 0; right: 0; text-align: center; }
  .hint .zh { font-size: 14px; color: #33435F; }
  .hint .en { margin-top: 3px; font-size: 11.5px; color: #7A879C; letter-spacing: 0.2px; }
  .arrow { position: absolute; left: 0; top: 0; }
</style></head><body>
  <div class="brand">${icon.replace(/<metadata>[\s\S]*?<\/metadata>/, '')}<span>Activra</span></div>
  <div class="hint">
    <div class="zh">将 Activra 拖到「应用程序」文件夹即可完成安装</div>
    <div class="en">Drag Activra to Applications to install</div>
  </div>
  <svg class="arrow" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="arrow" gradientUnits="userSpaceOnUse" x1="${APP.x + 68}" y1="0" x2="${APPLICATIONS.x - 68}" y2="0">
        <stop offset="0" stop-color="#1784FC" stop-opacity="0.35"/>
        <stop offset="1" stop-color="#0D55F4"/>
      </linearGradient>
    </defs>
    <path d="M ${APP.x + 68} ${APP.y} H ${APPLICATIONS.x - 74}" stroke="url(#arrow)" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 11" fill="none"/>
    <path d="M ${APPLICATIONS.x - 82} ${APP.y - 10} L ${APPLICATIONS.x - 70} ${APP.y} L ${APPLICATIONS.x - 82} ${APP.y + 10}"
      stroke="#0D55F4" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>
</body></html>`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
for (const [scale, name] of [
  [1, 'dmg-background.png'],
  [2, 'dmg-background@2x.png']
]) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: scale })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(root, 'build', name), clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
  console.log('wrote', `build/${name}`)
  await page.close()
}

/** .icns with PNG entries (supported since macOS 10.7). Type → pixel size. */
export const ICNS_TYPES = {
  icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512
}
const page = await browser.newPage()
const pngs = new Map()
for (const size of new Set(Object.values(ICNS_TYPES))) {
  const png = await page.evaluate(
    async ({ svgText, size }) => {
      const img = new Image(size, size)
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)))
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(img, 0, 0, size, size)
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { svgText: icon, size }
  )
  pngs.set(size, Buffer.from(png, 'base64'))
}
const chunks = Object.entries(ICNS_TYPES).map(([type, size]) => {
  const head = Buffer.alloc(8)
  head.write(type, 0, 'latin1')
  head.writeUInt32BE(8 + pngs.get(size).length, 4)
  return Buffer.concat([head, pngs.get(size)])
})
const head = Buffer.alloc(8)
head.write('icns', 0, 'latin1')
head.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4)
writeFileSync(path.join(root, 'build/icon.icns'), Buffer.concat([head, ...chunks]))
console.log('wrote build/icon.icns')
await browser.close()
