# Phase 5A: authentication and cloud sync foundation

Status: architecture decision and provider-independent input boundary only. No cloud project, network call,
credential, user-data upload, data-schema change, or release artifact is included in this phase.

## Current constraints

- The Electron main process owns persistence. Renderers are sandboxed and receive only narrow typed IPC methods.
- `DataStore` atomically writes schema 5 to `life-unlocked-data.json`; focus data remains in
  `life-unlocked-focus.json`. Both use backups and recovery.
- Installed Windows and macOS builds must keep the fixed `Life Unlocked` `userData` directory. Sync metadata,
  when implemented, will be an additional file in that directory; existing file names and schemas do not move.
- Guest mode is the default and remains fully functional without a network or account.

## Recommended architecture

```text
React login/sync UI
  -> narrow auth/sync IPC
  -> Electron main: AuthService + SyncService
       -> encrypted local session (OS safe storage)
       -> existing DataStore / FocusStore (local source of truth)
       -> HTTPS sync API
            -> auth provider
            -> account-scoped database with row-level authorization
            -> email and mainland-China SMS delivery adapters
```

The renderer must never receive refresh tokens, provider secret keys, service-role keys, local paths, or direct
database credentials. Provider SDK/network/session refresh lives in the main process. The server, not the desktop
app, performs privileged account linking, rate limiting, consent checks, deletion, and authorization.

### Login and account lifecycle

1. One field accepts an email or phone. `parseLoginIdentifier` performs provider-independent pre-validation,
   preserves the email local part, lowercases its domain, and normalizes supported mainland mobile numbers to
   E.164 `+86...`. The server repeats validation and the auth provider is authoritative.
2. `request OTP` always returns a generic response. A valid, verified OTP signs in an existing account or creates
   one automatically; the UI must not disclose whether the identity existed.
3. Signing in creates no cloud copy of local app data. It only establishes an authenticated account session.
4. Linking a second email/phone requires an active session plus OTP verification of the new identity. Never link
   accounts from an unverified string match. If the identity belongs to another account, stop and use an explicit,
   separately reviewed account-merge flow rather than silently combining data.
5. Account deletion requires fresh OTP verification. The server revokes refresh sessions, deletes account-scoped
   rows/assets and the auth user, and returns a deletion receipt. Already issued short-lived access tokens must be
   rejected for sensitive operations by checking the server session. Local guest data is kept by default; deleting
   it is a separate, explicit destructive choice.

### Explicit upload consent

After first sign-in on a device, show a local-only summary (counts and categories, never task titles) and the remote
account state. Offer `Enable sync` and `Not now`. Before `Enable sync`, name the data categories, purpose, storage
region/provider, retention, cross-border transfer if any, deletion/export controls, and current privacy-policy
version. Record consent version, timestamp, account and device on the server and in sync metadata. Authentication
alone is not consent. Withdrawing consent stops new uploads; deletion/export are separate actions.

If both sides contain data, first download metadata and show an `Upload and merge` confirmation. Never replace a
non-empty local profile with remote state or upload it as a side effect of login.

### Sync protocol

- Local files remain the immediate source of truth so all features work offline. Each local mutation is represented
  by a stable operation id, device id and per-device sequence in an outbox. Retries are idempotent.
- The server assigns an account revision and returns acknowledgements plus changes after the client's cursor. Client
  wall-clock timestamps are display/audit data, not conflict order.
- Mutable entities (task, plan, habit, account-scoped preferences) use `base revision` three-way merge. Non-overlap
  fields merge; concurrent edits to the same field retain both versions and require a user choice. Never silently
  use last-device-clock-wins.
- Completion, habit check-in, plan-unlock and finished-focus records are append-only by stable id. Undo/revoke is a
  later state, not deletion. The server enforces domain uniqueness (for example one counted completion per task and
  occurrence) so two offline devices cannot award twice.
- Deletes are tombstones until every known device has advanced past them and the documented recovery window ends.
  A stale device cannot resurrect a deleted record.
- Device-local state never syncs: window/widget position and visibility, global shortcut, reminder delivery state,
  tray hints, logs, running focus timer, and cached tokens. Imported theme assets remain local until content-addressed
  asset sync has its own consent and quota design. Cross-platform shortcut values must not overwrite each other.

### Safe apply and recovery

