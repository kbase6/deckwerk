# renderer/print

## Overview

The hidden page used for PDF export (the `print` entry in
`electron.vite.config.ts`). It lays out one `.pdf-page` per printable slide
build state at the deck's canvas size in CSS pixels, waits until every asset
has settled, then signals that it is ready. `pages.ts` is shared by the
Electron `printToPDF` window and the browser
[collaboration client](../collab/README.md)'s print tab, and both must lay out
identically. Slides are drawn with the [Player](../player/README.md) renderer.

## Interface

- `printPageRule(deck): string` (`pages.ts`):
  `@page { size: <canvas.w>px <canvas.h>px; margin: 0; }`.
- `buildPrintPages(container, options: PrintPagesOptions): PrintPage[]`
  (`pages.ts`): appends `.pdf-page > .pdf-stage` for each step that
  `pdfSteps(slide, mode)` (`src/shared/pdfExport.ts`) returns.
- `PrintPage {page, slide, state}` and
  `PrintPagesOptions {deck, mode: PdfBuildMode, includeHidden?, slideFilter?, resolveSrc}`
  (`pages.ts`).
- `waitForPdfDocument(pages): Promise<void>` (`readiness.ts`): waits for
  `document.fonts.ready`, then `waitForPdfPage` for every page, then two
  animation frames. It then finishes finite CSS animations and waits two more
  frames.
- `waitForPdfPage(page, slide, state): Promise<void>` (`readiness.ts`).
- `isAnimatedImageSource(src): boolean` (`readiness.ts`): `.gif` at the end
  of the path, before `?` or `#`, case-insensitive.
- `main.ts` URL parameters: `mode` (`initial` | `every`, default `final`),
  `includeHidden=1`, repeated `slide` (slide-id filter), `job` (job id echoed
  to `pdfReady`).
- Completion signal (`main.ts`): `data-ready="true"` or
  `data-error="<message>"` on `<html>`, then `window.api.pdfReady(jobId)`.

## Invariants

- Skipped slides are left out unless `includeHidden` is set. `slideFilter`
  limits output to the listed slide ids.
- Pages and stages are sized in CSS pixels at `deck.canvas`, so print and
  Player coordinates are identical (this avoids a Retina double-scale bug).
- Slides render with full media preload, not `metadata`, so pinned video
  seeks do not race the network.
- With no pages, `main.ts` throws "No slides to export. Select the slides
  again."; with no open deck it throws "No deck is open". `pdfReady(jobId)` is
  called on success and on failure.
- Videos are pinned to `state.seeks.get(id)` (falling back to
  `element.start`), clamped to `[0, duration - 0.03]`. `settleVideo` sets
  `data-hold-frame`, turns off autoplay and pauses before seeking, so the
  Player does not restart playback.
- Event waits time out after 5 s by default; `requestVideoFrameCallback`
  waits time out after 2 s.
- Animated GIFs are frozen to their first frame (PNG data URL). If that fails
  the GIF is kept. Videos are replaced by a canvas copy; if the copy fails the
  live video stays.
- Image discovery recurses into shadow roots. Only animations with a finite
  iteration count are finished.

## Side Effects

- Adds theme and `@page` `<style>` elements to `document.head` (asset URLs
  rewritten with `window.api.assetUrl`).
- Sets `data-ready` or `data-error` on `<html>` and calls
  `window.api.pdfReady`.
- `readiness.ts` `fetch()`es GIF sources, rewrites `img.src`, replaces
  `<video>` elements with `<canvas>`, releases their decoders, and finishes
  document animations.

## Verification

- Run: `npx vitest run test/pdfExport.test.ts test/pdfReadiness.test.ts`
- Run: `npx vitest run --config vitest.browser.config.ts test/pdfLooksLikePlayer.test.ts test/collabPdfExportBrowser.test.ts`
  (launches Electron)
- Full suite: `npm test`
