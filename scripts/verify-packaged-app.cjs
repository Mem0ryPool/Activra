/* global require, module, console */
/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads hooks as CommonJS */
// electron-builder afterPack hook: refuses to finish a package whose app.asar lacks a page, a
// preload or the main entry. electron-builder packs whatever is in out/ at that moment; an out/
// left by `electron-vite dev` (main + preload only, the renderer comes from the dev server) or by a
// failed `npm run build` gives an app that starts with ERR_FILE_NOT_FOUND for
// out/renderer/index.html. Runs before the DMG/installer is made.
const path = require('node:path')

/** Must match the inputs in electron.vite.config.ts and the pages in src/main/paths.ts. */
const requiredEntries = [
  'package.json',
  'THIRD_PARTY_NOTICES.md',
  'third_party_notices/caniuse-lite-CC-BY-4.0.txt',
  'third_party_notices/lightningcss-MPL-2.0.txt',
  'third_party_notices/lucide-react-ISC.txt',
  'third_party_notices/react-react-dom-MIT.txt',
  'third_party_notices/zustand-MIT.txt',
  'out/main/index.js',
  'out/preload/index.js',
  'out/preload/notification.js',
  'out/preload/widget.js',
  'out/renderer/index.html',
  'out/renderer/notification.html',
  'out/renderer/widget.html'
]

/** asar listings look like "\out\main\index.js" on Windows and "/out/main/index.js" elsewhere. */
function normalizeEntry(entry) {
  return entry.replace(/\\/g, '/').replace(/^\/+/, '')
}

function findMissingEntries(listing) {
  const present = new Set(listing.map(normalizeEntry))
  const missing = requiredEntries.filter((entry) => !present.has(entry))
  // Every page needs its bundled script and style next to it.
  if (![...present].some((entry) => /^out\/renderer\/assets\/index-[^/]+\.js$/.test(entry))) {
    missing.push('out/renderer/assets/index-*.js')
  }
  return missing
}

function asarPath(context) {
  if (context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas') {
    const appName = `${context.packager.appInfo.productFilename}.app`
    return path.join(context.appOutDir, appName, 'Contents', 'Resources', 'app.asar')
  }
  return path.join(context.appOutDir, 'resources', 'app.asar')
}

async function afterPack(context) {
  const asar = require('@electron/asar')
  const file = asarPath(context)
  const missing = findMissingEntries(asar.listPackage(file, { isPack: false }))
  if (missing.length > 0) {
    throw new Error(
      `${file} is missing ${missing.join(', ')}. Run "npm run build" (it must succeed) right before packaging.`
    )
  }
  console.log(`  • verified app.asar  file=${file}`)
}

module.exports = afterPack
module.exports.default = afterPack
module.exports.requiredEntries = requiredEntries
module.exports.findMissingEntries = findMissingEntries
