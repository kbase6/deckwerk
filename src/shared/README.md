# shared

## Overview

The process-agnostic core, imported by the renderers, the main process, the
collaboration server and the CLI (aliased as `@shared`). `deck.ts` holds the
zod deck schema, the single source of truth for `deck.json` and every type
derived from it. Around it sit agent transactions (strict, all-or-nothing),
the collaboration wire protocol and its lenient last-write-wins apply, HTML
authoring (slides to HTML, browser measurement, sanitization), themes,
timeline builds, Morph pairing, comments, three-way text merge, and the IPC
channel table. Almost every file is plain schemas and functions; the only
runtime package dependency is zod.

## Interface

### Files

| Area | Files |
| --- | --- |
| Deck model | `deck.ts` (schema, `parseDeck`), `fieldAliases.ts` (retired field names), `lineHeight.ts`, `geometry.ts`, `jsonData.ts`, `featureNames.ts` (`MORPH_NAME`) |
| Agent and collaboration | `agent.ts` (agent protocol and strict apply), `collab.ts` (wire protocol), `collabApply.ts` (lenient apply), `nativeEdits.ts`, `deckDiff.ts`, `deckDigest.ts`, `capabilities.ts` (feature catalogue), `comments.ts`, `chat.ts`, `editHistory.ts`, `deckHistory.ts`, `textMerge.ts` |
| HTML authoring | `htmlSlides.ts` (slides to HTML and back), `htmlMeasure.ts` (browser page and measurement walk), `htmlSafety.ts` (sanitizers), `katexInline.ts` (generated KaTeX bundle), `webBridge.ts` (web element runtime) |
| Themes and layout | `themes.ts`, `fontSets.ts`, `layoutMasters.ts` |
| Builds and Morph | `timeline.ts`, `morph.ts`, `presentationRange.ts`, `pdfExport.ts` |
| Shapes, text and media | `shapeSvg.ts`, `shapeShadow.ts`, `shapeText.ts`, `polygonShape.ts`, `brace.ts`, `paragraphs.ts`, `autoFit.ts`, `nativeCss.ts`, `media.ts`, `mediaMask.ts`, `playerTypeCss.ts` |
| Clipboard, files and IPC | `clipboard.ts`, `clipboardFiles.ts`, `clipboardImages.ts`, `speakerNotes.ts`, `editorView.ts`, `zip.ts`, `ipc.ts`, `api.d.ts` |

### Key symbols

- `DeckSchema` / `Deck` (`deck.ts`): version 1, title, `canvas` (default
  1920x1080), theme fields (`themePreset`, `themeStyle`, `themeSelection`,
  `themeHistory`, `customThemes`), `layoutMasters`, `morphEasing`, slide
  numbering, `slides`.
- `SlideSchema` / `Slide`: id, name, background, notes, layout (`freeform`,
  `standard`, `title`), `morphFromPrevious`, `morphDuration` (100-5000 ms),
  `skipped`, `elements`, `timeline`, `comments`.
- `ElementSchema` / `SlideElement`: union on `type` (`text`, `image`,
  `video`, `shape`, `html`, `web`, `unsupported`) with shared geometry
  (`x`, `y`, `w`, `h`, `rot`, `z`, `opacity`) and `class`, `style`, `morphId`,
  `lineageId`, `layoutMasterId`, `comments`.
- `TriggerSchema`, `ActionSchema`, `TimelineEntrySchema`, `ThemeStyleSchema`,
  `CustomThemeSchema`, `CommentSchema`, `MediaEffectSchema` (`deck.ts`).
- `parseDeck(raw)`, `emptyDeck`, `deckForExport`, `slideNumber`,
  `DECK_VERSION` (`deck.ts`).
- `AgentTransactionSchema`, `AgentOperationSchema` (ops `updateComments`,
  `insertSlides`, `replaceSlide`, `deleteSlide`, `moveSlide`,
  `insertElements`, `replaceElement`, `deleteElements`, `updateDeck`,
  `setSlideProperties`), `applyAgentTransaction`, `applyAgentOperations`,
  `validateDeckIntegrity`, `canonicalDeckJson`, `AgentContextSchema`,
  `AgentRequestSchema`, `AgentResponseSchema`, `AGENT_PROTOCOL_VERSION`
  (`agent.ts`).
- `applyOpsLenient`, `LenientApplyResult` (`collabApply.ts`);
  `ClientMessageSchema`, `ServerMessageSchema`, `COLLAB_PROTOCOL_VERSION`,
  `COLLAB_CLOSE` (`collab.ts`).
- `IPC` channel map and payload types (`ipc.ts`); `window.api` global type
  (`api.d.ts`, from `src/preload`).
- `mergeComments`, `commentsOperation`, `carryComments`,
  `withoutCommentOps`, `commentThreads` (`comments.ts`).
