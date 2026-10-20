import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../..')
const require = createRequire(import.meta.url)
const { requiredEntries, findMissingEntries } = require(
  path.join(root, 'scripts/verify-packaged-app.cjs')
) as { requiredEntries: string[]; findMissingEntries: (listing: string[]) => string[] }

const completeListing = [
  ...requiredEntries.map((entry) => `\\${entry.replace(/\//g, '\\')}`),
  '\\out\\renderer\\assets\\index-D1Kp7YVo.js'
]

describe('packaged app check (afterPack)', () => {
  it('accepts a complete app.asar listing (Windows and POSIX separators)', () => {
    expect(findMissingEntries(completeListing)).toEqual([])
    expect(findMissingEntries(completeListing.map((e) => e.replace(/\\/g, '/')))).toEqual([])
  })

  it('rejects an out/ left by electron-vite dev (no renderer)', () => {
    const devOnly = completeListing.filter((entry) => !entry.includes('renderer'))
    expect(findMissingEntries(devOnly)).toEqual([
      'out/renderer/index.html',
      'out/renderer/notification.html',
      'out/renderer/widget.html',
      'out/renderer/assets/index-*.js'
    ])
  })

  it('names every page and preload electron-vite builds', () => {
    const config = readFileSync(path.join(root, 'electron.vite.config.ts'), 'utf8')
    for (const page of ['index', 'notification', 'widget']) {
      expect(config).toContain(`src/renderer/${page}.html`)
      expect(config).toContain(`src/preload/${page}.ts`)
      expect(requiredEntries).toContain(`out/renderer/${page}.html`)
      expect(requiredEntries).toContain(`out/preload/${page}.js`)
    }
  })

  it('is wired into electron-builder', () => {
    const builder = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
    expect(builder).toMatch(/^afterPack: scripts\/verify-packaged-app\.cjs$/m)
    expect(builder).toMatch(
      /^files:\n {2}- out\/\*\*\/\*\n {2}- package\.json\n {2}- THIRD_PARTY_NOTICES\.md\n {2}- third_party_notices\/\*\*\/\*$/m
    )
    expect(requiredEntries).toContain('THIRD_PARTY_NOTICES.md')
    expect(requiredEntries).toContain('third_party_notices/lucide-react-ISC.txt')
  })
})
