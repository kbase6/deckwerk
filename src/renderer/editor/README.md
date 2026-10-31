# renderer/editor

## Overview

The desktop slide editor UI (the `editor` entry in `electron.vite.config.ts`).
`index.html` (strict CSP) lays out the toolbar, slide rail, canvas, side panels
(inspector, theme, timeline, history) and status line, then loads `main.ts`.
`main.ts` is the Electron editor shell: it wires every panel to one
`EditorStore` and owns the toolbar, keyboard map, autosave and the debounced
deck-history save. It reaches the main process only through `window.api`
(see [preload](../../preload/README.md)). `shellWiring.ts`, `ui.ts` and
`EditorStore.onLocalEdit` are shell-independent and are reused by the browser
[collaboration client](../collab/README.md). Slides are drawn with the
[player](../player/README.md) renderer. The `fonts/` subfolder holds only the
Monaspace Krypton font file and its licence.

## Interface

### Files

| Area | Files |
| --- | --- |
| Shell and state | `main.ts` (Electron shell entry), `store.ts` (`EditorStore`), `shellWiring.ts` (shared wiring), `sessionPersistence.ts` (save routing), `ui.ts` (shared controls) |
| Canvas | `canvas.ts` (`EditorCanvas`, about 350 KB), `snapping.ts`, `align.ts`, `arrange.ts`, `elementCreation.ts`, `mediaNatural.ts`, `keptSelection.ts`, `contextMenuPlacement.ts` |
| Text | `textFormatting.ts`, `listEditing.ts`, `linkEditing.ts`, `spellcheck.ts` (Harper, local WebAssembly), `fontPicker.ts` |
| Panels | `inspector.ts`, `slideRail.ts`, `timelinePanel.ts`, `morphPanel.ts`, `themePanel.ts`, `themeGallery.ts`, `designWorkspace.ts`, `layoutPreview.ts`, `slideLayouts.ts`, `historyPanel.ts`, `comments.ts`, `speakerNotesDrawer.ts`, `agentPanel.ts`, `cssEditor.ts` (CodeMirror) |
| Controls and dialogs | `colorPicker.ts`, `eyedropper.ts`, `angleDial.ts`, `durationField.ts`, `panelResize.ts`, `responsiveToolbar.ts`, `exportPicker.ts`, `confirmDialog.ts`, `pdfExportDialog.ts`, `webExportDialog.ts`, `pasteThemeDialog.ts`, `aboutDialog.ts`, `welcomeScreen.ts`, `statusBar.ts`, `operationProgress.ts`, `elementLabel.ts` |
| Agents and HTML | `agentBridge.ts` (publishes live selection and scenes), `htmlCompile.ts` (compiles authored HTML in an offscreen iframe) |
| Media | `pendingUploads.ts` (in-flight import state and asset probing) |
| Dev checkers | `renderInvariants.ts`, `selectionInvariants.ts` |
| Page | `index.html`, `editor.css`, `favicon.svg` |

### Key symbols

- `EditorStore` (`store.ts`): `subscribe`, `load`, `replaceExternal`,
  `applyRemote`, `resyncRemote`, `commit`, `beginTransaction` /
  `endTransaction`, `undo` / `redo`, `history` / `restoreHistory` /
  `persistedHistory`, selection methods (`selectSlide`, `select`,
  `selectAllElements`, ...), `updateSelected`, `deleteSelection`,
  `duplicateSelection`; hooks `onLocalEdit` and `onHistoryChange`.
- `EditorState`, `HistoryItem`, `RemoteHistoryOptions` (`store.ts`).
- `copySelectionToClipboard`, `cutSelectionToClipboard`,
  `copySlidesToClipboard`, `pasteFromClipboard`, `paste` (`store.ts`).
- `EditorCanvas` (`canvas.ts`) with `on*` callbacks (`onTextEditModeChange`,
  `onMaskModeChange`, `onTableSelectionChange`, `onUndoRequest`,
  `onViewportChange`, ...); `CANVAS_NOTICE_EVENT`; geometry helpers
  `elementContainsPoint`, `lineEndpoints`, `lineFromEndpoints`,
  `snapToAngleStep`, `measureTextToSize`.
- `Inspector`, `numberField` (`inspector.ts`); `SlideRail` (`slideRail.ts`);
  `TimelinePanel`, `reorderBuildEntry` (`timelinePanel.ts`); `MorphPanel`,
  `pairMorphObjects` (`morphPanel.ts`); `ThemePanel` / `createThemePanel`,
  `DesignWorkspace`, `createThemeGallery`; `HistoryPanel`; `AgentPanel`.
- `wireCanvasInspector`, `bindEditorKeys`, `createClipboardActions`,
  `makeContextActions`, `ShellDeps` (`shellWiring.ts`).
