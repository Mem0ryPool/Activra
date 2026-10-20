# macOS compatibility (preparation)

Status: an earlier ARM64 development build was reported running on a real Mac, but no DMG from the
1.0.0-rc.4 preparation source has been built or verified on macOS. No final RC4 freeze commit exists yet. A real-Mac
build and manual acceptance pass are still required before a macOS release.

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
- Build config: `mac` in `electron-builder.yml` makes unsigned DMGs for arm64 and x64 from `build/icon.png`
  (`identity: null`, `publish: null`). Windows settings are unchanged.
- DMG window: `dmg` in `electron-builder.yml` uses `build/dmg-background.png` (+ `@2x`, 540×380) with the
  app at (140, 200) and an Applications link at (400, 200), icon size 96, and the volume icon
  `build/icon.icns`; all three come from the approved SVG via `scripts/generate-dmg-assets.mjs`.

## Still to do (needs a Mac or an Apple account)

1. Build on macOS (`npm run dist:mac:arm64` for Apple silicon) and run the E2E suite there;
   `shortcut.spec.ts` skips its Windows-label test on macOS.
2. Menu bar (tray) icon: macOS expects a monochrome template image; the current colored tray PNGs show as
   color. Add a template variant in `scripts/generate-app-icons.mjs` and use `setTemplateImage(true)`.
3. Signing and notarization (Developer ID, hardened runtime, entitlements). Unsigned builds need
   right-click → Open on first launch.
4. Check the notification window across Spaces / full-screen apps, and the close-to-menu-bar behavior.
5. Manual check of the Select popovers, dialogs and focus mode with the traffic lights at 100 % and Retina.
