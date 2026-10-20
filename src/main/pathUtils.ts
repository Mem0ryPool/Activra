import path from 'node:path'

/** True if `target` is `dir` or inside it. Case-insensitive on Windows, where "C:" and "c:" are the same drive. */
export function isInsideDirectory(target: string, dir: string, platform: NodeJS.Platform = process.platform): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix
  const fold = (value: string): string => (platform === 'win32' ? value.toLowerCase() : value)
  const relative = p.relative(fold(p.resolve(dir)), fold(p.resolve(target)))
  return relative === '' || (!relative.startsWith('..') && !p.isAbsolute(relative))
}
