# Drift Report: EGM README contracts

This report compares the 27 README contracts written by `egm-bootstrap` on 2026-10-28 with the code. Each bullet names what the README gets wrong or leaves out, with `path:line` evidence from the code.

## src/README.md

- **`netApi.ts` is not purely HTTP.** Theme saves go over the WebSocket the shell injects (`src/renderer/collab/netApi.ts:9-11,16-19`).
- **"Comments … changed only through `updateComments`" is not enforced for inserts.** `insertSlides` and `insertElements` keep whatever `comments` the inserted slide or element carries (`src/shared/agent.ts:309,343`; `src/shared/collabApply.ts:175,216`).
- **`.versions/` is listed as a general deck-folder side effect.** It is written only by `CollabSession` (`src/server/collabSession.ts:93`) and by the CLI's `writeDeckVersion` (`src/cli/agentCli.ts:1629`), not by the desktop app on its own.
- The subfolder dependency claims match the import graph (cli→main; main→cli, server; server→cli, main; shared→preload (type) and renderer (raw CSS) only).

## src/shared/README.md

- **The timeline invariant is wrong.** The README says v1 implements only the `click`/`afterPrev` triggers and `appear`/`play` actions. `applyAction` handles `disappear`, `pause`, `seek`, `addClass` and `removeClass` (`src/shared/timeline.ts:227-246`), and the player handles the `mediaEnd` and `withPrev` triggers (`src/renderer/player/player.ts:561,1203,1214`). The README repeats a stale schema comment (`src/shared/deck.ts:396-398`).
- **"Choosing or installing a theme restyles nothing" is wrong for the Design tab.** Choosing a card there runs `restyleDeck` on every slide (`src/renderer/editor/themePanel.ts:241-251`); `restyleDeck` documents itself as what choosing a theme in the Design tab means (`src/shared/themes.ts:741-748`). Only `chooseDeckTheme` leaves slides alone (`themes.ts:295-304`; called from `src/cli/agentCli.ts:2055`, `src/server/mirrorTheme.ts:93`), and even it rewrites deck defaults and `theme.css`, pinning existing slides.
- **The custom theme id rule is incomplete.** Besides the regex (`deck.ts:469`), `themeIssues` rejects ids that shadow a built-in, ids ending in `-dark`/`-light`, ids the deck already has, and palettes with fewer than two swatches (`themes.ts:456-470`).
- **`line-height` is not "always" a unitless ratio.** A px value with no px `font-size` beside it stays px, and keywords such as `normal` are left alone (`src/shared/lineHeight.ts:16-17,41-45,70-73,82-83`).
- **"Authored slides cannot run JavaScript while presenting" is too broad.** `web` elements run scripts in an `allow-scripts` sandboxed iframe while presenting (`deck.ts:340-357`; `src/shared/webBridge.ts`). The no-script rule belongs to `sanitizeAuthoredHtml` on the compiled page (`src/shared/htmlSafety.ts:8-12,26-71`); network blocking comes from the renderer CSP (`src/renderer/present/index.html:5-6`).
- **More modules need a live DOM than listed.** `htmlSafety.ts` (`DOMParser` at `:17`; `document.createElement` at `:236,380,391,399`), `paragraphs.ts` (`:104,150,230`), `htmlSlides.ts` (`renderAuthoredMath`, `:285-297`), `timeline.ts` (via `countParagraphs`, `:6-7,99`). `clipboardFiles.ts:12` defaults to the Node global `process.platform`.
- **"Comments change only through `updateComments`" is not enforced for inserts.** `insertSlides` and `insertElements` keep whatever `comments` the inserted slide or element carries (`agent.ts:309,343`; `collabApply.ts:175,216`).
- **The integrity check does more than described.** `validateDeckIntegrity` also rejects timeline entries with a missing target or ref, and missing assets or posters when given `assetExists` (`src/shared/agent.ts:447-464`).
- **Schema bullets leave out fields:** `layoutBackgroundInherited` on slides (`deck.ts:445`); the `theme` stylesheet path (`deck.ts:484`); the slide-numbering fields `showSlideNumbers` and `fixedSlideNumbers` (`deck.ts:511-516`).
- **`diffDecks` (`deckDiff.ts`) is not described**, although undo inverses and collab sync are built on it (`src/renderer/editor/store.ts:560`, `src/renderer/collab/collabBridge.ts:226`).
- **`deckHistory.ts` is easy to confuse with the hosted edit log.** `DeckHistoryDocumentSchema` (version 2, at most 200 entries; `deckHistory.ts:25-29`) is the desktop editor's persisted undo History but sits under "Agent and collaboration" with no description.
- **`chat.ts`, `editHistory.ts` and `speakerNotes.ts` "define limits" but none are named:** `CHAT_FILE`, `CHAT_HISTORY_LIMIT` = 500, `CHAT_TEXT_MAX` = 4000, `CHAT_ID_PATTERN` (`chat.ts:16-23`); `HISTORY_FILE`, `HISTORY_ROTATE_BYTES` = 20 MB, `summarizeChange`, `parseEditHistory` (`editHistory.ts:28-32,106,171`); `SPEAKER_NOTES_FILE`, `serializeSpeakerNotes`, `parseSpeakerNotes`, `applySpeakerNotes`.
- **Coverage gap, exports not mentioned:** `slideNumbers`, `MIRRORED_TEXT_STYLE_PROPERTIES`, `NEW_MEDIA_FIT` (`deck.ts`); `authoredScene`, `ComputedSlideSceneSchema`, `ComputedElementSceneSchema`, `AgentContextDraft`, `SlidePropertiesPatchValue` (`agent.ts`); `canonicalFieldPath`, `renameRetiredDataAttributes` (`fieldAliases.ts` — the HTML half of the retired-field invariant); `renderAuthoredMath`, `htmlSlideScope`, `htmlChangeLabel`, `HTML_CHANGE_LABEL_META`, `adoptAuthoredIds`, `stampPage`, `pageBases`, `slideBase`, `carrySlideState`, `htmlSyncSummary`, `htmlSyncHistoryLabel` (`htmlSlides.ts`); `measureTextOverflowsSource`, `withBase`, `AuthoringPage` (`htmlMeasure.ts`); `chooseDeckTheme`, `themeIssues`, `deckTheme`, `deckThemes`, `themeVariant`, `adoptThemeStyles`, `installThemeStyle`, `THEME_BLOCK_START`, `THEME_BLOCK_END` (`themes.ts`); `threadEdits`, `keepComments`, `keepSlideComments`, `contentOf`, `findComment`, `openThreadCount` (`comments.ts`); `deckOutline`, `deckStyleDigest`, `slideTitle`, `htmlToText` (`deckDigest.ts`); `PresenceStateSchema`, `PARTICIPANT_ID_PATTERN`, `RemoteCommandSchema`, `RemoteStateSchema`, `COLLAB_CLOSE` codes 4404 and 4301 (`collab.ts:335-340`); `injectWebBridgeRuntime`, `WEB_BRIDGE_RUNTIME`, `isEmbeddableWebSrc` (`webBridge.ts`); `KATEX_JS`, `KATEX_AUTO_RENDER_JS`, `KATEX_CSS`; `PLAYER_TYPE_CSS`; `ClipboardPayloadSchema`, `parseClipboardPayload`, `remapElementIds` (`clipboard.ts`); `clipboardFilePaths`; `classifyMediaName`, `IMAGE_EXTS`, `VIDEO_EXTS` (`media.ts`); `cropWindow`, `setCircularMask` (`mediaMask.ts`).
- **Files with no symbols named:** `shapeSvg.ts`, `shapeShadow.ts`, `shapeText.ts`, `polygonShape.ts`, `brace.ts`, `paragraphs.ts` (`countParagraphs`), `nativeCss.ts`, `fontSets.ts` (`FONT_SETS`), `geometry.ts` (`makeId`), `jsonData.ts` (`jsonEqual`), `editorView.ts`, `presentationRange.ts` (`rangeForSlideSelection`), `pdfExport.ts` (`pdfSteps`, `pdfPageCount`), `clipboardImages.ts`.

