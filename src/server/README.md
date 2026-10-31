# server

## Overview

The hosted collaboration server (`startCollabServer` in `collabServer.ts`). It
serves one root folder of deck folders over HTTP, with a WebSocket room per
open deck. Each open deck has one authoritative `CollabSession` that applies
transactions in order, saves them with debounced writes, and keeps a chat log,
an edit log (`history.jsonl`) and version snapshots. Around that core sit
optional Tailscale-based access control, a browser clipboard stash, streaming
video renditions, ZIP import and export, and HTTP endpoints for agents (the
agent mirror, HTML and native draft previews, theme verbs). The server never
runs an agent itself; it only tracks local `slide-agent connect` bridges. It
runs standalone (`npm run collab`) or inside the desktop app's main process
(`src/main`). Its browser client is
[renderer/collab](../renderer/collab/README.md).

## Interface

### Files

| File | Role |
| --- | --- |
| `collabServer.ts` | Entry (`startCollabServer`): HTTP routes, WebSocket rooms, peers, presence, presenter remotes, imports and exports, agent mirror and draft workflows (about 230 KB) |
| `collabSession.ts` | Authoritative deck of one room: seq-ordered transactions, debounced `deck.json` and theme saves, detection of external edits |
| `accessControl.ts` | Opt-in access control (`--access <adminLogin>`): Tailscale identity headers, per-deck `access.json`, `folder.json` ownership, `UserDirectory` |
| `chatLog.ts` | Per-deck append-only `chat.jsonl` with long-poll waiters |
| `editLog.ts` | Batched append-only `history.jsonl`, rotated to `history.1.jsonl` |
| `deckWire.ts` | Server messages to bytes, with the deck spliced in from an identity cache |
| `clipboardStash.ts` | In-memory store of browser-copied fragments under unguessable tokens |
| `streamingRenditions.ts` | Cached H.264 web renditions of large videos, kept outside the deck folder |
| `htmlDraftWorkflow.ts`, `htmlReplacement.ts` | Turn importer diagnostics into a blocked or ready decision; plan the ops that replace target slides with draft slides |
| `mirrorTheme.ts` | Theme verbs (list, show, choose, apply) for mirrored deck folders |
| `localAgents.ts` | `LocalAgentRegistry`: link, activity and scratchpad state of each participant's filesystem bridge |
| `assetRequestLog.ts` | One log line per asset response plus a 60 s census of in-flight responses |
| `zip.ts` | Streaming `writeZip` and `readZip` for deck archives |

### Key symbols and routes

- `startCollabServer(options: CollabServerOptions): Promise<RunningCollabServer>`;
  `CollabServerOptions` (`rootDir`, `clientDir?`, `port?`, `host?`,
  `hostedDeckId?`, `agentMode?`, `draftArchiveDir?`, `onHtmlDraft?`, ...);
  `BRIDGE_HEADER = 'x-deckwerk-bridge'` (`collabServer.ts`).
- Deck and folder routes: `/api/decks`, `/api/decks/rename`,
  `/api/decks/move`, `/api/folders`, `/api/folders/rename`, `/api/trash`,
  `/api/trash/restore`, `/api/deck`, `/api/access`, `/api/users`,
  `/api/config`, `/api/capabilities`.
- Import and export routes: `/api/import-deck`, `/api/import-pptx`,
  `/api/import-keynote`, `/api/import-url`, `/api/upload`, `/api/download`,
  `/api/export/web`, `/api/probe`.
- Agent routes: `/api/brief`, `/api/edit-schema`, `/api/preview-edits`,
  `/api/apply-edits`, `/api/preview-html`, `/api/apply-html`,
  `/api/html-drafts/latest`, `/api/context`, `/api/inspect`, `/api/text`,
  `/api/theme`, `/api/render-slide`, `/api/end`,
  `/api/agent-mirror/{files,file,health,validate,theme,sync-html,web/add,web/check}`,
  `/api/agent-panel/events`, `/api/agent-panel/state`.
- Collaboration routes: `/api/chat`, `/api/comments`,
  `/api/comments/resolve`; WebSocket upgrade at `/ws?deck=<id>`.
- `CollabSession` with `CollabSession.open(dir)`, `EditMeta`, `AppliedTxn`,
  `CollabSessionEvents` (`onExternalDeck`, `onExternalTheme`)
  (`collabSession.ts`).
- `resolveIdentity`, `readDeckAccess`, `writeDeckAccess`, `deckRoleFor`,
  `canAccessDeck`, `canEditDeck`, `canManageDeck`, `roleMayComment`,
  `readFolderOwner`, `writeFolderOwner`, `folderVisibleTo`,
  `normalizeLogin`, `normalizeShares`, `UserDirectory`, `ACCESS_FILE`,
  `FOLDER_FILE`, `AccessRole`, `DeckRole`, `DeckAccess`, `Identity`
  (`accessControl.ts`).
