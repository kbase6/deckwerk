# dev

## Overview

Developer tools you run by hand: browser harnesses and a benchmark. They sit
outside the app and outside the test tiers. Nothing here ships:

- electron-vite does not build it;
- `tsconfig.json` does not `include` it (only `src/`, `test/` and
  `electron.vite.config.ts`);
- `npm test` does not run it, and no `package.json` script points at it.

Both subfolders import production code from [src/](../src) directly. The
benchmark also reuses the Electron/CDP helpers in [test/support/](../test/support).
Because nothing type-checks these files, a change to the APIs they import
breaks them only when someone next runs them.

There are no source files directly in `dev/`.

## Subdirectories & Boundaries

- harness: [./harness/README.md](./harness/README.md). Vite pages that mount
  the real editor canvas, Inspector and Build panels, Player, Trim & Crop
  window, and agent chat panel in an ordinary browser, with a stubbed
  `window.api` bridge. Serve them with
  `npx vite --config vite.harness.config.ts`, which `.claude/launch.json`'s
  `harness*` entries also run. Every page writes nothing to disk. Known drift:
  `agent-chat.html` imports a panel that no longer exists, and `player.html`'s
  default deck is missing.
- bench: [./bench/README.md](./bench/README.md). `presentVideoBench.mts`
  measures time to first frame and time to playing for a real deck's videos
  in the collab server's `present.html`, under CDP-throttled bandwidth. It
  runs through `vite-node`. It serves a scratch copy of the deck (copied JSON
  and CSS, hard-linked assets) so the source deck is never written to. It
  launches Electron and a localhost collab server. The results feed
  [docs/media-loading.md](../docs/media-loading.md).

## Global Invariants

- Code here may depend on `src/` and `test/support/`. Nothing in `src/` or
  `test/` may depend on `dev/`.
- These tools must never write to a user's deck or to the checkout. The
  harness stubs every bridge method that saves, imports or trims. The bench
  works only in a scratch root under `${XDG_CACHE_HOME:-~/.cache}/deckwerk/`.

## Global Side Effects

- Localhost servers: the Vite dev server for the harness, which serves the
  whole project root, and the collab server for the bench.
- The bench launches Electron/Chromium, builds the collab client into a
  cache under the OS temp directory, and creates and then removes a
  `bench-*` scratch folder.

## Verification

- Neither tool has a test of its own. See each child README for a smoke
  command and for the suites that cover the code each tool mounts or
  measures.
- Full suite: `npm test`.
