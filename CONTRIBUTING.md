# Contributing to Activra

Thank you for helping improve Activra.

## Setup

Use Node.js 22 LTS (22.12 or later) and install the locked dependency set:

```bash
npm ci
```

Keep changes focused and reuse the existing Electron, React, TypeScript, and test patterns. Do not add a dependency when the existing code or platform already provides the required behavior.

## Checks

Run the checks relevant to your change. The standard local set is:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Electron end-to-end tests launch the application. Run them only with the test helper's isolated profile and never point `LIFE_UNLOCKED_USER_DATA` at a real user-data directory.

## Privacy and scope

- Use synthetic fixtures. Never submit real tasks, plans, habits, logs, user-data files, credentials, or personal information.
- Do not commit build outputs, installers, caches, or dependency directories.
- Preserve data compatibility and the offline-first behavior unless a change explicitly requires otherwise.
- Do not change or reuse Activra brand assets without the owner's permission; see [BRANDING.md](BRANDING.md).
- Keep third-party license and notice files intact; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

By contributing, you agree that your contribution is licensed under this repository's MIT License, except for material clearly identified as third-party content under its own license.
