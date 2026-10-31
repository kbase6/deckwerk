# src

## Overview

All application source for DeckWerk, a slide editor with an Electron desktop
app, a hosted collaboration server with a browser client, and a CLI that lets
agents edit decks through HTML files. A deck is a folder (`deck.json`,
`theme.css`, `assets/`, `edit/`, `notes.md`), and `src/shared/deck.ts` is the
schema every part of the system reads and writes.

The pieces fit together like this:

- [`main`](./main/README.md) is the Electron main process. It owns the
  filesystem, ffmpeg, importers and windows, and is reached only through the
  typed IPC exposed by [`preload`](./preload/README.md).
- [`renderer`](./renderer/README.md) holds every browser surface: the
  editor, presentation, Speaker View, print, trim and raster windows, the
  collaboration web client, and the shared player.
- [`server`](./server/README.md) is the collaboration server. It runs
  standalone (`npm run collab`) or inside the desktop app, and owns one
  authoritative deck per room.
- [`cli`](./cli/README.md) is `slide-agent` and the `connect` bridge. It
  goes through the running editor when there is one, writes the deck folder
  under a lock when there is not, and mirrors hosted decks.
- [`shared`](./shared/README.md) is the process-agnostic core: deck schema,
  agent transactions, collaboration protocol, HTML authoring, themes and
  timeline.

Build entry points: `main/index.ts`, `preload/index.ts` and the renderer pages
(`electron.vite.config.ts`); `renderer/collab/*.html`
(`vite.collab.config.ts`); `renderer/export/standalone.ts`
(`vite.export.config.ts`); `cli/connectMain.ts` (`vite.bridge.config.ts`).

## Subdirectories & Boundaries

- cli: [./cli/README.md](./cli/README.md) - The `slide-agent` CLI (JSON on
  stdout, exit codes 0/1/2/3) and the `connect` bridge that mirrors a hosted
  deck into a local folder. Depends on `shared`, `main`.
- main: [./main/README.md](./main/README.md) - Electron main process: IPC
  handlers, deck folder I/O, `deck://` protocol, ffmpeg and importer
  sidecars, export, windows, agent runtime, hosting a collab session. Depends
  on `shared`, `server`, `cli`.
- preload: [./preload/README.md](./preload/README.md) - The `window.api`
  bridge (`Api` type) over `ipcRenderer`, with `deck://` asset URLs. Depends on
  `shared`.
- renderer: [./renderer/README.md](./renderer/README.md) - Browser surfaces
  (editor, collab client, player, export, present, presenter, print, raster,
  trim) and the shared light/dark app chrome. Depends on `shared` and
  `window.api`.
- server: [./server/README.md](./server/README.md) - Collaboration server:
  HTTP and WebSocket rooms, `CollabSession`, access control, chat, edit log,
  renditions, agent mirror routes. Depends on `shared`, `main`, `cli`.
- shared: [./shared/README.md](./shared/README.md) - Pure core: `DeckSchema`
  and `parseDeck`, agent transactions, `applyOpsLenient`, collab wire
  protocol, HTML authoring, themes, timeline, Morph, comments, IPC channel
  names. Depends only on zod (plus type-only and raw-CSS imports).
- types: [./types/README.md](./types/README.md) - Ambient declarations for
  untyped third-party modules (`katex/contrib/auto-render`).

## Global Invariants

- `src/shared/deck.ts` is the single source of truth for `deck.json`. Nothing
  writes `deck.json` by hand: edits go through the editor, revision-checked
  agent transactions (`src/shared/agent.ts`), or the server's ordered
  transaction stream.
- Renderer code reaches Node only through `window.api`; the collab client
  supplies `netApi.ts`, an HTTP stand-in for the part of the `Api` type the
  shared editor components use.
- One renderer for slides: `renderer/player` draws the editor previews,
  presentations, exports, PDF pages and Speaker View alike.
- Retired field names are mapped in one table (`src/shared/fieldAliases.ts`)
  at every entry point; `line-height` is stored as a unitless ratio.
- Comments are review state, changed only through `updateComments`, and
  untouched by undo.
- Nothing on the collaboration server's event loop scales with deck size.

## Global Side Effects

- Deck folders on disk: `deck.json`, `theme.css`, `assets/`, `edit/`,
  `notes.md`, `AGENTS.md`, `.versions/`, history and (on hosted decks) chat and
  edit-log files.
- Agent runtime state under `~/.deckwerk/runtime`; bridge mirrors under
  `~/.deckwerk/mirrors`; poster and rendition caches outside deck folders.
- Child processes: ffmpeg/ffprobe, Python Keynote and PowerPoint importers,
  headless Electron for compile, render and checks.
- Network: the collaboration HTTP/WebSocket server, the bridge's connection to
  it, localhost preview servers, and fetches for URL and clipboard image
  imports.

## System Verification

- Run: `npm test` (unit, browser and serial tiers; run outside restricted
  sandboxes)
- Targeted: `npx vitest run test/<name>.test.ts` for unit suites,
  `npx vitest run --config vitest.browser.config.ts test/<name>.test.ts` for
  Electron suites, `--config vitest.serial.config.ts` for serial ones.
- Type check: `npm run typecheck`