## src/types/README.md

- **`AutoRenderOptions` is exported, not "module-local".** Declarations inside an ambient `declare module` block are exported implicitly (`src/types/katex-auto-render.d.ts:2`); `import type { AutoRenderOptions } from 'katex/contrib/auto-render'` compiles.
- **"Passing any other auto-render option fails type-checking" holds on only one call path.** `src/renderer/editor/htmlCompile.ts:87` casts the function to `(el: Element, opts: unknown) => void`, and `renderAuthoredMath` takes `opts: unknown` (`src/shared/htmlSlides.ts:285-288`). Only the direct call in `src/renderer/player/render.ts:736` is checked.

## src/renderer/editor/README.md

- **`paste` (store.ts) does not exist.** The paste exports are `pasteFromClipboard` (`src/renderer/editor/store.ts:1364`), `pasteStashedClipboard` (`store.ts:1381`), `pasteInAppClipboard` (`store.ts:1519`) and `pasteMediaFilesFromClipboard` (`store.ts:1533`).
- **`VITE_RENDER_INVARIANTS=1` does not enable both checks.** It turns on only the render check. The selection check is on in DEV builds only: `setSelectionInvariantChecks(import.meta.env.DEV)` (`src/renderer/editor/main.ts:131`, `src/renderer/collab/main.ts:240`).
- **`onLocalEdit` also fires when no undo unit is created.** `finishCommit` skips `pushUndo` for `transient` and `history: false` commits (`store.ts:488-490`) but still calls `onLocalEdit` whenever no transaction is open (`store.ts:505-511`). Only `measurement` commits (`store.ts:479-483`) and commits inside a transaction are silent. The doc comment at `store.ts:96-99` makes the same wrong claim.
- **"The current slide is always in `slideSelection`" is not enforced.** `toggleSlideSelection` (`store.ts:704-709`) can remove a selected non-current slide and then make it current. `clampCursor` (`store.ts:903-906`) re-adds the current slide only when the set is empty. Only the DEV checker asserts it (`selectionInvariants.ts:190-193`). The "toggling off the last slide does nothing" half is correct (`store.ts:699`).
- **`keepView` is misdescribed.** `load(..., { keepView })` keeps the clamped slide index, not the slide (`store.ts:238-240`), so slides inserted ahead move the view. Only the collab client uses it, on welcome (`collab/main.ts:454`, `collab/mobile.ts:479`). The Electron external reload goes through `replaceExternal` (`main.ts:1329`), which restores the cursor by slide id (`store.ts:259-272,431-438`).
- **History entries do not carry inverse operations.** Only undo items have `forward` and `inverse` (`store.ts:84-88,555-561`). Persisted history rows store only forward `operations` from the preceding entry (`store.ts:78-81,955-965`).
- **No `sessionStorage`.** Storage is `localStorage` only: `canvas.ts:1937/1941`, `panelResize.ts:167/175`, `comments.ts:65/88`, `spellcheck.ts:137/140`, `webExportDialog.ts:94/117`.
- **`ui.ts` is overstated as "shared controls".** `button`, `openMenu` and `showToast` (`ui.ts:7,85,180`) have no callers in `src/`. The only importer is `colorPicker.ts:1` (`openAnchoredPopover`, `closePopover`). The toolbar helpers the shells use are `barButton` and `barIconButton` (`shellWiring.ts:608,617`), not mentioned.
- **`duplicateSelection` is attributed only to `EditorStore`** (`store.ts:811`); `shellWiring.ts:240` also exports a standalone `duplicateSelection(store)`.
- **IPC list is incomplete.** Missing calls: `openTrim`, `openRaster`, `loadTheme`, `saveTheme`, `htmlAdopt`, `endAgentSession`, `saveOriginalAsset`, `probeAsset`, `pathForFile`. Missing listeners: `onTrimDone`, `onRasterDone`, `onThemeCss`, `onSpeakerNotesEdit`, `onAssetImportProgress`, `onAgentSessionState`.
- **Coverage gap, store.ts:** exports `pasteStashedClipboard`, `pasteInAppClipboard`, `pasteMediaFilesFromClipboard`, `deckFrom`, `reshareDeck`, `sameDeckDrawing`, `sameSlideDrawing`, `clipboardImageName`, `inAppClipboardToken`, `isInAppClipboardToken`, `stashedClipboardId`; `EditorStore` methods `replaceWithHistory`, `subscribeHistory`, `toggleSlideSelection`, `selectSlideRange`, `selectAllSlides`, `clearSelection`, `markClean`, `canUndo`, `canRedo`.
- **Coverage gap, canvas.ts:** exports `TableSelection`, `wheelZoomFactor`, `zoomShortcut`, `textPaintBox`, `rectContainsPoint`, `hasEndpoints`, `isHoverMove`; callbacks `onTrimRequest`, `onWebLiveChange`, `onTextFormatStateChange`, `onPointerSample`, `onTableBorderPaintModeChange`.
- **Coverage gap, shellWiring.ts:** `ClipboardActions`, `hasNativeCopySelection`, `barButton`, `barIconButton`, `TEXT_ICON`.
- **Coverage gap, modules the collab client imports but the README never names:** `SpeakerNotesDrawer`, `CssEditor`, `createDeckWerkButton` (`aboutDialog.ts`), `createToolbarPicker` / `createToolbarSplitButton` (`exportPicker.ts`), `installResponsiveToolbar`, `describeElement` (`elementLabel.ts`).
- **Coverage gap, comments.ts:** `openComments`, `mountComments`, `closeCommentsPopover`, `setCommentAuthor`, `setCommentLinks`, `newComment`, comment-highlight toggles.
- **Coverage gap, controls:** `colorField`, `parseCssColor`, `colorForInput`, `COLOR_LIVE_START`, `COLOR_LIVE_END` (`colorPicker.ts`); `pickScreenColor`, `eyedropperAvailable` (`eyedropper.ts`); `angleDial`, `durationField`; `fontFamilyField`, `installedFontFamilies` (`fontPicker.ts`).
- **Coverage gap, editing helpers:** `createShapeInsertPicker`, `createTableInsertPicker` (`elementCreation.ts`); `linkifySelection`, `typedLinkAtCaret`, `applyTypedLink` (`linkEditing.ts`); `KeptSelectionHighlight`, `KEPT_SELECTION_HIGHLIGHT`, `TEXT_EDIT_PANEL_CHROME` (`keptSelection.ts`); `openContextMenu`; `mediaNaturalSize`.
- **Coverage gap, misc:** `probeLocalFile`, `probeRemoteImage`, `setPending*`, `applyPendingHud` (`pendingUploads.ts`); `statusBarText`; `WelcomeScreen`; `previewSlide`, `masterTile`, `FIXED_LAYOUTS` (`layoutPreview.ts`); `createThemePreviewCard`; `LAYOUT_LABELS`; `createExportSlideScope`, `ExportScopeSource` (`pdfExportDialog.ts`).
- **Coverage gap, dev checkers:** `assertNoRenderDivergence`, `formatDivergence`, `renderInvariantChecksEnabled` (`renderInvariants.ts`); `setSelectionInvariantChecks`, `selectionInvariantChecksEnabled` (`selectionInvariants.ts`).

