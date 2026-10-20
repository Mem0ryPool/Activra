# Phase 5B: authentication backend and OTP infrastructure

This phase adds a deployable Supabase/Postgres contract and local-only TypeScript seams. It does not create a
Supabase project, send a message, add a runtime dependency, change the desktop IPC, or read/write user data.

## Database contract

Apply migrations in filename order:

1. `20261017000100_phase5b_auth_sync_schema.sql` creates account rows linked to `auth.users`, per-account revision
   state, registered devices, canonical entities, an append-only revision feed, idempotency receipts and deletion
   tombstones. Existing Auth users are backfilled; future verified users get an account row through a trigger.
2. `20261017000200_phase5b_auth_sync_rls.sql` enables RLS, revokes all `anon`/`authenticated` defaults, grants only
   owner-scoped reads, and exposes four narrow authenticated RPCs. Direct client writes remain revoked.

`apply_sync_operation` derives the account exclusively from `auth.uid()`, requires explicit sync consent and an
active registered device, serializes revisions, requires ordered device sequence numbers, rejects stale same-entity
writes, hashes requests for idempotent replay, and prevents resurrection of tombstoned IDs. It is one database
transaction. Tombstone purge is deliberately absent until retention and device-recovery policy are approved.

The migration does not mirror `life-unlocked-data.json` or alter schema 5. Entity payloads are opaque JSON objects
limited to 1 MiB; Phase 5D must add server-side per-entity validation before any desktop upload is enabled.

## RLS verification

`supabase/tests/database/phase5b_rls.test.sql` is the live pgTAP contract. It needs only pgTAP: test users are
inserted into `auth.users` and `pg_temp.authenticate_as` switches to the `authenticated` role with JWT claims. It checks RLS on every table, owner-only
reads, no direct authenticated inserts, consent, device registration, idempotent replay, ordered revisions,
tombstones, and cross-account isolation.

Run with Docker Desktop (WSL2 backend) and the CLI through npx; `supabase/config.toml` is the local-only stack
(only Postgres is needed for these tests). Passed 24/24 locally on 2026-10-17:

```powershell
npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta,mailpit,supavisor,postgrest,kong,auth
npx supabase db reset
npx supabase test db
npx supabase stop
```

The normal Vitest suite statically verifies migration coverage, grants, policies, hardened RPC declarations and the
presence of the cross-account pgTAP cases. Static checks do not replace a live Postgres run.

## OTP contract

`src/main/auth/otpProvider.ts` keeps tokens in a main-process-only interface and maps the generic entry to supported
Supabase Auth calls:

- Request: `signInWithOtp({ email, options: { shouldCreateUser: true } })` or the phone/SMS equivalent.
- Verify: `verifyOtp({ email, token, type: 'email' })` or `{ phone, token, type: 'sms' }`.
- Public request responses never reveal whether an account exists. Verification collapses wrong, expired and already
  used tokens to `invalid-or-expired`.

Supabase remains responsible for generating, storing and verifying OTPs. Activra does not implement an OTP database.
`MockEmailOtpDelivery` and `MockSmsOtpDelivery` only capture hook messages in memory for development/tests, reject
invalid channel/token combinations, make no network calls, and refuse construction when `NODE_ENV=production`.

## Security configuration before Phase 5C

- Use a publishable key plus the signed-in user's JWT for RLS access. Secret/service-role keys exist only in managed
  server functions and never in Electron, preload, renderer, logs or Git.
- Keep Supabase refresh-token rotation/reuse detection enabled. Configure short-lived access tokens, explicit
  inactivity/maximum session policy if the approved plan supports it, and fresh OTP verification for linking or
  deletion. The Electron main process will encrypt the refresh token with `safeStorage` in Phase 5C.
- Configure Auth rate limits and a resend cooldown; add gateway limits by IP and HMAC(identifier), verify-attempt
  caps, exponential backoff and cost alarms. CAPTCHA tokens pass through the generic request only after abuse risk.
- Map provider failures to `rate-limited`, `invalid-or-expired`, or `temporarily-unavailable`; never return provider
  internals, account existence, recipient, OTP, access token or refresh token in errors or logs.
- Configure the email template with `{{ .Token }}` (not a magic-link-only template), a custom SMTP sender, and the
  approved Send SMS Hook. Development uses only the in-memory adapters.

## Phase 5C entry requirements

Approve the Supabase project/region and DPA, privacy/cross-border text, publishable-key distribution, backend secret
storage, email domain/custom SMTP, Tencent Cloud qualification/signature/template, rate/session limits, CAPTCHA
choice, retention/purge window, account-deletion endpoint, test recipients and a non-production budget. Then add the
main-process Supabase adapter, encrypted session store, narrow IPC and login/link/delete UI. Sync upload stays off.
