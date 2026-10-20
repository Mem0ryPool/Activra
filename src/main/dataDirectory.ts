import path from 'node:path'

/**
 * Folder name of the data folder inside the OS app-data folder (`%APPDATA%` on Windows).
 *
 * Electron would derive it from `productName`, which became "Activra" in Phase 6.4. Every version up to
 * 6.3 (installed or run with `npm start`) kept its tasks, backups and settings in "Life Unlocked", so the
 * name is fixed here: renaming the app never moves or copies the user's data, and an older version can
 * still be started on the same folder.
 */
export const DATA_FOLDER_NAME = 'Life Unlocked'

/**
 * Data folder of an unpackaged run (`npm run dev`, `npm start`, `electron .`): next to the real one,
 * never the same. A development build must not read, migrate or back up the user's real data.
 */
export const DEV_DATA_FOLDER_NAME = 'Life Unlocked Dev'

export interface DataDirMode {
  /** `app.isPackaged`: only the installed app uses the real data folder by default. */
  packaged: boolean
  /** Explicit opt-in (LIFE_UNLOCKED_USE_PRODUCTION_DATA=1) for an unpackaged run on the real folder. */
  useProduction?: boolean
}

/**
 * The folder to use as `userData`:
 * - a test or acceptance override (LIFE_UNLOCKED_USER_DATA) when given;
 * - the installed app: the fixed data folder ("Life Unlocked");
 * - an unpackaged development run: its own folder ("Life Unlocked Dev"), also when an override points
 *   at the real folder, unless the run explicitly opted in to the real data.
 */
export function resolveUserDataDir(
  appDataDir: string,
  override: string | undefined,
  pathApi: path.PlatformPath = path,
  mode: DataDirMode = { packaged: true }
): string {
  const production = pathApi.join(appDataDir, DATA_FOLDER_NAME)
  const development = pathApi.join(appDataDir, DEV_DATA_FOLDER_NAME)
  const guarded = !mode.packaged && !mode.useProduction
  if (override) {
    if (guarded && samePath(override, production, pathApi)) return development
    return override
  }
  return guarded ? development : production
}

function samePath(a: string, b: string, pathApi: path.PlatformPath): boolean {
  const norm = (p: string): string => pathApi.resolve(p).replace(/[\\/]+$/, '')
  // Windows paths are case-insensitive.
  return pathApi.sep === '\\' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}