## src/renderer/README.md

- **`lightTheme.css` description omits two light-only overrides:** `button.primary:hover` (`src/renderer/lightTheme.css:24`) and a soft scrim on the modal backdrop (`lightTheme.css:28`). The scrim applies only to `.workflow-overlay`, not `.app-dialog-backdrop`, so the two classes the README pairs as aliases (`appChrome.css:120-121`) look different in light mode.
- **`appChrome.css` coverage gap.** The alias classes `button.ui-button-primary` and `button.ui-button-danger` (`appChrome.css:58-83`), which `ui.ts`'s `button()` emits (`editor/ui.ts:14`), are not mentioned.

## src/main/README.md

- **The `deck://` protocol does not use `net.fetch`.** The handler streams the file with `createReadStream` and returns a `206` or `200` `Response` (`src/main/assetProtocol.ts:132-145`). `net` is never imported in `src/main`. The file's own doc comment (`assetProtocol.ts:13`) makes the same stale claim.
- **No collab host window is created, and it would have no preload.** `createCollabHostWindow` deliberately has no preload (`src/main/windows.ts:171-174,184-193`) and is never called: `index.ts` does not import it (`src/main/index.ts:96-106`), and `index.ts:1466-1468` says the native editor is kept instead.
- **"Copies and writes go to a temp file and are renamed into place" is not enforced.** Direct writes: `saveTheme` (`src/main/deckStore.ts:231`, also used by `src/server/collabSession.ts:144`), `importImageBuffer` (`deckStore.ts:343`), `importWebPage` (`deckStore.ts:470`, also used by `src/server/collabServer.ts:2290,2618`), the default theme in `createDeck` (`deckStore.ts:197`), `writeHtmlScope` (`src/main/htmlAuthoring.ts:40`). `copyDeck` uses `fs.promises.cp` (`deckStore.ts:214`).
- **"Never use `fs.copyFile` on the server path" is violated.** The server's `keepUpload` calls `copyFile` from `node:fs/promises` (`src/server/collabServer.ts:7,857`).
- **`.versions/*.json.gz` is overstated as a main-process write.** `DeckVersionRecorder` is used only by `src/server/collabSession.ts`, and `writeDeckVersion` by the CLI (`src/cli/agentCli.ts:1629`). Main writes versions only by hosting the collab server, which also writes `history.jsonl` (not listed).
- **Missing side effects:** `shell.openPath` on `notes.md` for `speakerNotesOpen` (`src/main/index.ts:803`) and on the exported page for `htmlExport` (`index.ts:812`); reading a deck folder from `process.argv` (`index.ts:563-570`).
- **Watchers under-described.** The deck-folder watch also covers `notes.md` and forwards it as `speakerNotesEdit` (`src/main/index.ts:483-509`); a separate theme-file watch exists only when the theme sits in a subfolder (`index.ts:511`).
- **IPC channels handled in `index.ts` but missing from the list:** `deckGet` (`:684`), `deckOpenPath` (`:718`), `deckSyncSnapshot` (`:737`), `deckHistorySave` (`:697`), `assetImport` (`:842`), `assetImportUrl` (`:1003`), `keynoteImport` (`:1214`), `pptxImport` (`:1220`), `agentSessionStart` (`:1459`), `rasterSave` (`:1505`).
- **Four files have no symbols listed:** `exportThumbnail.ts` (`writeExportThumbnail`, imported at `index.ts:69`); `dialogs.ts` (`showOpenDialog`, `showSaveDialog`, `src/main/dialogs.ts:41,47`); `presentationDisplays.ts` (`chooseAudienceDisplay`, `chooseDisplayById`, `shouldOpenSpeakerView`, `shouldShowAudienceWindow`, `swappedPresentationDisplays`); `windowHandoff.ts` (`handoffWhenReady`, referenced only by `test/windowHandoff.test.ts`, by no `src` code).
- **Omitted exports that `index.ts` uses:** `saveSpeakerNotes`, `loadTheme`, `saveTheme`, `deckFolderPath` (`deckStore.ts`; `index.ts:51-66`); `readSettledFile`, `isAuthoringFileName` (`htmlAuthoring.ts`; `index.ts:80`); `defaultLauncherPath` (`agentGuide.ts`; `index.ts:81`); `attachWindow`, `editorStates`, `forgetEditorWindow`, `isEmptyEditor`, `windowsOf` (`deckWindows.ts`; `index.ts:83-95`); `cascadedEditorBounds`, `showSpeakerWindowAboveFullscreen` (`windows.ts`; `index.ts:96-106`).
- **Other omitted exports:** `agentRuntimeDir`, `agentRuntimePaths`, `readAgentContextFile` (`src/main/agentRuntime.ts:37,43,171`); `readDeckVersion`, `writeDeckVersion`, `VERSION_INTERVAL_MS`, `KEEP_EVERY_VERSION_MS` (`src/main/deckVersions.ts:31-33,111,123`); `LEGACY_DECK_HISTORY_FILE` (`src/main/deckHistoryStore.ts:21`); `assetChecker` (`src/main/agentDeck.ts:34`); `createStderrReader` (`src/main/keynoteImport.ts:128`); `posterCacheDir` (`src/main/posterCache.ts:35`); `getFfprobePath`, `videoCodec`, `isWebSafeCodec`, `probeImage`, `convertImageToPng`, `encodeRgbaToPng`, `run` (`src/main/ffmpeg.ts`).

