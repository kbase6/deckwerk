# renderer/present

## Overview

The fullscreen audience window of the desktop app (the `present` entry in
`electron.vite.config.ts`). It renders the deck with the same
[Player](../player/README.md) the editor uses and applies the deck's theme
CSS. It honours an optional slide range from URL parameters, skipped slides,
blanking and the laser pointer, and publishes its state to the
[Speaker View](../presenter/README.md) through `window.api`
(see [preload](../../preload/README.md)).

## Interface

- `index.html`: fullscreen shell. CSP allows only `'self'`, `deck:` and
  `data:`; black background, hidden cursor, `#root` container.
- `main.ts`: window logic. It has no exports.
- URL parameters: `slide` (starting slide index); when both `slide` and
  `endSlide` are finite they define a `PresentationRange {start, end}`.
- Commands received through `window.api.onPresentCommand`: `next`, `prev`,
  `goTo` (clamped to the range), `toggleBlank`, `toggleLaser`, `laserMove`.
- State published through `window.api.publishPresentState`:
  `PresentationState {cursor, steps, startedAt, slideStartedAt, range?, laser}`
  (type in `src/shared/ipc.ts`).
- Also uses `window.api.getDeck`, `onDeckState`, `loadTheme` and `assetUrl`.

## Invariants

- A skipped start slide moves forward to the next non-skipped slide inside
  the range (or deck). If there is none, it moves back to the nearest
  non-skipped slide no earlier than `range.start` (or 0).
- With a range, advancing past its end closes the window and going back before
  its start does nothing (`nextLeavesPresentationRange`,
  `prevLeavesPresentationRange` in `src/shared/presentationRange.ts`).
- `laserMove` is ignored when the laser is off, the screen is blanked, the
  point's slide id or step does not match the current cursor, or the point fails
  `validLaserPoint`.
- Every cursor change clears the laser point. `slideStartedAt` resets only
  when the slide index changes.
- A click advances, not pointer-down, so a native drag selection does not
  change the slide. Clicks on slide links and interactive web elements, and
  clicks while `selectionPreventsAdvance()` is true, do not advance.
- A later deck update calls `player.setDeck` on the existing Player instead of
  rebuilding it.
- On load the window pulls the deck with `getDeck` rather than waiting for a
  broadcast, so a window reopened mid-talk does not stay black.

## Side Effects

- Adds a `<style>` element with the theme CSS to `document.head` and keeps it
  updated (asset URLs rewritten through `window.api.assetUrl`).
- Calls `window.close()` on exit and when advancing past the range end.
- Registers window `click`, `mousedown` and `contextmenu` listeners
  (`contextmenu` is `preventDefault`ed) and the presentation key bindings.
- Adds a laser pointer overlay to `#root`.

## Verification

- Run: `npx vitest run test/presentationRange.test.ts test/presentationPointer.test.ts`
- Run: `npx vitest run --config vitest.browser.config.ts test/presentPlaysDeck.test.ts`
  (launches Electron)
- Full suite: `npm test`
