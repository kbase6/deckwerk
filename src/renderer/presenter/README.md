# renderer/presenter

## Overview

The Speaker View: current and next slide previews, speaker notes, build
position, presentation and slide timers, a wall clock, and controls.
`speakerView.ts` is a shell-agnostic component shared by the desktop Electron
window and the browser [collaboration client](../collab/README.md).
`main.ts` is only the Electron IPC transport, and `model.ts` holds pure
formatting helpers. Previews are drawn with the
[Player](../player/README.md) renderer.

## Interface

- `createSpeakerView(options: SpeakerViewOptions): SpeakerView`
  (`speakerView.ts`): mounts the view into `options.host`.
- `SpeakerViewOptions` (`speakerView.ts`): `host`, `resolveSrc`, `onCommand`,
  and optional `canSwapDisplays`, `swapLabel`, `swapTitle`, `endLabel`,
  `extraActions`, `now` (injectable clock) and `laser`.
- `SpeakerView` (`speakerView.ts`): `setDeck`, `setTheme`, `setState`,
  `refresh`, `tick`, `destroy`.
- `bindSpeakerKeys(target, onCommand): () => void` (`speakerView.ts`):
  Right/Down/Space/PageDown/Enter send `next`; Left/Up/PageUp/Backspace send
  `prev`; `b` sends `toggleBlank`; Escape sends `exit`. Returns an unbind
  function.
- `formatElapsed(now, startedAt)` (`model.ts`): `MM:SS`, never negative.
- `formatWallClock(date, locale?)` (`model.ts`): hour and two-digit minute.
- `presentationLabel(state, slideCount)` (`model.ts`):
  `Slide X / N · Build Y / S`, 1-based.
- `main.ts`: desktop entry (the `presenter` page in `electron.vite.config.ts`);
  no exports. `presenter.css`: Speaker View styles.

## Invariants

- The next-slide preview skips skipped slides and is blank past `range.end`
  (or past the last slide when there is no range).
- `setState` rebuilds previews only when `cursor.slide`, `cursor.step`,
  `steps` or `range.end` changes. Laser-only updates do not re-render.
- Each preview calls `releasePreviewVideos` before its children are replaced,
  so discarded stages held by the global capture map are not leaked.
- Previews are static: rendered with `mediaPreload: 'metadata'` and
  `deferVideoSrc`, videos paused and frames frozen with
  `freezePreviewVideos`, images shown only once decoded.
- With `canSwapDisplays === false` the swap button is removed, not disabled.
- The laser toggle exists only when `options.laser` is true. The desktop
  `main.ts` passes `laser: true`.
- Key handling ignores events that are already `defaultPrevented`, events in
  `contentEditable` targets, and focused INPUT, TEXTAREA or SELECT elements.
  Speaker keys only forward commands.

## Side Effects

- Sets `host.innerHTML` and adds the `speaker-view` class; `destroy()` clears
  both.
- Runs `setInterval(tick, 250)` for the clocks; `destroy()` clears it.
- `setTheme` adds a `<style>` to `document.head` (asset URLs rewritten by
  `resolveSrc`); `destroy()` removes it.
- `main.ts` calls `applyUiTheme()` and `installWindowApiPosterProvider()` at
  module load, so thumbnails take video frames from the main process. It
  sends commands with `window.api.sendPresentCommand`, subscribes to
  `onDeckState` and `onPresentState`, calls `getDeck` on load, and refreshes
  the view on window resize.
- `main.ts` imports `player.css`, `appChrome.css`, `presenter.css` and
  `lightTheme.css`.

## Verification

- Run: `npx vitest run test/speakerView.test.ts test/presenterModel.test.ts test/speakerWindow.test.ts`
- Run: `npx vitest run --config vitest.browser.config.ts test/presenterNumbersBugsBrowser.test.ts`
  (launches Electron)
- Full suite: `npm test`