## src/preload/README.md

- **`netApi.ts` wording.** The README says it "implements over HTTP" the part of the `Api` type the shared components call. Theme saves go over the WebSocket the shell injects, not HTTP (`src/renderer/collab/netApi.ts:9-11`; `NetApiOptions.saveTheme` at `:16-19`).
- Every other claim checks out: every `api` method in `src/preload/index.ts:63-234` is listed, all channel names exist in `src/shared/ipc.ts:11-71`, and the `send`/`invoke` split and shared trim/raster channels match.

## src/cli/README.md

- **`inspect --dom` is mapped to "computed scenes".** `--dom` returns the live rendered DOM and needs the editor running (`src/cli/agentCli.ts:586-606`). Computed scenes come from bare `inspect` with no mode flag (`agentCli.ts:613`).
- **"Every command works with or without the editor running" is false.** `inspect --dom` refuses without the editor (`agentCli.ts:589`). `chat` and `say` need a collab server or a mirror (`src/cli/chatClient.ts:25-39`).
- **Not all offline writes go through the locked path in `agentDeck.ts`.** `history --restore` writes `deck.json` (and `notes.md`) with `saveDeck` (`agentCli.ts:1639`) and the theme with `saveTheme` (`:1635`). `theme choose` and `theme apply` write theme CSS with a plain `writeFile` after their transaction (`agentCli.ts:2067,2176`).
- **More JSON-on-stdout exceptions than listed.** `inspect --html-body` prints an HTML fragment (`agentCli.ts:576`). `connect` prints nothing to stdout, only prose on stderr (`src/cli/agentConnect.ts:1256-1293`).
- **"`--slide` takes a slide id or a 1-based slide number" is false for `history`.** `history --slide` matches raw ids only (`agentCli.ts:1561-1570`).
- **`waitForMention` does not always pin to an existing id.** On an empty chat it uses the sentinel `'start-of-chat'` (`src/cli/chatClient.ts:87,100`).
- **Bridge writes are incomplete.** Missing: `AGENTS.md`, rewritten whenever it differs (`agentConnect.ts:395-398`); the theme CSS (`writeTheme`, `:576`); agent-runtime `context.json`, `responses/*.json`, and inbox and responses folders under `~/.deckwerk/runtime` (`:194,308-309,616,628`). `CLAUDE.md` is written only when absent (`:401-404`).
- **Bridge watches are incomplete.** It also watches the mirror root for `deck.json`, `notes.md` and the theme; `assets/` recursively; and the runtime inbox (`agentConnect.ts:982-1013`).
- **Export comparison is overstated as a CLI side effect.** `compareExportToPlayer` has no `slide-agent` command; only `test/exportLooksLikeSlide.test.ts` calls it.
- **Undocumented flags:** `docs` topics `authoring|web|themes|internals` (`agentCli.ts:298-305`); `inspect --selected|--slide|--all` (`:537`); `render --output --annotate --built --contact-sheet` (`:641`); `preview --port --open` (`:690-691`); `validate --slide|--selected`; `web import --after --title --no-poster`; `web add --size`; `web check --screenshot --size --replace --deck` (USAGE `:131-152`); `theme apply --scope --slide --roles --properties --keep-overrides --detect-roles` (USAGE `:170-174`); `comments --author` (`:1218-1220`); `chat --server --deck-id`, `say --server --deck-id --slide` (`:1302-1303,1322-1323`); `history --slide --limit --full` (`:1546-1547`).
- **Omitted exported types:** `SessionTarget`, `BridgeIo`, `ConnectOptions`, `ConnectCommandOptions` (`agentConnect.ts:80,119,125,1245`); `ChatTarget`, `ChatListing` (`chatClient.ts:13,67`); `RenderRequest`, `RenderResult`, `WebPageCheck` (`renderSlides.ts:22,48,177`); `CompileRequest`, `CompiledHtml` (`compileHtml.ts:33,39`).

## src/server/README.md

