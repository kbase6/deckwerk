# packaging

## Overview

Platform packaging inputs that are not application code: the macOS signing
entitlements, plus the Linux Flatpak desktop integration and systemd sandbox
policy. The release build reads these files by path. Electron Builder reads
them through [`electron-builder.config.cjs`](../electron-builder.config.cjs),
and the Flatpak build reads them through
[`flatpak/org.deckwerk.DeckWerk.yml`](../flatpak/org.deckwerk.DeckWerk.yml).
None is imported by `src/`. Windows needs no file here: its NSIS settings and
Azure signing live entirely in `electron-builder.config.cjs`.

## Subdirectories & Boundaries

- linux: [./linux/README.md](./linux/README.md). Flatpak launcher
  (`zypak-wrapper`), desktop entry, AppStream metainfo and 512×512 icon, all
  installed by the Flatpak manifest. Also the systemd drop-in that lets the
  collaboration server's headless Chromium sandbox itself under
  `deckwerk-collab.service`, which the agent sandbox tests read as their
  policy.

## Local Files

### `entitlements.mac.plist`

Hardened-runtime entitlements for the macOS app. `electron-builder.config.cjs`
passes it as both `mac.entitlements` and `mac.entitlementsInherit`, so the
main app and every helper/sidecar process are signed with the same set.

| Entitlement | Why it is needed |
| --- | --- |
| `com.apple.security.cs.allow-jit` | V8 compiles JavaScript at runtime |
| `com.apple.security.cs.allow-unsigned-executable-memory` | V8; without it the renderer crashes on launch |
| `com.apple.security.cs.allow-dyld-environment-variables` | Electron sets `DYLD_*` when spawning helpers |
| `com.apple.security.cs.disable-library-validation` | Loads code not signed by the app's team: libheif-js's native module, the ffmpeg/ffprobe binaries unpacked from the asar, and the frozen PyInstaller Keynote importer |

## Invariants

- The four entitlements are each load-bearing. Removing one breaks a signed,
  notarized build: the app crashes on launch, helpers fail to spawn, or the
  bundled sidecars are refused. Add a new entitlement only for a concrete
  runtime need, and record why in the plist's comment.
- The entitlements only take effect when the build is signed. `hardenedRuntime`
  and `notarize` are on only when `CSC_LINK`, `APPLE_ID` and `APPLE_TEAM_ID`
  are all set. Unsigned builds are ad-hoc signed by
  `scripts/adhoc-sign-mac.cjs` instead, so a missing entitlement may not show
  up locally.
- Paths into this folder are hard-coded in `electron-builder.config.cjs`,
  `flatpak/org.deckwerk.DeckWerk.yml`, `test/support/collabServerProcess.ts`,
  `docs/collab.md` and `AGENTS.md`. Moving or renaming a file means updating
  all of them.
- See [./linux/README.md](./linux/README.md) for the Linux-specific
  invariants: Flatpak name agreement, the no-`--no-sandbox` rule, and the
  one-line-per-setting format of the systemd drop-in.

## Side Effects

- None at runtime or test time from `entitlements.mac.plist`. It is read once
  by `codesign` during a signed macOS build.
- For the Linux files' install-time effects, see
  [./linux/README.md](./linux/README.md).

## Verification

- No `npm test` suite covers `entitlements.mac.plist`. It is exercised by a
  signed, notarized macOS release build (`.github/workflows/release.yml`).
- Linux sandbox policy:
  `npx vitest run --config vitest.serial.config.ts test/agentCollaborationSandbox.test.ts`
  (Linux with `systemd-run --user` only; skips elsewhere).
- Full suite: `npm test`, run outside restricted sandboxes (see
  [`AGENTS.md`](../AGENTS.md)).
