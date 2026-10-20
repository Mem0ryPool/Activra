# Phase 5C: optional sign-in UI and IPC

Settings → Account (账户) offers optional email OTP sign-in. Guest/offline use is unchanged: nothing runs at
startup, the session file is read only when the Settings page asks, and a failure only hides the form.

## Modes

- `unavailable` (installed builds): hosted Supabase is not approved, so no provider exists. The section says
  sign-in is not available yet; every auth call answers `unavailable`.
- `development-mock` (unpackaged runs only, `!app.isPackaged`): `DevelopmentOtpProvider` makes a 6-digit code
  locally (single use, 10 minutes), hands it to the in-memory `MockEmailOtpDelivery` (refuses
  `NODE_ENV=production`) and the page shows it under a "Development mock / 开发模拟" label. No email is sent and
  no network call is made. The fake session lasts 24 hours.

## Boundaries

- IPC: five main-window-only channels (`auth:status`, `auth:request-code`, `auth:verify-code`, `auth:cancel`,
  `auth:sign-out`), registered through `handle()` plus a main-window sender check (`src/main/ipc/authHandlers.ts`).
  The widget and notification preloads expose nothing. Answers are `AuthStatus` (state + email), never a token.
- `AuthService` (`src/main/auth/authService.ts`) validates input itself (`parseEmailLogin`, `normalizeOtpToken`,
  320-character cap), applies `OtpRateLimiter` (60 s resend cooldown, 5 sends/hour, verify lockout with backoff),
  maps provider errors with `mapOtpError` and checks `sessionAction`; a session that would need a refresh ends
  until the real adapter (Phase 5D) can refresh it.
- `AuthSessionStore` writes `auth-session.json` in the data folder only as `safeStorage` ciphertext. Without OS
  encryption the session lives in memory for that run. An unreadable file is removed (a lost sign-in, never data).
- Signing in or out never reads, uploads, merges or changes tasks, settings, focus data or backups.
- +86 phone numbers parse in the shared contract but are answered "phone sign-in is not available yet".

## Before real sign-in (Phase 5D)

Approved Supabase project/region, publishable key distribution, custom SMTP with a `{{ .Token }}` template, Auth
rate limits, the privacy text and test recipients; then a main-process Supabase adapter implementing
`OtpAuthProvider` plus refresh, chosen instead of the mock for packaged builds. Sync stays off.