- **Removed agent routes are listed as live.** `/api/brief`, `/api/edit-schema`, `/api/preview-edits`, `/api/apply-edits`, `/api/preview-html` and `/api/apply-html` return 410 ("The direct Agent HTTP API was removed…") at `src/server/collabServer.ts:1589-1594`, before their old handlers (`:2974,3011,3146,3298,3416`), which are unreachable. "Native draft previews" are dead for the same reason: `nativeDrafts.set` and `options.onNativeDraft` are called only inside the unreachable `/api/preview-edits` handler (`:3061,3076`). HTML drafts now come only through `/api/agent-mirror/sync-html` (`:2689`).
- **Two routes are in the wrong group.** `/api/end` is not an agent route: it ends a hosted session, from loopback only (`collabServer.ts:2415-2427`). `/api/theme` is the general theme-CSS GET used by the browser client and print page (`:3547`; `src/renderer/collab/netApi.ts:203`, `print.ts:70`).
- **Theme saves are not debounced.** Only `deck.json` waits on `SAVE_DEBOUNCE_MS = 800` (`src/server/collabSession.ts:14,218-225`). `saveThemeCss` writes immediately through `saveTheme` (`collabSession.ts:140-148`), a plain `writeFile` (`src/main/deckStore.ts:226-232`).
- **Decks are not limited to immediate subfolders.** Deck ids are folder paths (`clients/acme/talk`) and decks can sit inside folders: `deckDirOf` (`collabServer.ts:473-488`), recursive listing (`:664-669`), `MAX_FOLDER_DEPTH = 8` (`:541`), `MAX_PATH_SEGMENTS = 8` (`:4504`). Dot-named segments are never decks (`:4519-4521`). The README copied a stale doc comment on `rootDir` (`:279-282`).
- **Two sidecars are still taken from uploaded archives.** `deckArchiveEntries` drops only `access.json`, `folder.json` and the history files (`collabServer.ts:4791`); an `agent-chats.json` or `chat.jsonl` inside an uploaded zip is written into the new deck. `SERVER_SIDECARS` (`:195`) is applied only to the mirror (`:4689,4750`).
- **Access-control rule is incomplete.** A loopback request with `X-Forwarded-For` but no `Tailscale-User-Login` is rejected, not treated as the admin; this covers tagged nodes and `tailscale funnel` traffic (`src/server/accessControl.ts:107-112`).
- **"Nothing it sends is applied" overstates the view-only rule.** For a view-only peer only `txn` and `theme` are refused (`collabServer.ts:3755-3758`) and `chat-post` dropped (`:3798`). Presence, cursor and `remote-*` messages are still applied and relayed (`:3780-3792,3814-3851`). Changing `/api/access` closes demoted or revoked sockets with 4003 (`:1738-1744`).
- **Missing side effects:** `users.json` in `rootDir` (`collabServer.ts:418`; `accessControl.ts:279-347`); `<rootDir>/.uploads/` when `keepUploadsDays` is set (`collabServer.ts:337-341,847-850`); `notes.md` rewritten on every deck save (`collabSession.ts:239`); the rendition cache is `$XDG_CACHE_HOME/deckwerk/renditions` (fallback `~/.cache/…`) and files older than 90 days are pruned at startup (`src/server/streamingRenditions.ts:74-103`; `collabServer.ts:405-409`).
- **`CollabServerOptions` fields hidden behind "...":** `onNativeDraft`, `localAgents`, `keynoteImporter`, `pptxImporter`, `accessControl`, `onSessionEnd`, `mediaRenditions`, `keepUploadsDays` (`collabServer.ts:302-341`). Defaults: host `0.0.0.0` (`:356`), port `5800` (`:3870-3874`). `RunningCollabServer {urls, port, flush, notifyEnded, close}` (`:344-352`) is not mentioned.
- **Routes left out:** `/decks/<id>/assets/<path>` with `?v=` pins, `?download=original` and a 307 redirect for renamed decks (`collabServer.ts:1443-1540`); `GET`/`PUT /api/clipboard/<id>` (`:2235-2264`); `/api/render-slide.png` (`:3499`); `/api/html-drafts/<id>/{source,imported,compare}` and `…/(contact-sheet|slide-N).png` (`:3357-3379`); `/api/edit-drafts/<id>/{before,after,compare}` (`:3109,3131`); `/api/agent-mirror/export.html` and `/api/agent-mirror/new.html` (`:2466,2481`); `DELETE /api/folders` (`:1979`); the static client-bundle fallback (`:3555-3567`).
- **What `BRIDGE_HEADER` does is not stated.** Every `/api/agent-mirror/*` request without `x-deckwerk-bridge: 1` gets a 404 (`collabServer.ts:1381-1383`).
- **WebSocket close codes are not documented:** 4000 missing `deck` parameter (`collabServer.ts:3589`); 4003 no access, revoked or demoted, or participant belongs to someone else (`:3609,1741-1743,3714,3723`); 4004 room failed to open (`:3642`); `COLLAB_CLOSE.moved` (4301) and `COLLAB_CLOSE.noSuchDeck` (4404) (`:3632-3634,760,787`); 1011 relocation failed (`:771`); 1001 shutdown (`:3900`).
- **Exports left out:** `HtmlDraftPreview`, `NativeDraftPreview`, `RunningCollabServer`, `withMediaExtension`, `htmlDraftComparisonDocument`, `scratchpadDocument`, `importerProblems`, `mediaToolProblems`, `MirrorFileEntry`, `defaultClientDir` (`collabServer.ts`); `AccessControlConfig`, `DeckShare`, `KnownUser` (`accessControl.ts`); `RenditionOptions`, `RenditionEvent`; `StashedCopy`, `ClipboardStashOptions`; `HtmlReplacementPlan`; `ZipFile`, `ZipEntry`.

## src/renderer/collab/README.md