- `ChatLog` (`chatLog.ts`); `EditLog` with `close()` (flush) and `discard()`
  (`editLog.ts`); `DeckWire` (`deckWire.ts`); `ClipboardStash`,
  `CLIPBOARD_ID` (`clipboardStash.ts`).
- `RenditionStore`, `pruneRenditions`, `defaultRenditionCacheDir`,
  `renditionPath`, `isVideoAsset` (`streamingRenditions.ts`).
- `planHtmlReplacement(deck, targetSlideIds, draftSlides)`
  (`htmlReplacement.ts`); `htmlDraftWorkflow(input)` returning `blocked` or
  `ready-to-apply` (`htmlDraftWorkflow.ts`).
- `MirrorThemeRequestSchema`, `mirrorThemeAction`, `themeSummary`
  (`mirrorTheme.ts`); `LocalAgentRegistry`, `LocalAgentLink`,
  `LocalAgentEvent` (`localAgents.ts`); `writeZip`, `readZip`, `crc32`
  (`zip.ts`); `trackAssetResponse` (`assetRequestLog.ts`).

## Invariants

- Nothing outside `rootDir` is readable or writable. Every immediate
  subfolder containing a `deck.json` is an openable deck.
- With `hostedDeckId`, only that deck is listed or joinable, and creating or
  importing decks is disabled.
- Server sidecars (`agent-chats.json`, `access.json`, the chat file, history
  files) are never mirrored to agents, never served through mirror routes, and
  never taken from uploaded archives.
- A view-only peer still receives the live deck, but nothing it sends is
  applied; edit and comment rights are fixed when the socket is admitted.
  Nothing a peer sends is applied while its room is being relocated.
- Presenter-remote clicks are relayed only along a granted pair.
- Tailscale identity headers are trusted only from loopback sockets;
  off-loopback connections are rejected, and a header-less loopback request is
  the admin.
- Permissions live in `access.json`, never in a deck transaction. A deck
  without the sidecar is public and admin-owned. Roles only add up, and `view`
  never writes.
- Transactions apply synchronously in arrival order and each one gets the next
  `seq`; a fully skipped transaction still gets a `seq` and is broadcast.
- A closed `CollabSession` never writes, since a late write would bring a
  moved deck back at its old path. Editing one deck folder from the desktop
  app and this server at once is unsupported (last write wins).
- Chat and the edit log are never part of the deck, `seq` or any transaction.
  Unparseable chat lines are skipped.
- Clipboard stash bytes are stored unparsed and in memory only; the paste side
  validates them.
- Nothing on the shared event loop may scale with the deck: saves go through
  `DeckSerializer`, whole-deck messages through `DeckWire`
  (`test/collabStalls.test.ts` fails on any block over 30 ms).

## Side Effects

- An HTTP server (`node:http`) and a WebSocket server (`ws`).
- Reads and writes deck folders under `rootDir` (`deck.json`, theme, assets,
  `.trash`), including renames and moves.
- Debounced (800 ms) `deck.json` and theme saves, `fs.watch` with a 200 ms
  debounce, and version snapshots through `DeckVersionRecorder`
  (`src/main/deckVersions.ts`).
- Appends to `chat.jsonl`; batched (250 ms) appends to `history.jsonl` with
  rotation; writes `access.json` and `folder.json`.
- Spawns child processes for imports and media tools; ffmpeg renditions are
  written to a cache under the home folder and pruned.
- DNS lookups and outbound fetches for URL and web-page imports; headless
  Electron compiles and renders through `src/cli/compileHtml.ts` and
  `src/cli/renderSlides.ts`.
- A stdout/journald line per asset response and a 60 s census timer.
- Streams ZIP downloads; an optional `draftArchiveDir` receives every
  submitted HTML draft.

## Verification

- Run: `npx vitest run test/accessControl.test.ts test/collabAccess.test.ts test/chat.test.ts test/collabChat.test.ts test/collabEditHistory.test.ts test/collabFolders.test.ts test/clipboardStash.test.ts test/deckWire.test.ts test/htmlDraftWorkflow.test.ts test/htmlReplacement.test.ts test/mirrorTheme.test.ts test/streamingRenditions.test.ts`
- Run: `npx vitest run --config vitest.browser.config.ts test/collabServer.test.ts`
  (launches Electron)
- Run: `npx vitest run --config vitest.serial.config.ts test/collabStalls.test.ts`
  (event-loop stall budget; serial tier)
- Full suite: `npm test`
