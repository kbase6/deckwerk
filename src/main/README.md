# main

## Overview

The Electron main process (entry `index.ts`, built by
`electron.vite.config.ts`). Per its doc comment it "owns the filesystem,
ffmpeg and the windows"; renderers reach it only through the typed IPC in
`src/shared/ipc.ts`, exposed by the [preload](../preload/README.md). It
covers deck folder I/O (`deck.json`, theme, assets, history and version
sidecars), media (ffmpeg and ffprobe, HEIC, MP4 faststart, poster frames), the
Keynote and PowerPoint importer sidecars, self-contained web and PDF export,
per-window deck state with satellite windows (present, speaker, trim, raster,
PDF), the filesystem agent runtime, and hosting a collaboration session through
`src/server`.

## Interface

### Files

| Area | Files |
| --- | --- |
| Entry | `index.ts`: app lifecycle, every `ipcMain` handler, deck/theme/`edit/` watchers, presentation displays, collab server and local agent registry |
| Deck folder I/O | `deckStore.ts` (deck, theme, notes, asset import and resolution), `deckSerializer.ts` (incremental serializer), `deckHistoryStore.ts` (`deck-history-v2.json.gz`), `deckVersions.ts` (`.versions/` snapshots), `copyFileStreamed.ts` |
| Agents | `agentDeck.ts` (offline transactions under `deck.lock`), `agentRuntime.ts` (runtime state, inbox, atomic writes), `agentGuide.ts` (generated `AGENTS.md`), `htmlAuthoring.ts` (`edit/*.html` export and compile-back) |
| Media | `ffmpeg.ts`, `heic.ts`, `mp4FastStart.ts`, `posterCache.ts`, `clipboardImageFetch.ts`, `assetProtocol.ts` (`deck://` scheme) |
| Import and export | `keynoteImport.ts`, `pptxImport.ts` (Python sidecars), `exportDeck.ts`, `exportThumbnail.ts` |
| Windows | `windows.ts` (window factories), `deckWindows.ts` (per-window deck state), `windowHandoff.ts`, `windowHealth.ts`, `presentationDisplays.ts`, `dialogs.ts` |

### Key symbols

- IPC handled in `index.ts` (channel names from `IPC` in `src/shared/ipc.ts`):
  deck lifecycle (`deckNew`, `deckOpen`, `deckSave`, `deckSaveAs`,
  `deckLoadTheme`, `deckSaveTheme`, `deckHistoryLoad`, `deckKeyGet`); agents
  and collaboration (`agentContextPublish`, `agentResponse`,
  `agentPanelGetState`, `agentSessionEnd`, `collabStart`); presentation
  (`presentOpen`, `presentCommand`, `presentState`, `displayList`); media tools
  (`trimOpen`, `trimRun`, `rasterOpen`, `videoPoster`, `assetProbe`,
  `assetSaveOriginal`, `windowCapture`); export and misc (`exportBundle`,
  `exportPdf`, `exportPdfReady`, `htmlExport`, `htmlAdopt`,
  `speakerNotesOpen`, `clipboardWrite`, `clipboardRead`).
- `loadDeck`, `saveDeck`, `createDeck`, `copyDeck`, `serializeDeck`,
  `importAsset`, `importImageBuffer`, `importWebPage`, `derivedAssetPath`,
  `resolveAsset`, `originalAssetPath`, `DECK_FILE = 'deck.json'`,
  `ASSETS_DIR = 'assets'` (`deckStore.ts`).
- `registerAssetScheme`, `installAssetProtocol`, `parseRange`
  (`assetProtocol.ts`).
- `DeckWindowState`, `registerEditorWindow`, `ownerOf`, `deckKeyFor`,
  `stateForDeckDir`, `NO_DECK_KEY` (`deckWindows.ts`).
- `createEditorWindow`, `createPresentWindow`, `createPresenterWindow`,
  `createTrimWindow`, `createRasterWindow`, `createPdfWindow`,
  `createCollabHostWindow` (`windows.ts`).
- `AgentRuntime`, `writeAgentRequest`, `waitForAgentResponse`,
  `readLiveAgentContext`, `agentStateRoot`, `deckRevision`,
  `replaceFileAtomically`, `atomicJson` (`agentRuntime.ts`).
- `applyTransactionOffline`, `withDeckLock`, `RevisionConflict`,
  `validateDeckFolder` (`agentDeck.ts`); `writeAgentGuide`,
  `AGENT_GUIDE_FILE = 'AGENTS.md'`, `AGENT_GUIDE_MARKER` (`agentGuide.ts`).
- `writeHtmlScope`, `htmlEditTransaction`, `HTML_EDIT_DIR = 'edit'`
  (`htmlAuthoring.ts`).
- `exportDeck`, `webExportUnavailableReason`, `referencedAssets`,
  `rewriteAssetReferences`, `playedRange` (`exportDeck.ts`).