- **Not every video URL names its media variant.** `print.ts` builds asset URLs without `pinMediaVariant` (`src/renderer/collab/print.ts:38-39`) and hands them to `renderSlide`, which creates the PDF pages' `<video>` elements (`src/renderer/print/pages.ts:66`).
- **Some presenter commands do travel over the collab WebSocket.** Remote-clicker commands are sent as `remote-command` over the WebSocket (`remoteControl.ts:413`), relayed by the server (`src/server/collabServer.ts:3836-3841`), and obeyed by `PresenterRemotes`. The bus rule holds only for the Speaker View and audience pair.
- **HTTP side effects are incomplete.** `main.ts` also calls `/api/config` (`main.ts:160`), `/api/export/web` (`:743,753`), `POST /api/decks/rename` (`:786-788`), `/api/download` (`:911`) and `POST /api/end` (`:1018`). `print.ts` fetches `/api/theme` (`print.ts:70`). `mobile.ts` also opens the agent-panel `EventSource` (`mobile.ts:28`; `agentPanelApi.ts:26`). Also unlisted: `window.open('./print.html')` for PDF export (`main.ts:699`) and the iframe-to-parent `message` channel (`presentOverlay.ts:149`).
- **localStorage list misses** `deckwerk.agent-panel-participant-id` (`agentPanelApi.ts:44-49`).
- **`shadow` is also replaced by `deck` messages.** A `deck` message (resync, external edit, agent edit) replaces `shadow` wholesale and drops pending edits without calling `onEditsDiscarded`; except for `agent-edit` it also clears undo and redo (`collabBridge.ts:385-395`). The README describes this reset only for `welcome`.
- **The stop-reconnecting rule misses one case.** A server `ended` message also stops reconnecting for good (`collabBridge.ts:442-446`).
- **Key symbols are imprecise.** "Transaction sending" is the arrow property `localEdit(prev, next, label, coalesceKey?)`, wired to `store.onLocalEdit` (`collabBridge.ts:220`; `main.ts:533`, `mobile.ts:539`). `redo` takes `currentDeck` like `undo` (`collabBridge.ts:255`). Comment ops never go on the undo stack (`collabBridge.ts:223-226`).
- **Exports left out:** `presentationChannelName` (`presentationBus.ts:52`); types `NetApiOptions`, `ChatParticipant`, `ChatPanelOptions`, `PickerAccess`, `ImportSource`, `AgentPanelBrowserApi`, `AgentPromptOptions`, `PresenterRemotesOptions`, `RemoteReceiverOptions`, `ConnectionNotice`, `ConnectionNoticeOptions`, `DeckNameField`, `DeckNameFieldOptions`, `PlayerPaintReadinessOptions`.
- **Verification leaves out existing focused suites:** `test/presenceBar.test.ts`, `test/playerReadiness.test.ts`, `test/connectionNotice.test.ts`, `test/deckNameField.test.ts`, `test/endCollaborationPopover.test.ts`, `test/agentPrompt.test.ts`, `test/presentOverlay.test.ts`, `test/collabRemote.test.ts`.

## src/renderer/player/README.md

- **(b/c) The decoded-video pool is not global.** Side Effects says "the pool is global (`decodedVideoPool.ts`)", and the Files table calls it a "Global bounded LRU". In the code `DecodedVideoPool` is a class with a total cap and a per-key cap of 8 (`src/renderer/player/decodedVideoPool.ts:7-14`). Each owner makes its own instance: the Player uses `new DecodedVideoPool(24)` (`src/renderer/player/player.ts:154`) and the editor canvas uses `new DecodedVideoPool(16)` (`src/renderer/editor/canvas.ts:871`). There is no module-level pool.
- **(b) `matchMorphElements` does less than described.** The README says it "pairs elements across slides for Morph". It only returns `explicitMorphPairs` (`morphId` pairs) and is commented "Backwards-compatible export for tests and callers; runtime matching is explicit only" (`src/renderer/player/player.ts:1783-1789`). The Player's actual Morph pairing also adds `unchangedMorphPairs`, `essentialMorphPairs` and `restyledMorphPairs` (`src/renderer/player/player.ts:883-915`).
- **(b) `deferVideoSrc` has a second condition.** The README says it "only applies with `mediaPreload: 'metadata'`". It also needs a registered poster provider: `preload === 'metadata' && opts.deferVideoSrc === true && previewPosterProvider() !== null` (`src/renderer/player/render.ts:1198`). Without a provider the source is assigned straight away.
- **(c) `previewFrameRecovery.ts` listens for more than `visibilitychange`.** The code also listens for `pageshow` and window `focus` (`src/renderer/player/previewFrameRecovery.ts:93-95`).
- **(c/d) The Player's own page listeners are not listed.** The Player adds a `document` `visibilitychange` listener and a window `message` listener (`src/renderer/player/player.ts:212,215`). The `message` listener is the web-element bridge: frames can call `next`/`prev` and forward keys (`src/renderer/player/player.ts:245-259`), and the Player posts deck events into `iframe.web-frame`.
- **(c/d) "Keyboard listeners (`keys.ts` …)" leaves out `laserPointer.ts`.** `createLaserPointer` adds a `<style>` to `document.head`, a window `keydown` handler that toggles the laser on `L`, window `blur`/`pagehide` listeners and a `ResizeObserver` (`src/renderer/player/laserPointer.ts:48-54,127-148`).
- **(d) `trackVideoLoading` side effects are missing.** It sets up a `MutationObserver` on the root, a 500 ms poll `setInterval`, and a pill appended to `document.body` (`src/renderer/player/videoLoadingProgress.ts:72,97-99,186`).
- **(d) The presenting key map is not documented**, though `keys.ts` is presented as "the presenting key map": Right/Down/Space/PageDown/Enter go next; Left/Up/PageUp/Backspace go back; Home goes to the first slide; `b`/`B` blanks; Escape calls `onExit`; `o`/`O` calls `onOverview`; focused fields and contentEditable targets are ignored (`src/renderer/player/keys.ts:21-67`).
- **(d) Constants and limits are missing:** the gate's 10 s orphan grace (`src/renderer/player/mediaLoadGate.ts:32`); `decodeVideoFrame`'s 20 s default timeout (`src/renderer/player/decodedVideoPool.ts:98`); the pool's per-key cap of 8 (`src/renderer/player/decodedVideoPool.ts:13`); the Player's lookahead limits — 4 video warm elements, a 20 s warm timeout, a 2 s lookahead hold, image warming capped at 48 MP or 4 images (`src/renderer/player/player.ts:72-82`).
- **(d) Some exports are not listed:** `mediaRadius` and the re-exports `quadraticPath` and `fitAutoTextElement` (`src/renderer/player/render.ts:61-62,478`); the `previewPosterProvider()` getter (`src/renderer/player/previewPosterProvider.ts:21`); the types `KeyHandlers`, `LaserPointer`, `LaserContext`, `VideoBlobCacheOptions`, `VideoLoadingTracker`, `PreviewFrameRecovery`; the test hooks `resetMediaLoadGateForTests` (`src/renderer/player/mediaLoadGate.ts:98`) and `resetPreviewPostersForTests` (`src/renderer/player/previewPoster.ts:285`).

## src/renderer/export/README.md

No drift detected.

## src/renderer/present/README.md

