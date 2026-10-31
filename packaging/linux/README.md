# packaging/linux

## Overview

Linux-only packaging inputs. Nothing here is built or imported by the app's
TypeScript; each file is consumed verbatim by an outside tool:

- The Flatpak build ([`flatpak/org.deckwerk.DeckWerk.yml`](../../flatpak/org.deckwerk.DeckWerk.yml))
  copies the launcher, desktop entry, AppStream metadata and icon into `/app`.
- systemd, on a machine that hosts a collaboration server, loads the Chromium
  sandbox drop-in into `deckwerk-collab.service`. The test harness reads the
  same drop-in, so it is both the operator's config and the tested policy.

The AppImage, `.deb` and `tar.gz` builds do not use this folder:
electron-builder writes their desktop entry from the `linux` block of
[`electron-builder.config.cjs`](../../electron-builder.config.cjs) and takes
its icon from `resources/deckwerk-icon.png`.

## Interface

| File | Consumed by | Installed as |
| --- | --- | --- |
| `deckwerk-flatpak-launcher.sh` | Flatpak manifest (`install -Dm755`) | `/app/bin/deckwerk`, the manifest's `command` |
| `org.deckwerk.DeckWerk.desktop` | Flatpak manifest | `/app/share/applications/org.deckwerk.DeckWerk.desktop` |
| `org.deckwerk.DeckWerk.metainfo.xml` | Flatpak manifest; Flathub, GNOME Software, KDE Discover | `/app/share/metainfo/org.deckwerk.DeckWerk.metainfo.xml` |
| `org.deckwerk.DeckWerk.png` | Flatpak manifest | `/app/share/icons/hicolor/512x512/apps/org.deckwerk.DeckWerk.png` |
| `deckwerk-collab-chromium-sandbox.conf` | systemd (by hand); `test/support/collabServerProcess.ts` | `/etc/systemd/system/deckwerk-collab.service.d/chromium-sandbox.conf` |

- **`deckwerk-flatpak-launcher.sh`**: a POSIX `sh` wrapper that runs
  `exec zypak-wrapper /app/deckwerk/deckwerk "$@"`. `zypak-wrapper` comes from
  the `org.electronjs.Electron2.BaseApp` base and sends Chromium's sandbox
  calls to the Flatpak portal, so the app starts without `--no-sandbox`.
- **`org.deckwerk.DeckWerk.desktop`**: the Flatpak's launcher entry:
  `Exec=deckwerk %U`, `Icon=org.deckwerk.DeckWerk`,
  `StartupWMClass=DeckWerk`, categories `Office;Presentation;`.
- **`org.deckwerk.DeckWerk.metainfo.xml`**: the AppStream component behind the
  store listing (id, summary, description, licences `CC0-1.0`/`MIT`, URLs,
  screenshots, OARS rating, `<releases>`). Flathub will not accept a
  submission without it.
- **`org.deckwerk.DeckWerk.png`**: the 512×512 RGBA app icon.
- **`deckwerk-collab-chromium-sandbox.conf`**: a systemd `[Service]` drop-in
  for the collaboration server (`npm run collab`) run under the usual
  hardening. It sets `RestrictNamespaces=user pid net`, clears
  `SystemCallFilter=`, then allows `@system-service chroot` and denies a list
  of syscalls. That list spells out the groups the usual hardening denies
  (`@privileged`, `@mount`, `@resources`, `@debug` and the rest) call by call,
  minus the two Chromium's sandbox needs, `chroot` and `capset`. Install it with
  the two commands in its header comment, or see "Running under systemd" in
  [`docs/collab.md`](../../docs/collab.md). The repository ships no
  `deckwerk-collab.service` unit itself; the drop-in goes on top of the
  operator's own unit.

## Invariants

- **The Flatpak names must agree.** The manifest's `app-id`, the
  `.desktop` file name, the `.desktop` `Icon=`, the metainfo `<id>` and
  `<launchable>`, and the icon's installed name are all
  `org.deckwerk.DeckWerk`. `Exec=deckwerk` must match both the manifest's
  `command: deckwerk` and the launcher's install path `/app/bin/deckwerk`.
- **The launcher's target is the unpacked tarball.** `/app/deckwerk/deckwerk`
  exists because the manifest copies the release `tar.gz` into `/app/deckwerk/`
  and electron-builder's `executableName` is `deckwerk`. Renaming either breaks
  the launcher.
- **Never add `--no-sandbox` to the launcher.** `zypak-wrapper` is what keeps
  renderer isolation inside the Flatpak sandbox.
- **`StartupWMClass=DeckWerk`** must match the window class Electron derives
  from `productName` (`DeckWerk`). Otherwise the running window shows up as a
  second, generic dock entry.
- **The icon must really be 512×512.** The icon-theme cache and Flathub's
  linter read the `hicolor/512x512` directory name as a claim about the file.
- **Metainfo screenshot URLs must resolve before a Flathub submission.** They
  point at `docs/assets/screenshots/editor.png` and `presenter.png` on the
  default branch. Flathub's linter rejects unreachable URLs, and at least one
  screenshot is required. Those files are not in the repository yet.
- **Metainfo `<releases>` is maintained by hand.**
  `scripts/render-flatpak-manifest.mjs` rewrites only the manifest's tarball
  `url` and `sha256`. Nothing in the release workflow adds a `<release>` entry
  here. The file currently lists only 0.1.0, while `package.json` is at a later
  version.
- **The sandbox drop-in's `[Service]` lines are the tested policy.**
  `chromiumSandboxDropIn()` in `test/support/collabServerProcess.ts` reads
  every `Key=value` line, except the bare `SystemCallFilter=` reset, as a
  `systemd-run -p` property. Keep each setting on one physical line. Every
  key must also be a property that `systemd-run` accepts.
- **The drop-in must allow only what Chromium's sandbox needs.** That is
  user, pid and net namespaces, plus `chroot(2)` and `capset(2)`. Leave the
  rest of the unit's hardening alone. A setuid `chrome-sandbox` is no
  substitute: `NoNewPrivileges` ignores setuid bits.

## Side Effects

- None at build or test time from this folder itself; every file is static
  input.
- Installed in a Flatpak, the launcher `exec`s the Electron binary through
  `zypak-wrapper` and passes all arguments through.
- Installed as a drop-in, the sandbox config changes the effective sandbox of
  `deckwerk-collab.service` after `systemctl daemon-reload` and a restart.
  Without it, every agent save, PNG render and web-page check on that server
  fails because Chromium cannot start, while pages and sockets keep working.
- `test/agentCollaborationSandbox.test.ts` (via `collabServerProcess.ts`)
  launches a transient `systemd-run --user` unit with this drop-in's
  properties applied.

## Verification

- Sandbox drop-in:
  `npx vitest run --config vitest.serial.config.ts test/agentCollaborationSandbox.test.ts`.
  It runs only on Linux hosts where `systemd-run --user` can apply the policy.
  The production-policy case also needs unprivileged user namespaces, which
  GitHub's Ubuntu runners do not allow. The installed-unit case runs only
  where `deckwerk-collab.service` is loaded. Everywhere else the suite skips.
- Flatpak files: the local `flatpak-builder` build and `flatpak-builder-lint`
  commands in [`docs/RELEASING.md`](../../docs/RELEASING.md) (Flathub
  section). `npm test` has no suite for the launcher, desktop entry, metainfo
  or icon.
- Full suite: `npm test`, run outside restricted sandboxes (see the repository
  [`AGENTS.md`](../../AGENTS.md)).