On reconnect: refresh session, upload the ordered outbox, fetch changes after the cursor, validate every remote
record with the same domain validators, derive plan state, then stage the result. Before changing local data, make a
dated recovery copy using the existing backup rules; atomically replace only after the whole snapshot validates.
Persist the new cursor only after the local write succeeds. On any failure, keep the current files and outbox,
quarantine the rejected payload, redact its contents from logs, and retry with backoff. Expose `sync paused`,
`last synced`, conflict count, retry and restore-from-backup controls.

## Provider decision

Recommended proof of concept: Supabase Auth + Postgres/RLS for accounts and sync rows, custom SMTP for international
email OTP, and Supabase's Send SMS Hook calling Tencent Cloud SMS for `+86`. This keeps one user/session model while
allowing a mainland delivery provider. Supabase supports email/phone passwordless auth, custom email/SMS hooks, rate
limits and multiple identities. Tencent Cloud still requires suitable entity verification, a domestic-SMS
qualification, and approved signature/template; approval and delivery must be proven before phone login ships.

Do not treat the recommendation as approval for production. Before selecting a region or processor, complete legal,
security, DPA, data-residency, mainland reachability and deliverability reviews. If hosted Supabase cannot satisfy
those reviews, keep this client contract and replace the server with a small owned auth/sync API using Tencent Cloud
SMS plus a reviewed transactional email service. Firebase is not the default because its official high-delivery
phone list does not currently establish mainland-China delivery; Auth0/Twilio likewise needs a separate +86
deliverability and compliance proof and adds no clear benefit to this architecture.

Official references:

- Supabase Auth and providers: <https://supabase.com/docs/guides/auth>
- Supabase custom SMS hook: <https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook>
- Supabase custom SMTP: <https://supabase.com/docs/guides/auth/auth-smtp>
- Supabase identities/linking: <https://supabase.com/docs/guides/auth/identities>
- Supabase auth rate limits: <https://supabase.com/docs/guides/auth/rate-limits>
- Electron safe storage: <https://www.electronjs.org/docs/latest/api/safe-storage>
- Tencent Cloud domestic SMS signatures: <https://cloud.tencent.com/document/product/382/37794>

## Security and privacy gates

- Store the refresh token only from the main process via Electron async `safeStorage`; keep access tokens in memory
  when practical. Fail closed when secure storage is unavailable. Never put tokens or OTPs in DataStore, renderer
  storage, URLs, crash reports, analytics or logs. Stable macOS Keychain behavior requires a consistent signed app.
- Allowlist one HTTPS API origin and enforce normal TLS validation. Keep Electron isolation, sandbox, navigation
  blocking and trusted-sender checks. All remote payloads are untrusted and size-limited.
- Enforce rate limits by IP, privacy-preserving identifier hash, account and device: resend cooldown, hourly/daily
  send caps, verify-attempt cap, exponential backoff and cost alarms. Add CAPTCHA/Turnstile only after risk signals;
  never rely on a disabled UI button as abuse protection.
- Collect the minimum identity and sync data; encrypt in transit and at rest; separate identifiers from content;
  publish purpose, processors, region, retention, export, correction, consent withdrawal and deletion behavior.
  Obtain specialist review for GDPR/CCPA/PIPL and any cross-border transfer before production use.

## Phased implementation

1. **5A (this change):** freeze boundaries and normalize the single login identifier; no runtime behavior change.
2. **5B (after provider/region approval):** server schema/RLS, mocked delivery adapters, generic OTP endpoints, abuse
   limits and contract tests. No real messages until approved test credentials and templates exist.
3. **5C:** main-process AuthService, safe token storage, narrow IPC, login/link/delete UI and offline regression tests.
   Sync remains off and no local content uploads.
4. **5D:** explicit-consent onboarding, operation log/outbox, one data category at a time, deterministic conflicts,
   recovery/fault-injection tests and Windows/macOS two-device acceptance.
5. **5E:** privacy/export/deletion operations, observability without content/identifiers, staged pilot and rollback.

Before 5B: approve the provider and data region, legal/privacy text, DPA/subprocessors, retention/recovery window,
server hosting, domain/DNS, transactional-email sender, Tencent Cloud entity/qualification/signature/template, test
phone/email recipients, budget/cost alerts, and a non-production credential set.
