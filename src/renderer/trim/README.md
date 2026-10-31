# renderer/trim

## Overview

The "Trim & Crop" window of the desktop app (the `trim` entry in
`electron.vite.config.ts`). It edits a video asset's in and out points and a
crop rectangle in source pixels, with an optional fast stream-copy mode. Its
header comment calls it "a thin UI over two ffmpeg operations". It never
changes the source file: Apply asks the main process to write a new file into
the deck's `assets/`, and the editor relinks the element to it.

## Interface

- `main.ts`: window controller, no exports. Main pieces: the window `State`
  (`src`, `elementId`, `duration`, `in`, `out`, `crop`, `natural`, `busy`); an
  offscreen frame grabber for the endpoint thumbnails (`requestFrame`,
  `drainFrameQueue`, `grabberReady`, `drawFrame`, `refreshEndpointFrames`);
  crop helpers (`isFullFrame`, `effectiveCrop`, `clampCrop`); and
  `buildRequest()`, which returns the `TrimRequest` (type in
  `src/shared/ipc.ts`).
- IPC used: `window.api.onTrimTarget`, `assetUrl`, `runTrim`,
  `onTrimProgress` (see [preload](../../preload/README.md)). The main-process
  side is `src/main/ffmpeg.ts`.
- `index.html`: video with a crop overlay and eight handles, transport, scrub
  bar with in/out handles, in/out endpoint canvases (320x180), crop X/Y/W/H
  inputs, "Fast trim (stream copy)" checkbox, ffmpeg command preview, progress
  bar, Close and Apply. `trim.css`: window styles.

## Invariants

- The source is never modified. The output is a new asset handed back to the
  editor in one direction only, so the window shares no state with it.
- In and out stay at least 0.05 s apart.
- Playback loops inside `[in, out]`: once `currentTime >= out - 0.02` it
  jumps back to `in`.
- The crop is in source pixels and starts as the full frame on
  `loadedmetadata`. A full-frame crop is not sent to ffmpeg.
- Endpoint frame grabs run one at a time on a single offscreen video. Pending
  requests are keyed by `in`/`out`, so only the latest time per endpoint is
  kept.
- `grabberReady` waits at most 5000 ms and each seek at most 3000 ms, so the
  queue cannot wedge. Seek targets are clamped to `[0, duration - 0.05]`.
- Pointer capture is best-effort; failures are swallowed.

## Side Effects

- Calls `applyUiTheme()` at module load.
- Creates a detached, muted offscreen `<video>` for frame grabs.
- Sets both videos' `src` to `window.api.assetUrl(src)` and `document.title`
  to `Trim & Crop — <filename>`.
- Apply calls `window.api.runTrim(buildRequest())` and listens to
  `onTrimProgress`. Close calls `window.close()`.

## Verification

- Run: `npx vitest run test/cropAndTrim.test.ts test/videoEditing.test.ts test/appChrome.test.ts`
- Full suite: `npm test`
