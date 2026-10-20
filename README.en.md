# Activra

**Action · Progress · Achievement**

[简体中文](README.md)

Activra is an offline-first desktop productivity app that turns tasks, plans, habits, and focus sessions into clear actions and visible achievements. Its core features require no account or cloud service, and application data stays on the local device.

This repository is an open-source staging copy prepared from the audited `1.0.0-rc.3` candidate baseline `b1f65184cb3ad21beac9b0f33174243000489403`. It is not a published release and contains no download link, signed installer, or automatic publishing configuration.

The existing Windows RC.3 installer came from that frozen baseline and has not been modified by this repository. This staging copy adds open-source licensing and public documentation, third-party notices, and a development-server origin-validation fix after the baseline. Its final Git commit is therefore not the installer's byte-for-byte source snapshot and does not prove a byte-reproducible installer. Any future binary release must be rebuilt from this repository and separately pass install, upgrade, uninstall, signing, and hash acceptance checks.

## Features

- Tasks, recurrence, deadlines, undo, and achievement notifications
- Offline, rule-based planning with no AI or network service
- Habit check-ins, streaks, and local weekly reports
- Focus timer, calendar, statistics, and desktop widget
- Simplified Chinese and English interfaces

## Development

Node.js 22 LTS (22.12 or later) and npm are required.

```bash
npm ci
npm run dev
```

Common checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

See [docs/windows-release.md](docs/windows-release.md) and [docs/macos.md](docs/macos.md) for platform build notes. Installers are unsigned by default, and `publish: null` prevents electron-builder from uploading artifacts automatically.

## Data and privacy

Application data lives in the system's `Life Unlocked` user-data directory. The directory name remains unchanged after the public name changed to Activra so existing data remains compatible. See [docs/data-migration.md](docs/data-migration.md) for formats, backups, and migration behavior.

Tests and contributions must use synthetic data or isolated directories. Do not commit real tasks, logs, user data, credentials, installers, or other personal information.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) first. Run at least the type checks, lint checks, and tests relevant to your change before submitting it.

## License

Original Activra source code and documentation are available under the [MIT License](LICENSE):

`Copyright (c) 2026 Mem0ry`

`private: true` only prevents accidental publication to the npm registry. It does not restrict use of the repository under the MIT License.

The MIT License does not cover third-party components and does not automatically grant rights to the Activra name, logo, or derived brand assets. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [BRANDING.md](BRANDING.md).
