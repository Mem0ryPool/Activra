import { describe, expect, it } from 'vitest'
import { isInsideDirectory } from '../../src/main/pathUtils'
import { cornerIn, parseSavedWindowState, resolveWindowBounds } from '../../src/main/windows/windowBounds'

const limits = { defaultWidth: 1100, defaultHeight: 680, minWidth: 900, minHeight: 560 }
const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const secondary = { x: 1920, y: 0, width: 2560, height: 1400 }

describe('resolveWindowBounds', () => {
  it('centers on the primary display by default', () => {
    expect(resolveWindowBounds(null, [primary], primary, limits)).toEqual({ x: 410, y: 180, width: 1100, height: 680 })
  })

  it('restores a saved position on a second monitor', () => {
    const saved = { x: 2200, y: 100, width: 1200, height: 800, isMaximized: false }
    expect(resolveWindowBounds(saved, [primary, secondary], primary, limits)).toEqual({ x: 2200, y: 100, width: 1200, height: 800 })
  })

  it('recenters when the saved monitor is gone', () => {
    const saved = { x: 2200, y: 100, width: 1200, height: 800, isMaximized: false }
    expect(resolveWindowBounds(saved, [primary], primary, limits)).toEqual({ x: 410, y: 180, width: 1100, height: 680 })
  })

  it('enforces the minimum size', () => {
    const saved = { x: 10, y: 10, width: 300, height: 200, isMaximized: false }
    expect(resolveWindowBounds(saved, [primary], primary, limits)).toMatchObject({ width: 900, height: 560 })
  })

  it('fits a small screen', () => {
    const small = { x: 0, y: 0, width: 1024, height: 600 }
    expect(resolveWindowBounds(null, [small], small, limits)).toEqual({ x: 0, y: 0, width: 1024, height: 600 })
  })
})

describe('helpers', () => {
  it('parses saved state defensively', () => {
    expect(parseSavedWindowState({ x: 1, y: 2, width: 3, height: 4 })).toMatchObject({ isMaximized: false })
    expect(parseSavedWindowState({ x: 'a' })).toBeNull()
    expect(parseSavedWindowState(null)).toBeNull()
  })
  it('places toasts inside the work area of the chosen corner (second monitor)', () => {
    const area = { x: 1920, y: 0, width: 2560, height: 1400 }
    expect(cornerIn(area, 460, 180, 0, 'bottom-right')).toEqual({ x: 4020, y: 1220, width: 460, height: 180 })
    expect(cornerIn(area, 460, 180, 0, 'top-left')).toEqual({ x: 1920, y: 0, width: 460, height: 180 })
    expect(cornerIn({ x: -1280, y: 200, width: 1280, height: 984 }, 460, 180, 0, 'bottom-left')).toEqual({
      x: -1280,
      y: 1004,
      width: 460,
      height: 180
    })
  })
})

describe('isInsideDirectory', () => {
  it('handles Windows drive-letter case and parent escapes', () => {
    const dir = 'C:\\Program Files\\Life Unlocked\\resources\\app.asar\\out\\renderer'
    expect(isInsideDirectory('c:\\program files\\life unlocked\\resources\\app.asar\\out\\renderer\\index.html', dir, 'win32')).toBe(true)
    expect(isInsideDirectory('C:\\Program Files\\Life Unlocked\\resources\\app.asar\\out\\main\\index.js', dir, 'win32')).toBe(false)
    expect(isInsideDirectory('D:\\out\\renderer\\index.html', dir, 'win32')).toBe(false)
  })
  it('is case-sensitive on POSIX', () => {
    expect(isInsideDirectory('/app/out/renderer/notification.html', '/app/out/renderer', 'linux')).toBe(true)
    expect(isInsideDirectory('/app/out/renderer/../main/x.js', '/app/out/renderer', 'linux')).toBe(false)
    expect(isInsideDirectory('/app/out/rendererX/a.html', '/app/out/renderer', 'linux')).toBe(false)
  })
})
