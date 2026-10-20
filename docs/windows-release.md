# Windows build and data notes

The Windows target is Windows 10 or 11 on x64. Installers are produced with electron-builder and NSIS.

## Build

From a clean checkout with Node.js 22 LTS:

```powershell
npm ci
npm run dist:win
Get-FileHash .\release\1.0.0-rc.3\Activra-Setup-1.0.0-rc.3-x64.exe -Algorithm SHA256
```

`dist:win` runs the type checks and production build before packaging. The result is written below `release\<version>\` and is never uploaded automatically (`publish: null`).

The current configuration creates an unsigned installer. Windows SmartScreen may warn about unsigned artifacts; do not claim that a locally built installer is signed or trusted.

## Compatibility identifiers

- `appId` remains `app.lifeunlocked.desktop` so upgrades can find existing installations.
- The visible product and executable name is Activra.
- User data remains in `%APPDATA%\Life Unlocked\`; installing, upgrading, and uninstalling do not delete it.

Before testing an upgrade, quit the app and copy the complete user-data directory to a safe location. Development and automated tests must instead set `LIFE_UNLOCKED_USER_DATA` to an isolated temporary directory. Never test against production user data.

See [data-migration.md](data-migration.md) for schema, backup, corruption recovery, and rollback behavior.

## Known release limitations

- No code-signing certificate is configured.
- No automatic update or automatic publishing path is configured.
- A locally built installer still requires manual installation and upgrade validation before release.
