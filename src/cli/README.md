# cli

## Overview

The `slide-agent` command-line tool (`agentCli.ts`, launched by
`bin/slide-agent` and `scripts/slide-agent.mts`) and the `connect` bridge
(`agentConnect.ts`). Agents use the CLI to read and edit DeckWerk decks; every
command prints JSON on stdout. With the editor running, commands go through it
and land in its undo history; without it, they read and rewrite `deck.json`
under a lock. The bridge mirrors a deck hosted on a collaboration server
(`src/server`) into a local folder and keeps the two in sync both ways.
`connectMain.ts` is the entry of the standalone `deckwerk-connect.mjs` bundle
(`vite.bridge.config.ts`) that the server hands to collaborators. The other
files are helpers for headless Electron compile, render, compare and preview,
a chat client, and the `./deck` helper script.

## Interface

### Files

| File | Role |
| --- | --- |
| `agentCli.ts` | Entry and dispatcher for `slide-agent`: `runAgentCli`, usage text, exit codes, flag parsing, every subcommand (about 100 KB) |
| `agentConnect.ts` | The bridge behind `slide-agent connect` and `deckwerk-connect.mjs`: session URL parsing, mirror folder, file-request bridge, `edit/` watcher, WebSocket and HTTP sync (about 60 KB) |
| `connectMain.ts` | Entry of the bundled `deckwerk-connect.mjs` (Node 22+, no native or browser dependencies) |
| `deckHelper.mjs` | Source of the `./deck` script written into each mirror folder; imported as a raw string |
| `chatClient.ts` | HTTP client for the server's `/api/chat`, used by `chat` and `say` |
| `compileHtml.ts` | Offline compile of authored HTML into slides in headless Electron; text overflow measurement; HTML draft PNGs |
| `renderSlides.ts` | Slide PNG capture through the exported player, contact sheets, headless web-page checks |
| `compareExport.ts` | Pixel comparison of the exported player against the authoring page, slide by slide |
| `previewServer.ts` | Static HTTP server on 127.0.0.1 for `slide-agent preview` |
| `electronDisplay.ts` | Headless Electron flags (Ozone headless on display-less Linux) and readable sandbox-crash errors |

### Commands (`agentCli.ts`)

- `context [deck] [--around <slide>]`: outline, revision, selection, whether
  the editor is live.
- `new [deck] [--count n]`: blank authoring page with no ids or scope;
  saving it can only add slides.
- `inspect [deck] [--html | --html-body | --elements-only | --dom]`: scoped
  authoring page, compact markup, object inventory or computed scenes.
- `apply [deck] --html <file> [--after <slide>] [--label]`: compile and sync
  an authoring page.
- `render`, `preview`, `validate`, `docs`, `help`, `capabilities`,
  `asset import`.
- `web import | add | replace | inspect | check`: sandboxed web pages as
  slides or boxes.
- `theme list | show | create | delete | choose | apply`.
- `comments [--unresolved | --resolve | --add ... --reply | --slide | --element]`.
- `chat [--since | --wait | --timeout]`, `say <text>` (hosted decks).
- `transaction apply <deck> <file.json>`: the JSON fallback path.
- `history [--deleted | --versions | --restore]`: a hosted deck's edit log and
  `.versions/` snapshots.
- `connect <sessionUrl> [--dir] [--agent <cmd> | --no-agent] [--name]`.

### Key symbols

- `runAgentCli(argv, io: CliIo): Promise<number>`, `CliIo {out, err, cwd}`,
  `EXIT_OK = 0`, `EXIT_ERROR = 1`, `EXIT_USAGE = 2`, `EXIT_CONFLICT = 3`
  (`agentCli.ts`).
- `currentContext`, `capabilitiesReport`, `resolveDeckDir`, `parseFlags`,
  `referenceDeckPath`, `agentGuidePath`, `tempDir`, `UsageError`
  (`agentCli.ts`).
- `parseSessionUrl`, `defaultMirrorDir`, `connectAgentBridge` (returns
  `AgentBridge {dir, target, ready, quiet(), close()}`), `runConnectCommand`,
  `mirrorAgentGuide`, `MIRROR_MARKER_FILE = '.deckwerk-mirror.json'`,
  `SELECTION_FILE = '.deckwerk-selection.json'`, `HELPER_FILE = 'deck'`
  (`agentConnect.ts`).
