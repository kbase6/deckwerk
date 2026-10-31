# renderer/player

## Overview

The Electron-free deck runtime. `render.ts` turns `deck.json` slides into DOM,
and `Player` (`player.ts`) owns navigation and drives timeline builds, Morph
transitions and media playback, warming upcoming slides ahead of time. The same
code renders the [editor](../editor/README.md) previews, the
[present](../present/README.md) window, the [exported bundle](../export/README.md),
the [Speaker View](../presenter/README.md) previews and the
[print](../print/README.md) pages, so a deck looks the same everywhere. The
remaining modules handle media loading and decoding, and presenting helpers
(keys, laser pointer, links, text-selection handling).

## Interface

### Files

| File | Role |
| --- | --- |
| `player.ts` | `Player`: cursor navigation, build scheduling, Morph, video playback and retries, lookahead warming, decoded-video reuse |
| `render.ts` | deck to DOM: slide and element rendering, in-place sync helpers shared with the editor's patch path, auto-fit text, KaTeX, live web elements, stage scaling |
| `morphTransform.ts` | Pure Morph start and end transforms |
| `staticState.ts` | Applies the motion-free endpoint of a build state |
| `imageDecode.ts` | Keeps images hidden until `decode()` finishes |
| `decodedVideoPool.ts` | Global bounded LRU of detached `<video>` elements that already hold a frame |
| `mediaLoadGate.ts` | Page-wide throttle on preview `<video>` metadata loads |
| `videoBlobCache.ts` | Downloads whole videos into memory as `blob:` URLs for browser presentations |
| `videoLoadingProgress.ts` | Per-video progress ring and a page-level "Loading videos… n of m" pill |
| `previewPoster.ts`, `previewPosterProvider.ts`, `previewFrameRecovery.ts` | Freeze preview videos into still images; pluggable poster source; re-queue frameless previews when the page becomes visible |
| `keys.ts`, `laserPointer.ts`, `links.ts`, `presentationPointer.ts` | Presenting key map, laser pointer, authored links, click-after-text-selection handling |
| `player.css`, `type.css` | Player and typography styles (`type.css` is also inlined by `src/shared/playerTypeCss.ts`) |

### Key symbols

- `Player` (`player.ts`): `new Player(options)`, `destroy`, `getCursor`,
  `setDeck`, `next`, `prev`, `goToSlide(index, {play})`,
  `goTo(cursor, {play})`, `toggleBlank`.
- `PlayerOptions` (`player.ts`):
  `{deck, container, resolveSrc, onCursor?(cursor, steps), videoBlobs?}`.
- `matchMorphElements` (`player.ts`): pairs elements across slides for Morph.
- `renderSlide(slide, opts)`, `RenderOptions`
  `{resolveSrc, mediaPreload?: 'auto' | 'metadata', deferVideoSrc?, deck?}`
  (`render.ts`).
- In-place helpers (`render.ts`): `renderElement`, `elementBody`,
  `applyElementBoxStyles`, `applyTextRenderState`, `syncShapeBody`,
  `syncMediaFrame`, `applyMediaFitStyles`, `applyVideoPlaybackState`,
  `applySlideRootStyles`, `syncSlideNumber`, `fitAutoText`,
  `scheduleAutoFit`, `rewriteCssAssetUrls`, `applyStageScale`.
- `whenWebElementReady`, `WEB_REVEAL_TIMEOUT_MS = 5000`,
  `videoPresentationKey`, `posterFrameTime`, `armPosterFrameSeek`
  (`render.ts`).
- `morphTransforms`, `Rect`, `Point`, `TextLayout`, `MorphTransforms`
  (`morphTransform.ts`); `applyStaticSlideState(stage, slide, state)`
  (`staticState.ts`).
- `DecodedVideoPool`, `decodeVideoFrame`, `releaseDecodedVideo`;
  `decodeImage`, `revealImagesWhenDecoded`; `gateVideoLoad`,
  `ungateVideoLoad`, `isGated`, `gatedLoadsPending`; `VideoBlobCache`;
  `trackVideoLoading(root)`.
- `freezePreviewVideos`, `releasePreviewVideos`; `PreviewPosterProvider`,
  `setPreviewPosterProvider`, `installWindowApiPosterProvider`;
  `recoverPreviewFrames`, `trackPreviewFrameRecovery`.
- `bindPresentKeys(target, player, handlers)` (`keys.ts`);
  `createLaserPointer`, `slidePoint`, `validLaserPoint` (`laserPointer.ts`);
  `prepareSlideLinks`, `slideLinkFromEvent`, `eventOnInteractiveWeb`,
  `openSlideLinkInNewTab` (`links.ts`); `selectionPreventsAdvance`
  (`presentationPointer.ts`).

## Invariants

- `render.ts` stays free of Electron and editor state, so the editor preview,
  present window and exported bundle cannot drift apart.
- `renderSlide` paints elements in `z` order with a stable sort; array order
  breaks ties.
- Jumping replays `resolveState` with delays collapsed; stepping forward
  schedules the same actions with their delays and `mediaEnd` waits. Both paths
  must reach the same state.
- The player, presenter preview and PDF pages all apply build states through
  `applyStaticSlideState`, so visibility and build classes match.
- Decoded `<video>` nodes are reused only under `videoPresentationKey` (same
  file, frame and geometry), never by file alone.
- The Morph transform origin is always the element centre; the alignment
  anchor is folded into the translation, or the object would snap when the
  animation ends.
- At most 3 gated preview loads run at once. Live playback surfaces
  (`preload=auto`) are never gated. `deferVideoSrc` only applies with
  `mediaPreload: 'metadata'`.
- Authored links always get `target=_blank` and `rel=noopener`, also inside
  the open shadow roots of HTML elements.
- Laser positions are 0-1 fractions of the slide, sent at most once per
  animation frame. Loading overlays are `pointer-events: none`, marked
  `data-editor-only`, and never touch playback.

## Side Effects

- DOM construction, KaTeX auto-render and a global import of
  `katex.min.css` (`render.ts`).
- Player timers: build timeouts cleared on every move, play retries (12 x
  400 ms), a `ResizeObserver`, and lookahead warming of the next 2 slides'
  media; `fetch` for warming.
- Module-level gate state with a 2 s watchdog interval (`mediaLoadGate.ts`).
- Whole-file video downloads to `blob:` URLs, one at a time, default budget
  1 GiB (`videoBlobCache.ts`).
- Detached videos are explicitly torn down to free decoder state; the pool is
  global (`decodedVideoPool.ts`). Decode promises are cached in module-level
  weak maps (`imageDecode.ts`).
- Preview videos are replaced by captured still images for the session
  (`previewPoster.ts`). The poster provider is a module-level singleton; in
  the desktop app it asks the main process (ffmpeg) through `window.api`.
- A `visibilitychange` listener (`previewFrameRecovery.ts`) and keyboard
  listeners (`keys.ts`, which returns an unbind function).
- Live web elements stay hidden until ready or for at most 5 s.

## Verification

- Run: `npx vitest run test/decodedVideoPool.test.ts test/mediaLoadGate.test.ts test/morphTransform.test.ts test/playerVideoReuse.test.ts test/previewPosterProvider.test.ts test/videoLoadingProgress.test.ts test/textAutoFit.test.ts test/slideLinks.test.ts`
- Run: `npx vitest run --config vitest.browser.config.ts test/morphBrowser.test.ts test/presentPlaysDeck.test.ts`
  (launches Electron)
- Full suite: `npm test`
