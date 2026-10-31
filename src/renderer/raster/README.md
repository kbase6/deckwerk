# renderer/raster

## Overview

The "Raster Paint" window of the desktop app (the `raster` entry in
`electron.vite.config.ts`). It paints brush strokes over an image asset. Strokes
are kept as vector data with undo, redo and reset, and the source file is
never changed: "Apply as new image" encodes the canvas as a PNG and sends it to
the main process with `window.api.saveRaster`.

## Interface

- `BrushShape` (`painting.ts`): `'round' | 'square'`.
- `PaintPoint` (`painting.ts`): `{x, y}` in bitmap pixels.
- `PaintStroke` (`painting.ts`): `{color, size, shape, points[]}`.
- `bitmapPoint(clientX, clientY, rect, bitmapWidth, bitmapHeight)`
  (`painting.ts`): maps a point on the displayed canvas to a backing-bitmap
  pixel.
- `paintSegment(ctx, from, to, size, shape, color)` (`painting.ts`): stamps
  the brush along a segment every `max(0.5, size / 5)` pixels, so fast drags
  leave no gaps.
- `paintStroke(ctx, stroke)` (`painting.ts`): replays a whole stroke; a
  single point is one stamp.
- `pixelHex(pixel)` (`painting.ts`): clamps RGB to 0-255 and returns
  `#rrggbb`.
- `main.ts`: window controller, no exports. Uses `window.api.onRasterTarget`,
  `assetUrl` and `saveRaster` (see [preload](../../preload/README.md);
  `RasterTarget` type in `src/shared/ipc.ts`).
- `index.html`: colour input, eyedropper, brush shape and size (1-200,
  default 24), undo/redo/reset, canvas with a brush cursor, Close and Apply.
  `raster.css`: window styles.

## Invariants

- The original image is never modified. Apply sends
  `{...target, width, height, png}` through `saveRaster`.
- The canvas is always the source image plus every committed stroke,
  replayed in order.
- Starting a stroke clears the redo stack. Reset moves the strokes into redo
  in reverse order.
- Loading an image resets strokes and redo and sizes the canvas to the image's
  natural size.
- While a save is running, pointer-down and Apply are ignored and all buttons
  are disabled.
- The native EyeDropper API is tried first (`AbortError` means the user
  cancelled). Otherwise the window switches to a pick-from-image mode that
  samples a clamped pixel with `getImageData`.
- Images that fail to load (for example PDF) show an error status.

## Side Effects

- Calls `applyUiTheme()` at module load.
- Creates a 2D canvas context with `willReadFrequently: true` (throws if
  unavailable).
- Sets `document.title` to `Raster Paint — <filename>`.
- Sends the PNG over IPC with `window.api.saveRaster`, then closes the window
  550 ms after a successful save. Close calls `window.close()`.

## Verification

- Run: `npx vitest run test/rasterEditor.test.ts test/appChrome.test.ts`
- Full suite: `npm test`
