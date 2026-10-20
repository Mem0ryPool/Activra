# Third-party software notices

Activra's MIT License covers only original Activra source code and documentation. Dependencies remain under their own licenses. `package-lock.json` is the authoritative record of exact package versions and declared license metadata for this staging baseline.

The lockfile contains 510 non-root package entries, and every entry declares a license in its package metadata. Those declarations were checked for completeness, but they are not a substitute for each package's actual license text.

## Direct development and build dependencies

| Package | Version | Declared license |
| --- | ---: | --- |
| `@electron/asar` | 3.4.1 | MIT |
| `@eslint/js` | 10.0.1 | MIT |
| `@playwright/test` | 1.64.1 | Apache-2.0 |
| `@tailwindcss/vite` | 4.3.3 | MIT |
| `@types/node` | 22.20.5 | MIT |
| `@types/react` | 19.3.0 | MIT |
| `@types/react-dom` | 19.3.0 | MIT |
| `@vitejs/plugin-react` | 6.1.2 | MIT |
| `electron` | 44.7.2 | MIT |
| `electron-builder` | 26.15.3 | MIT |
| `electron-vite` | 6.0.0 | MIT |
| `eslint` | 10.12.0 | MIT |
| `eslint-plugin-react-hooks` | 7.1.1 | MIT |
| `lucide-react` | 1.57.0 | ISC |
| `react` | 19.3.1 | MIT |
| `react-dom` | 19.3.1 | MIT |
| `tailwindcss` | 4.3.3 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `typescript-eslint` | 8.71.2 | MIT |
| `vite` | 8.3.4 | MIT |
| `vitest` | 5.0.5 | MIT |
| `zustand` | 5.0.15 | MIT |

## License families in the locked dependency tree

The lockfile metadata contains MIT, ISC, Apache-2.0, MPL-2.0, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, 0BSD, Python-2.0, CC-BY-4.0, WTFPL, and multi-license expressions.

Items requiring particular attention during distribution include:

- `caniuse-lite` 1.0.30001816 — CC-BY-4.0. Credit: Ben Briggs; source: `browserslist/caniuse-lite`. It is a transitive build-time data dependency through Browserslist. No `caniuse-lite` or CC-BY marker was found in the production `out/` build reviewed for this staging copy.
- `lightningcss` 1.32.0 and the Vite-nested 1.33.0, including platform packages — MPL-2.0; source: `parcel-bundler/lightningcss`. They are build-time CSS tooling. No `lightningcss` or MPL marker was found in the production `out/` build reviewed here. If their source, modified MPL-covered files, or binaries are redistributed separately, the MPL-2.0 requirements still apply.
- `lucide-react` 1.57.0 — ISC. Lucide icons are included in the renderer bundle, so its copyright and permission notice must accompany a binary distribution.
- `react` and `react-dom` 19.3.1 — MIT; `zustand` 5.0.15 — MIT. Their code is included in the renderer bundle, so their notices must accompany a binary distribution.
- `type-fest` 0.13.1 — MIT OR CC0-1.0;
- `utf8-byte-length` 1.0.5 — WTFPL OR MIT;
- `truncate-utf8-bytes` 1.0.2 — WTFPL;
- `sanitize-filename` 1.6.4 — WTFPL OR ISC.

Verbatim license and notice files needed for review are preserved in [`third_party_notices/`](third_party_notices/):

- `caniuse-lite-CC-BY-4.0.txt`;
- `lightningcss-MPL-2.0.txt`;
- `lucide-react-ISC.txt`;
- `playwright-NOTICE.txt` and `playwright-ThirdPartyNotices.txt`;
- `react-react-dom-MIT.txt`;
- `rolldown-THIRD-PARTY-LICENSE.txt`;
- `typescript-ThirdPartyNoticeText.txt`;
- `zustand-MIT.txt`.

Future packages are configured to include this file and the `third_party_notices/` directory in `app.asar`; the `afterPack` check rejects a package missing the core runtime notices. After `npm ci`, additional upstream license and notice files are present inside the installed packages. Do not remove required notices from redistributed dependency or binary materials. In particular, Playwright's notice identifies Microsoft Corporation and code derived from Puppeteer under Apache-2.0.

Electron itself also carries Electron/Chromium license materials outside the application bundle. This staging review did not rebuild or inspect the existing Windows RC.3 installer, so a future binary release must verify those files and the embedded application notices in the actual packaged artifact. This inventory is not a complete legal review of every dependency source file.