- `AgentBridge`, `buildComputedScenes`, `browserDeckRevision`
  (`agentBridge.ts`); `compileAuthoredHtml`, `authoredHtmlSync`,
  `authoredHtmlTransaction` (`htmlCompile.ts`).
- `persistSessionDeck`, `SessionPersistenceApi` (`sessionPersistence.ts`).
- `snapMove`, `snapResize`, `snapPoint`, `spacingGuides`, `sizeGuides`
  (`snapping.ts`); `alignElements` (`align.ts`); `arrangeElements`,
  `arrangeSelection` (`arrange.ts`).
- `insertText`, `insertTable`, `insertShape`, `insertPolygon`, `insertLine`
  (`elementCreation.ts`); `setWholeTextFormat`, `toggleWholeTextFormat`,
  `applyTextRole`, `wholeTextFormatState` (`textFormatting.ts`);
  `indentListItem`, `outdentListItem`, `unbulletListItems`
  (`listEditing.ts`).
- `findRenderDivergences`, `reportRenderDivergences`,
  `setRenderInvariantChecks` (`renderInvariants.ts`);
  `findSelectionViolations`, `reportSelectionViolations`,
  `SelectionSnapshot` (`selectionInvariants.ts`).
- `SpellingSession`, `spellcheckEnabled` (`spellcheck.ts`).
- Dialogs and primitives: `showConfirmDialog`, `showPdfExportDialog`,
  `showWebExportDialog`, `showPasteThemeDialog`, `showAboutDialog`,
  `showToast`, `openMenu`, `openAnchoredPopover`, `button` (`ui.ts`),
  `makePanelResizable`, `DelayedOperationProgress`, `applySlideLayout`.

## Invariants

- The current slide is always in `slideSelection`, and the slide selection
  never empties: toggling off the last picked slide does nothing.
- Store states are never mutated in place. `onLocalEdit` fires only when a
  local undo unit is created, never for remote or external deck replacements.
- Undo and history entries are semantic forward and inverse agent operations.
  History is capped at 200 entries (`HISTORY_LIMIT`), and trimmed rows are
  folded into the base in batches of 50. A drag is one undo entry, coalesced
  through a transaction, not one per mouse move.
- An external reload (an agent edit, git) with `keepView` must not move the
  editor away from the current slide.
- Pointer movement below the drag threshold commits nothing, so a click or
  double-click never changes the deck. Align is one commit; a duration slider
  drag commits once, at the end.
- A slide rendered fresh from the model must produce the same DOM as the
  in-place patch path, ignoring editor-only nodes (`renderInvariants.ts`).
  After a render settles, store selection, canvas edit/crop/table sessions,
  the browser Selection, focus and DOM chrome must agree
  (`selectionInvariants.ts`). Both checks are on in development builds or with
  `VITE_RENDER_INVARIANTS=1`. Per the repository rules, new "must" rules
  belong in these checkers, not in comments.
- When collaboration owns the disk, saves go through `syncDeckSnapshot` rather
  than a second writer (`sessionPersistence.ts`).
- The design workspace preview owns no deck state, and `applySlideLayout`
  never reads or changes the installed theme.
- New controls reuse the shared chrome (`ui.ts`, `src/renderer/appChrome.css`).
  Operations that can take longer than about 500 ms show delayed progress
  through `DelayedOperationProgress` (repository AGENTS.md rules).

## Side Effects

- IPC through `window.api`: deck open/new/save/save-as/get, history
  load/save, PDF and web export, Keynote and PowerPoint import, asset and URL
  import, OS clipboard, window capture, present, speaker notes, collaboration
  start, agent context and responses, plus `on*` listeners (`onDeckState`,
  `onHtmlEdit`, `onAgentRequest`, `onOperationProgress`, ...).
- Timers for autosave and the debounced deck-history save (`main.ts`).
- localStorage and sessionStorage in `canvas.ts`, `panelResize.ts`,
  `comments.ts`, `spellcheck.ts` and `webExportDialog.ts`.
- DOM: mounts the `index.html` containers, adds `mac-titlebar` on macOS,
  dispatches `CANVAS_NOTICE_EVENT` status messages.
- An offscreen iframe for compiling authored HTML (`htmlCompile.ts`); the Local
  Font Access API (`fontPicker.ts`); Harper WebAssembly (`spellcheck.ts`; CSP
  allows `'wasm-unsafe-eval'`).
- Poster frames for rail and Morph thumbnails come from the main process
  (`installWindowApiPosterProvider`), so previews never open a video
  pipeline.

## Verification

- Run: `npx vitest run test/canvasEditing.test.ts test/slideRail.test.ts test/snapping.test.ts test/renderInvariants.test.ts test/listEditing.test.ts test/timelinePanel.test.ts test/themePanel.test.ts test/historyPanel.test.ts`
- Run: `npx vitest run --config vitest.browser.config.ts test/crossContextFuzzBrowser.test.ts`
  (launches Electron; new gestures and panel controls add an operation here)
- Full suite: `npm test`