- `resolveChatTarget`, `listChat`, `postChat`, `waitForMention`,
  `ChatUsageError` (`chatClient.ts`).
- `compileHtmlToSlides`, `measureBuiltTextOverflows`, `measureSavedPage(s)`,
  `headlessBrowserProblem`, `prepareHtmlDraftRenderPage`,
  `renderHtmlDraftPng` (`compileHtml.ts`).
- `renderSlidesToPng`, `checkWebPage`, `captureTimeoutMs`
  (`renderSlides.ts`); `compareExportToPlayer` (`compareExport.ts`);
  `serveBundle(bundleDir, port)` (`previewServer.ts`);
  `headlessElectronArgs`, `electronFailure` (`electronDisplay.ts`).

## Invariants

- All command output is JSON on stdout (except `docs`, `help` and
  `inspect --html`); diagnostics go to stderr. Exit codes are 0 ok, 1 error,
  2 usage, 3 revision conflict.
- Every command works with or without the editor running. Offline writes go
  through the revision-checked, locked path in `src/main/agentDeck.ts`.
- There are no delete, move or reorder commands: those are sections removed or
  moved in an `inspect --html` page. A copied export inherits its scope marker
  and deletes the slides it governed when saved, so new slides are authored with
  `new`.
- `--slide` takes a slide id or a 1-based slide number.
- A session URL must be http(s), carry `?deck=`, and carry a participant id
  (`agent`, `agentSession` or `participant`) matching
  `/^[a-zA-Z0-9_-]{8,80}$/`.
- The bridge never chooses or starts an agent unless `--agent` is passed.
  Pages saved in `edit/` are compiled by the server, so the bridge bundles no
  browser.
- `deckHelper.mjs` output is regenerated on every connect; `./deck` must not
  be edited by hand.
- `chat` needs `--server` and `--deck-id` together, or a
  `.deckwerk-mirror.json` in the folder. `waitForMention` pins `since` to an
  existing message id first, so a message posted between two polls is not
  missed; each poll waits at most 25 s.
- The headless Electron flag goes after the job arguments, because helper
  scripts read their job from a fixed `process.argv` index.
- A change to the export, compile, sync, bridge or `./deck` loop adds a case to
  `test/agentCollaboration.test.ts` (and a fuzz move if new) in the same change
  (repository AGENTS.md rule).

## Side Effects

- Reads and writes deck folders: `deck.json`, theme, assets, `edit/`,
  `.versions/`; atomic replacement and file-based requests to a running editor
  go through `src/main/agentRuntime.ts`.
- The bridge opens a WebSocket to `<origin>/ws?deck=<id>`, makes HTTP sync
  calls, and by default mirrors to `~/.deckwerk/mirrors/<host>/<deckId>`. It
  writes `deck.json`, `notes.md`, `assets/`, `./deck` (made executable),
  `.deckwerk-mirror.json`, `.deckwerk-selection.json`, `.deckwerk-bridge.log`
  and `CLAUDE.md`, and watches `edit/` and `.deckwerk-apply.<uuid>.json`
  requests. With `--agent` it spawns that command.
- `chatClient.ts` sends GET and POST requests to `<origin>/api/chat`,
  including long polls.
- Spawns headless Electron for compile, render, web checks and export
  comparison; creates temporary scratch folders and export bundles; writes PNGs
  (captures, contact sheets, diff images) to the output folder.
- `preview` serves the bundle on `127.0.0.1:<port>` with
  `cache-control: no-store` until it is killed.

## Verification

- Run: `npx vitest run test/agentThemeCli.test.ts test/chat.test.ts test/fieldAliasesCli.test.ts`
- Run: `npx vitest run --config vitest.browser.config.ts test/agentCli.test.ts test/webElement.test.ts`
  (launches Electron)
- Run: `npx vitest run --config vitest.serial.config.ts test/agentCollaboration.test.ts test/localAgentBridge.test.ts`
  (agent collaboration loop; serial tier)
- Full suite: `npm test`
