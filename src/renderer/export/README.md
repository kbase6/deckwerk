# renderer/export

## Overview

The boot script for an exported deck. `npm run build:export`
(`vite.export.config.ts`) builds `standalone.ts` into a single self-contained
IIFE (`out/export/player.js` and `player.css`, no hashed names). The export's
generated `index.html` references those files by fixed name, so an exported
deck is a plain folder that opens in any browser from `file://`, with no app or
server. The script reads the deck that `index.html` injects, renders it with
the shared [Player](../player/README.md), and adds key, mouse and `#N`
deep-link navigation.

## Interface

- `standalone.ts`: the only file and the bundle entry. It has no exports.
- `window.__DECK__` (input): raw deck data written into the generated
  `index.html`, parsed with `parseDeck` from `src/shared/deck.ts`.
- `window.__SLIDE_PLAYER__` (output): the live `Player` handle, for tests and
  diagnostics that need an exact slide build state.
- URL hash `#N`: 1-based slide deep link, applied on load and on
  `hashchange` through `player.goToSlide(N - 1)`.

## Invariants

- Assets sit next to `index.html`, so `resolveSrc` is the identity function and
  deck-relative paths are used as-is.
- If `window.__DECK__` is missing, the page shows "No deck data found in this
  export." and does not boot. A missing `#root` element throws.
- The hash is applied only when it parses to a finite integer of 1 or more.
- A mousedown on a slide link or an interactive web element does not
  navigate. Otherwise the left button goes to the next build and the right
  button to the previous one.
- The bundle has no module graph and no hashed filenames. Exported
  `index.html` files depend on the fixed names `player.js` and `player.css`.

## Side Effects

- Sets `window.__SLIDE_PLAYER__`.
- Adds window listeners for `hashchange`, `mousedown` and `contextmenu`
  (`contextmenu` is `preventDefault`ed), plus presentation keys via
  `bindPresentKeys`.
- Imports `../player/player.css` into the bundle.
- Boots on `DOMContentLoaded`, or at once if the document has already loaded.

## Verification

- Build: `npm run build:export`
- Run: `npx vitest run --config vitest.long.config.ts test/exportLooksLikeSlide.test.ts`
  (rendered export fidelity; launches Electron)
- Full suite: `npm test`