- **(b) The CSP description is incomplete.** The README says the CSP "allows only `'self'`, `deck:` and `data:`". `style-src` also allows `'unsafe-inline'`, `frame-src` is `deck:`, and `data:` is allowed only for fonts and images (`src/renderer/present/index.html:6`).
- **(b) The cursor is not hidden everywhere.** `.element-text { cursor: text; }` brings it back over text elements (`src/renderer/present/index.html:11`).
- **(b) The range rule for URL parameters is wrong.** The README says a range exists "when both `slide` and `endSlide` are finite". `slide` defaults to `0` when absent, so `endSlide` alone makes `{start: 0, end}`. A non-numeric `slide` gives no range and starts at slide 0 (`src/renderer/present/main.ts:81-85,115`).
- **(c) One path skips the range check.** The past-the-end close lives only in `advance()` (`src/renderer/present/main.ts:154-161`). A web element's bridge `next` action calls `player.next()` directly (`src/renderer/player/player.ts:253`), so it skips the check.
- **(d) The laser overlay side effects are incomplete.** It also adds a `<style>` to `document.head` and a window `keydown` handler that toggles the laser on `L` (`src/renderer/player/laserPointer.ts:48-54,136-145`).

## src/renderer/presenter/README.md

- **(b) `test/speakerWindow.test.ts` does not test this folder.** It tests `src/main/windows.ts` (`createPresentWindow`, `createPresenterWindow`, `showSpeakerWindowAboveFullscreen`) with a mocked Electron (`test/speakerWindow.test.ts:3-7`).
- **(d) `main.ts` side effects are incomplete.** It also calls `bindSpeakerKeys(window, …)` (`src/renderer/presenter/main.ts:36`) and `window.api.loadTheme()` for `setTheme` (`src/renderer/presenter/main.ts:29`).
- **(d) The `L` shortcut is not mentioned.** When `laser` is on, `L` toggles the laser through `createLaserPointer`'s keydown handler (`src/renderer/presenter/speakerView.ts:137,140-145`; `src/renderer/player/laserPointer.ts:136-145`). `bindSpeakerKeys` also accepts `B` as well as `b` (`src/renderer/presenter/speakerView.ts:260`).

## src/renderer/print/README.md

- **(d) `waitForPdfPage` has two waits the README leaves out.** It also waits on every `<embed>` (load or error, 5 s timeout) and on `whenWebElementReady` for every `.web-body` (`src/renderer/print/readiness.ts:152-157`).
- **(d) Video discovery does not enter shadow roots.** Only image discovery does (`deepImages`). Videos are found with `page.querySelectorAll('video')` (`src/renderer/print/readiness.ts:158`), so a `<video>` inside an HTML element's shadow root is neither pinned nor frozen.

## src/renderer/raster/README.md

- **(b/c) Not every button is disabled during a save.** `renderControls()` disables only Undo, Redo, Reset and Apply (`src/renderer/raster/main.ts:227-230`). Pick color (`#eyedropper`) and Close stay enabled, and their handlers do not check `busy` (`src/renderer/raster/main.ts:146,198`).
- **(b) Reset replaces the redo stack.** The code assigns `redoStrokes = [...strokes].reverse()` (`src/renderer/raster/main.ts:191`), discarding any redo entries already there.
- **(d) Missing details:** the source image loads with `crossOrigin = 'anonymous'`, which `getImageData` and `toBlob` need (`src/renderer/raster/main.ts:33`); without a native EyeDropper the button toggles pick mode on and off (`src/renderer/raster/main.ts:164`).

## src/renderer/trim/README.md

- **(b) The progress listener is registered at module load, not by Apply** (`src/renderer/trim/main.ts:451-454`).
- **(d) Closing after success is not mentioned.** After a successful Apply the window closes itself 700 ms later (`src/renderer/trim/main.ts:443`).
- **(b) The checkbox label and fast-mode behaviour differ.** The label is "Fast trim (stream copy, no re-encode)", the box is checked by default (`src/renderer/trim/index.html:72-73`), and it is disabled whenever a crop is active (`src/renderer/trim/main.ts:518-520`).
- **(d) Crop limits are missing.** `clampCrop` enforces a 16 px minimum and keeps the box inside the frame (`src/renderer/trim/main.ts:345-352,410-417`). A crop within 1 px of the full frame counts as full frame (`src/renderer/trim/main.ts:320-325`). The ffmpeg preview and size badge round output dimensions down to even numbers (`src/renderer/trim/main.ts:511-513,546-548`).
- **(d) Some UI and listeners are missing.** Set in, Set out, Reset and Full frame buttons (`src/renderer/trim/index.html:34-36,67`); window `resize` and video `play`/`pause` listeners (`src/renderer/trim/main.ts:563-566`).

## scripts/README.md

- **`collab-server.mts` flags take values.** `--host <addr>` defaults to `0.0.0.0`; `--agent-name` also takes a value (`scripts/collab-server.mts:43,50,52`). The README writes `[--host]` as a boolean.
- **More scripts exit 2 on usage errors** than the invariant lists: `collab-server.mts` (`scripts/collab-server.mts:57-64`) and `prepare-media.mts` (`scripts/prepare-media.mts:40-44`).
- **Undocumented startup refusal.** `collab-server.mts` exits 1 when `importerProblems()`, `mediaToolProblems()` or `headlessBrowserProblem()` report anything (`scripts/collab-server.mts:76-88`). That check imports `example-keynote-decks/empty_deck.key` and `test/fixtures/pptx/reference.pptx` and needs `ffmpeg`/`ffprobe` on PATH (`src/server/collabServer.ts:4611-4614,4636-4652`).
- **`check-collab-environment.cjs` also refuses every Node major other than 22, 24 and 26** (`scripts/check-collab-environment.cjs:25-28`).
- **"Python 3.10+ is needed only at build time" is wrong for a checkout.** `postinstall`/`precollab` exit 1 without Python (`scripts/setup-importers.mjs:31-41`; `scripts/importer-python.mjs:126-127`), and the dev app and collab server run the importers from source through `.venv-import` (`src/main/keynoteImport.ts:32-38`; `src/server/collabServer.ts:4568-4570`).
- **`render-html-draft.cjs` does more than "one `.slide`".** With `slideIndex` null it renders a contact sheet of all slides and writes `contact-sheet.html` beside the page (`scripts/render-html-draft.cjs:31-60`).
- **`capture-slides.cjs` also writes `contact-sheet.png` and `contact-sheet.html`** (`job.contactSheet`) and supports `job.built` (`scripts/capture-slides.cjs:38,52-56,115-116`). `export-deck` also launches it through `writeExportThumbnail` → `renderSlidesToPng` (`src/main/exportThumbnail.ts:5,33`).
- **Other launchers not listed:** `compare-slides.cjs` by `eval-importer-regressions.mts` (`scripts/eval-importer-regressions.mts:147`); `check-web-page.cjs` by `slide-agent web add` and `web replace` (`src/cli/agentCli.ts:1028-1030,1098-1100`).
- **`SKIP_ELECTRON_CHECK=1` does not "run only the unit tier".** It only skips the Electron-binary check; `npm test` still runs every tier (`scripts/check-test-environment.cjs:11`; `scripts/run-test-tiers.cjs:15-24`).
- **Side effects incomplete:** `build-importer.mjs` exits 1 without Python and also writes `build/pyinstaller/` (`scripts/build-importer.mjs:29-37,73-74`); `export-deck.mts` spawns ffmpeg and Electron; `prepare-media.mts` spawns ffmpeg via `RenditionStore`, reads `DECKWERK_RENDITION_JOBS` (default 2), and caches in `${XDG_CACHE_HOME:-~/.cache}/deckwerk/renditions` (`scripts/prepare-media.mts:46`; `src/server/streamingRenditions.ts:100-102`).