- `renameRetiredFields`, `canonicalFieldName`, `RETIRED_FIELD_NAMES`
  (`fieldAliases.ts`).
- `slidesToHtml`, `slideToHtml`, `slidesFromMeasured`, `slideFromMeasured`,
  `htmlSyncOperations`, `HtmlAuthoringError` (`htmlSlides.ts`);
  `measureSlides`, `measureSlidesSource`, `authoringPageHtml`,
  `measureTextOverflows` (`htmlMeasure.ts`); `sanitizeAuthoredHtml`,
  `sanitizePastedTextHtml`, `stripLayoutDeclarations` (`htmlSafety.ts`).
- `normalizeStyleLineHeight`, `normalizeHtmlLineHeights`, `lineHeightRatio`
  (`lineHeight.ts`); `mergeTextHtml`, `diffSequences`, `mergeSequences`,
  `mapTextOffset` (`textMerge.ts`).
- `THEMES`, `themeById`, `applyThemeToSlide`, `applyThemeToDeck`,
  `applyDeckThemeToNewSlide`, `themeCss`, `restyleDeck` (`themes.ts`).
- `expandTimeline`, `groupIntoSteps`, `stepCount`, `resolveState`,
  `nextCursor`, `prevCursor` (`timeline.ts`); `suggestMorphPairs`,
  `explicitMorphPairs`, `unchangedMorphPairs` (`morph.ts`).
- `syncDeckWithLayoutMasters`, `defaultLayoutMasters`,
  `realignSlideToLayout` (`layoutMasters.ts`); `applyNativeEdits`,
  `NativeEditRequestSchema` (`nativeEdits.ts`); `capabilities`,
  `Capability` (`capabilities.ts`); `buildZip` (`zip.ts`).

## Invariants

- `DeckSchema` is the single source of truth: `deck.json` is validated
  against it on load, and other modules derive their types from it.
- Geometry is absolute pixels on a fixed canvas (default 1920x1080); the
  player scales the whole stage with one transform.
- `line-height` is always stored as a unitless ratio of the font size. Zod
  transforms normalize element `style`, `contentStyle` and text `html` on every
  parse.
- Comments are review state: they change only through `updateComments`, which
  merges by comment id; replacements keep a target's comments, and undo never
  touches them. A root comment's `resolved` is the thread's state.
- Every entry point that takes data from outside the process renames retired
  fields through `fieldAliases.ts` (`parseDeck`, `applyAgentTransaction` and
  `applyAgentOperations` all do). A rename is a new row there, never a second
  reader.
- An `AgentTransaction` needs `version === 1`, an `expectedRevision` of 64
  lowercase hex characters, a label of 1-200 characters, and at least one
  operation. `applyAgentOperations` works on a clone, re-validates the whole
  deck and its integrity (no duplicate slide or element ids), and rejects the
  whole transaction on any failure.
- `applyOpsLenient` is total and deterministic: the server and every client
  replay the same server-ordered stream through it and converge.
- The server holds the authoritative deck, gives each accepted transaction a
  rising `seq`, and broadcasts it to every client including the sender.
- The editor renderer and headless Electron must measure HTML identically, so
  the authoring page and measurement walk exist once (`measureSlidesSource`
  serializes the same function).
- Authored slides may use HTML, CSS, SVG, images, video and CSS animation but
  cannot run JavaScript or fetch external resources while presenting.
- Step 0 is the state on slide entry; each `click` entry starts a new step.
  The schema accepts triggers `click`, `afterPrev`, `withPrev`, `mediaEnd`
  and several actions, but per `deck.ts` v1 implements only the
  `click`/`afterPrev` triggers and `appear`/`play` actions.
- Choosing or installing a theme restyles nothing; applying it is a separate
  act per slide or deck. Custom theme ids match `^[a-z0-9][a-z0-9-]*$`.
- `katexInline.ts` is generated by `npm run build:katex`; do not edit it.

## Side Effects

- Almost every module is pure: schemas, constants and functions on deck
  values. No file imports Node built-ins.
- `htmlMeasure.ts` and `autoFit.ts` work on live DOM; `measureSlidesSource`
  is run in headless Electron through `executeJavaScript`.
- `chat.ts`, `editHistory.ts` and `speakerNotes.ts` define persisted file
  names and limits but do no I/O.
- `playerTypeCss.ts` imports `src/renderer/player/type.css` raw at build
  time; `api.d.ts` imports a type from `src/preload`.

## Verification

- Run: `npx vitest run test/htmlSlides.test.ts test/htmlMeasure.test.ts test/htmlSafety.test.ts test/agentTransactions.test.ts test/collabApplyCow.test.ts test/deckDiff.test.ts test/textMerge.test.ts test/lineHeight.test.ts test/fieldAliases.test.ts test/timeline.test.ts test/morph.test.ts test/commentThreads.test.ts test/layoutMasters.test.ts test/themesAndTools.test.ts`
- Full suite: `npm test`
