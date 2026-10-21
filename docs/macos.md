# macOS compatibility (preparation)

Status: `v1.0.0-rc.4` is the frozen public RC4 source tag, and the published RC4 release currently contains
only the unsigned Windows x64 preview. `.github/workflows/macos-arm64-rc4.yml` builds an unsigned ARM64 DMG
from the same RC4 application source on GitHub's `macos-14` Apple Silicon runner. It uploads only a workflow
artifact for review; it does not change the tag or publish a GitHub Release asset.

The workflow checks the runner and executable architecture, bundle identity, executable permissions, DMG
layout, SHA-256 and byte size. It then copies the app from the mounted DMG, launches the packaged app twice
with an isolated temporary profile, and checks that a saved setting survives the restart. This is useful CI
evidence, but it does not reproduce a downloaded file's quarantine state or replace physical-Mac acceptance.

## Already in place

- Data folder: `~/Library/Application Support/Life Unlocked` (installed app) and `…/Life Unlocked Dev` for
  unpackaged runs, by the same rule as Windows (`src/main/dataDirectory.ts`).
- Window: hidden title bar with native traffic lights (`trafficLightPosition`); the sidebar and full-window
  focus mode leave room for them (`sidebar-top-pad`, `titlebar-left-pad` under `data-platform='darwin'`).
- Dock: clicking the Dock icon reopens the main window (`app.on('activate')`), also after it was hidden.
- Keyboard: the Windows default `CommandOrControl+Alt+D` would be ⌘⌥D on a Mac, which is the system's
  "show/hide Dock" shortcut, so a new Mac profile starts with `Control+Alt+D` (⌃⌥D, `defaultWidgetShortcut`
  in `src/shared/shortcut.ts`); a recorded shortcut is never replaced. The recorder maps Cmd to the
  portable modifier and Control to `Control`. Hints name ⌘/⌥/⌃, not Ctrl/Win.
- Menu bar (`src/main/appMenu.ts`, macOS only): Activra (About, Settings… ⌘,, Hide, Quit ⌘Q), Edit roles (so
  ⌘C/⌘V/⌘A/⌘Z work in text fields), View (reload/devtools only in development), Window (⌘M, ⌘W). Windows
  keeps Electron's default menu, unchanged.
- Menu bar icon: a click opens its menu (no window jump); "Open Activra" is its first entry. Menu labels
  keep "&" as typed (Windows doubles it, macOS must not). Texts say "menu bar" / "macOS notifications"
  instead of tray / Windows (`*Mac` i18n keys).
- Dock: a development run sets the Activra icon on the Dock (the installed app takes it from the bundle).
- Fonts fall back to `-apple-system` / PingFang SC; the achievement notification window has a macOS branch.
- Build config: `mac` in `electron-builder.yml` declares arm64 and x64 DMG targets from `build/icon.png`
  (`identity: null`, `publish: null`). The RC4 preview workflow passes `--arm64`, verifies that only one ARM64
  DMG was produced, and never uploads an Intel build. Windows settings are unchanged.
- DMG window: `dmg` in `electron-builder.yml` uses `build/dmg-background.png` (+ `@2x`, 540×380) with the
  app at (140, 200) and an Applications link at (400, 200), icon size 96, and the volume icon
  `build/icon.icns`; all three come from the approved SVG via `scripts/generate-dmg-assets.mjs`.

## Still to do before a public macOS release

1. Review a successful `macOS ARM64 RC4 preview` workflow run and retain its artifact hash and run URL. A
   cloud runner is automated build evidence, not a claim that the app was accepted on a physical Mac.
2. Menu bar (tray) icon: macOS expects a monochrome template image; the current colored tray PNGs show as
   color. Add a template variant in `scripts/generate-app-icons.mjs` and use `setTemplateImage(true)`.
3. Signing and notarization (Developer ID, hardened runtime, entitlements). The preview has no Developer ID
   signature or notarization, so Gatekeeper may block normal first launch of a downloaded copy.
4. Check the notification window across Spaces / full-screen apps, and the close-to-menu-bar behavior.
5. Manual check of the Select popovers, dialogs and focus mode with the traffic lights at 100 % and Retina.