## importers/README.md

- **The collab server prefers a built binary.** It runs `build/importers/<binary>` first whenever one exists (`src/server/collabServer.ts:4558-4571`). The desktop app also tries `<resourcesPath>/importers/` and `<out/main>/../../importers/` before the script (`src/main/keynoteImport.ts:21-27`; `src/main/pptxImport.ts:22-28`).
- **The collab server never validates importer output with `parseDeck`.** `runImporter` keeps only `payload.report` (`src/server/collabServer.ts:4588-4596`), and the upload route returns 200 on that alone (`:2154-2157`).
- **Wrong callers named for validation.** `importKeynote`/`importPowerPoint` call `parseDeck`, not `runImporterSidecar` (`src/main/keynoteImport.ts:77-81`); `importPowerPoint` in `src/main/pptxImport.ts:43-79` is omitted.
- **Exit code 1 vs 2 is not exact.** The Keynote importer exits 2 at module load when `keynote-parser` is missing, `--self-check` included (`importers/keynote/import_keynote.py:52-57`); a missing input file also exits 2 (`import_keynote.py:3895-3897`; `import_pptx.py:3197-3199`).
- **A failed slide is not a placeholder.** It becomes an empty `Slide N (failed to import)` with no elements; only shapes become `unsupported` placeholders (`import_keynote.py:3811-3822`; `import_pptx.py:3122-3131`).

## importers/keynote/README.md

- **The collab server prefers `build/importers/keynote-import`** when it exists (`src/server/collabServer.ts:4562-4570`); the desktop app checks packaged-binary paths first (`src/main/keynoteImport.ts:21-27`).
- **The original video is always deleted after a successful transcode**, not only when a `.h264.mp4` already exists (`import_keynote.py:1869-1871`).
- **`_classify_text_roles` falls back** to the size of the deck's largest prose when no placeholder body text exists (`import_keynote.py:3477-3500`).
- **Verification omits the `KEYNOTE_PACKAGED=1`-gated case** that tests the frozen binary (`test/keynoteImport.test.ts:150`).

## importers/pptx/README.md

- **The collab server prefers `build/importers/pptx-import`** when it exists (`src/server/collabServer.ts:4562-4570`); the desktop app checks packaged-binary paths first (`src/main/pptxImport.ts:22-28`).
- **`parseDeck` validation holds only for the desktop `importPowerPoint`.** The collab server's upload path does not validate (`src/server/collabServer.ts:4594-4596`).
- **Verification omits the `embedded.pptx` (`make_embedded.py`) OLE-era cases** in the same suite (`test/pptxImport.test.ts:226`).

## packaging/README.md

- **`disable-library-validation` also covers the frozen PowerPoint importer** (`pptx-import`), shipped in the same `extraResources` folder (`scripts/build-importer.mjs:57-63`; `electron-builder.config.cjs:50`). The table names only the Keynote importer.

## packaging/linux/README.md

- **Not every denied group is spelled out call by call.** Only `@privileged` and `@mount` are expanded (minus `chroot`/`capset`); `@resources`, `@debug`, `@cpu-emulation`, `@obsolete`, `@swap`, `@chown`, `@clock`, `@module`, `@raw-io` and `@reboot` stay as group names (`packaging/linux/deckwerk-collab-chromium-sandbox.conf:23`).

## dev/README.md

No drift detected.

## dev/bench/README.md

- **`VITE_RENDER_INVARIANTS=1` is set only on a cache miss**, when `produce()` runs; on a cache hit it is never set (`test/support/collabClient.ts:19-29,41-43,67`).

## dev/harness/README.md

No drift detected.

## README.md (Repository Blueprint section)

- **macOS builds are always signed.** Without credentials the mac app is still ad-hoc signed by the `afterPack` hook (`electron-builder.config.cjs:54,88`; `scripts/adhoc-sign-mac.cjs:23-31`). "Signs only when the Apple or Azure credentials are set" is wrong for macOS.
- **"Every importer output must pass `parseDeck`" is not enforced on the collab server's import route** (`src/server/collabServer.ts:4588-4596,2154-2157`).
- **`.versions/` is not in every deck folder.** Only `CollabSession` writes it (`src/server/collabSession.ts:93`), so like `history.jsonl` it belongs to hosted decks.
- **`example-keynote-decks/` is missing from the folder list**, yet its `empty_deck.key` (with `test/fixtures/pptx/reference.pptx`) is required at runtime: the collab server will not start without them (`src/server/collabServer.ts:4611-4614`; `scripts/collab-server.mts:76-88`).
- **The long tier is not derived.** It is a hand-maintained list in `test/longTestFiles.ts:7-25`, which `test/testTiers.ts:5` only imports.
- **Build outputs omit** `build/pyinstaller/` (`scripts/build-importer.mjs:73-74`), `dist-site/` (`scripts/build-site.mjs:13-16`) and `artifacts/`.
- **Hosted-server side effects omit** `<decksRoot>/.uploads/` and the `access.json` sidecar (`scripts/collab-server.mts:12-14,21-26`; `src/server/collabServer.ts:847`).