- `probeMedia`, `transcodeToH264`, `transcodeVideoForWeb`, `runTrim`,
  `buildTrimArgs`, `extractPosterFrame`, `encodeImageWebp`, `getFfmpegPath`
  (`ffmpeg.ts`); `convertHeicToPng` (`heic.ts`); `needsFastStart`,
  `writeFastStart` (`mp4FastStart.ts`); `posterFor`, `POSTER_HOST`
  (`posterCache.ts`).
- `importKeynote`, `runImporterSidecar` (`keynoteImport.ts`);
  `importPowerPoint` (`pptxImport.ts`).
- `DeckSerializer`, `writeDeckChunks` (`deckSerializer.ts`);
  `DeckVersionRecorder`, `listDeckVersions`, `pruneDeckVersions`,
  `VERSIONS_DIR = '.versions'` (`deckVersions.ts`); `loadDeckHistory`,
  `saveDeckHistory`, `DECK_HISTORY_FILE` (`deckHistoryStore.ts`).
- `attachRendererHealth`, `UNRESPONSIVE_GRACE_MS = 8000`
  (`windowHealth.ts`); `importClipboardImageUrl`, `importImageSource`
  (`clipboardImageFetch.ts`); `copyFileStreamed`.

## Invariants

- Renderers never touch Node directly; everything crosses the typed IPC.
- `app.setName` and `registerAssetScheme` run before the app `ready` event.
- `deck://` URLs carry the deck key as the host, because a protocol request
  has no window identity.
- `resolveAsset` throws when a `src` escapes the deck folder, directly or
  through a symlink. `originalAssetPath` only accepts files under `assets/`.
- Deck state is per editor window: handlers find the owning
  `DeckWindowState` from the IPC sender, so one window cannot answer with or
  write into another's deck.
- Only one collaboration or filesystem-agent session runs per app
  (`collabOwner`). A second deck asking to share is refused.
- Offline agent edits run under a `deck.lock` in the deck's agent runtime
  folder (created exclusively, records the owner pid; defaults: 10 s timeout,
  30 s stale reclaim).
- Ephemeral agent state lives outside the deck folder, in
  `DECKWERK_STATE_DIR` or `~/.deckwerk/runtime`.
- `AGENTS.md` is rewritten whenever its content would change, unless the
  author deletes its marker line.
- History lives beside `deck.json`, not in it. The legacy history file is never
  read or migrated, and a damaged history file must not stop a deck opening.
- `DeckSerializer` output is byte-for-byte identical to `serializeDeck`.
- Never use `fs.copyFile` on the server path (its `fchown` is killed by the
  systemd seccomp filter). Copies and writes go to a temp file and are renamed
  into place.

## Side Effects

- Writes into deck folders: `deck.json`, theme CSS, `assets/`, speaker notes,
  `AGENTS.md`, `edit/*.html`, `.versions/*.json.gz`,
  `deck-history-v2.json.gz`.
- Agent runtime folder under `~/.deckwerk/runtime` (or
  `DECKWERK_STATE_DIR`): inbox watcher, request, response and context JSON,
  and the per-deck `deck.lock`.
- `fs.watch` on each open deck's folder, theme file and `edit/` folder.
- Spawns ffmpeg/ffprobe and the Python Keynote and PowerPoint importers;
  `exportThumbnail.ts` renders through `src/cli/renderSlides.ts`, which
  spawns Electron.
- Registers the privileged `deck://` protocol (range requests via
  `net.fetch`).
- Fetches remote images referenced by clipboard HTML into temp files.
- Creates BrowserWindows (editor, collab host, present, speaker, hidden PDF,
  trim, raster) with the preload script.
- Starts the collaboration HTTP server and a `LocalAgentRegistry` from
  `src/server`.
- Reads and writes the system clipboard, including a private format and
  images.
- Writes poster JPEGs to an on-disk cache; shows native dialogs (or consumes a
  `DECKWERK_TEST_DIALOGS` queue in tests) and renderer hang or crash dialogs.

## Verification

- Run: `npx vitest run test/deckStore.test.ts test/deckSerializer.test.ts test/deckVersions.test.ts test/deckHistoryStore.test.ts test/agentTransactions.test.ts test/agentGuide.test.ts test/windowHealth.test.ts test/presentationDisplays.test.ts test/exportDeckAssets.test.ts`
- Run: `npx vitest run --config vitest.browser.config.ts test/htmlAuthoring.test.ts`
  (launches Electron)
- Run: `npx vitest run --config vitest.serial.config.ts test/ffmpeg.test.ts test/mp4FastStart.test.ts test/keynoteImport.test.ts test/pptxImport.test.ts`
  (real ffmpeg and importer processes; serial tier)
- Full suite: `npm test`
