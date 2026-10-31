# preload

## Overview

The Electron preload script (built from `index.ts` by
`electron.vite.config.ts`). It builds one `api` object of typed wrappers over
`ipcRenderer.invoke`, `send` and `on`, using the channel names in
`src/shared/ipc.ts`, and exposes it to every desktop renderer page as
`window.api` through `contextBridge`. It also tracks the window's deck key, so
`deck://` asset URLs name the right deck when several decks are open. The
browser collaboration client (`src/renderer/collab`) replaces this object with
`netApi.ts`, which implements over HTTP only the part of the `Api` type the
shared editor components call.

## Interface

- `Api` (`index.ts`): `export type Api = typeof api`, the whole
  renderer-facing surface. `src/shared/api.d.ts` declares it as
  `window.api`.
- Window: `captureWindow`.
- Deck lifecycle: `newDeck`, `openDeck`, `getDeck`, `openDeckPath`,
  `saveDeck`, `syncDeckSnapshot`, `saveDeckAs`, `loadDeckHistory`,
  `saveDeckHistory`, `onDeckState`.
- Theme: `loadTheme`, `saveTheme`, `onThemeCss`.
- OS clipboard (private format): `writeClipboard`, `readClipboard`.
- Assets: `importAssets`, `importAssetFiles`, `importImageUrl`,
  `onAssetImportProgress`, `probeAsset`, `saveOriginalAsset`, `videoPoster`,
  `pathForFile`, `assetUrl`.
- Import and export: `importKeynote`, `importPowerPoint`, `exportBundle`,
  `exportPdf`, `exportHtml`, `pdfReady`, `onOperationProgress`.
- Agent: `publishAgentContext`, `respondAgentRequest`,
  `getAgentPanelState`, `onAgentRequest`, `onAgentPanelState`.
- Collaboration and agent sessions: `startCollab`, `startAgentSession`,
  `endAgentSession`, `onAgentSessionState`.
- Presentation: `listDisplays`, `present`, `sendPresentCommand`,
  `publishPresentState`, `onPresentCommand`, `onPresentState`.
- Trim and raster windows: `openTrim`, `runTrim`, `onTrimTarget`,
  `onTrimProgress`, `onTrimDone`, `openRaster`, `saveRaster`,
  `onRasterTarget`, `onRasterDone`.
- Authored HTML and speaker notes: `onHtmlEdit`, `htmlAdopt`,
  `onSpeakerNotesEdit`, `openSpeakerNotes`.

## Invariants

- Context isolation is on and `nodeIntegration` is off. The `api` surface
  stays small and explicit; renderers reach the main process only through it.
- Every `on*` subscriber returns its unsubscribe function.
- `assetUrl(src)` returns `deck://<deckKey>/` followed by `src` with leading
  slashes removed and each path segment URI-encoded.
- The deck key is read synchronously at preload time because `assetUrl` runs
  during the first render. It falls back to `no-deck` and follows later
  `IPC.deckKey` pushes.
- Fire-and-forget calls use `send` (`pdfReady`, `respondAgentRequest`,
  `sendPresentCommand`, `publishPresentState`); all other requests use
  `invoke`.
- `openTrim`/`onTrimTarget` share `IPC.trimOpen`, and
  `openRaster`/`onRasterTarget` share `IPC.rasterOpen`.
- Long operations take an optional operation id; progress arrives through
  `onOperationProgress` or `onAssetImportProgress`.
- `htmlAdopt` writes only if the file still holds the `expected` content.

## Side Effects

- `ipcRenderer.sendSync(IPC.deckKeyGet)` when the script loads.
- Registers an `ipcRenderer.on(IPC.deckKey)` listener when the script loads.
- `contextBridge.exposeInMainWorld('api', api)`.

## Verification

- Run: `npx vitest run test/rendererCsp.test.ts`
- Run: `npx vitest run --config vitest.serial.config.ts test/collabEditorShellBrowser.test.ts`
  (launches Electron; serial tier)
- Full suite: `npm test`
