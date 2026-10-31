# importers

## Overview

This directory holds the Python sidecars that convert presentations from
other apps into DeckWerk deck folders. Each folder contains `deck.json`,
`theme.css`, `assets/` and an empty `edit/`. Both importers follow one process
contract:

- **Invocation.** `<script> <input> --out <deck-dir>` imports the deck,
  `--report` analyses it without writing anything, and `--self-check`
  checks that the dependencies import.
- **Output.** stdout carries one JSON line, `{"dir", "report", "deck"}`.
  Diagnostics and `@progress <ratio|-> <message>` lines go to stderr.
- **Exit codes.** `0` is success, `1` is a failed import or self-check, and
  `2` is a usage error.
- **Failures.** A failure in one slide or shape becomes a placeholder. It
  never fails the whole import.

The Node side runs the importers and validates their output against the deck
schema with `parseDeck`:

- `runImporterSidecar` in
  [`src/main/keynoteImport.ts`](/src/main/keynoteImport.ts), for the desktop
  app,
- [`src/server/collabServer.ts`](/src/server/collabServer.ts), for the collab
  server.

How each environment gets a working importer:

- **In a checkout.** The importers run from source with
  `.venv-import/bin/python`, or `python3` if that venv is missing.
  `.venv-import/` is gitignored.
  [`scripts/setup-importers.mjs`](/scripts/setup-importers.mjs) creates the
  venv from [`requirements.txt`](./requirements.txt), which pins
  `keynote-parser`, `pillow` and `pymupdf`. That script runs on
  `npm install` (postinstall), before the collab server starts (precollab) and
  through `npm run setup:importers`. Setting
  `DECKWERK_SKIP_IMPORTER_SETUP=1` skips it.
  [`scripts/importer-python.mjs`](/scripts/importer-python.mjs) requires
  Python 3.10 or later.
- **In packaged builds.** `npm run build:importer`
  ([`scripts/build-importer.mjs`](/scripts/build-importer.mjs)) uses
  PyInstaller to freeze each script into a self-contained binary in
  `build/importers/`: `keynote-import` and `pptx-import`. The packaged app
  ships these binaries, so it needs no Python.
  [`scripts/assert-importer-fresh.cjs`](/scripts/assert-importer-fresh.cjs)
  stops packaging if a binary is missing or older than its script.

Run `npm test` for the full suite, outside sandboxes as the repository's
`AGENTS.md` describes. `npm run eval:importer` does not cover these importers:
it evaluates the HTML authoring compile.

## Subdirectories & Boundaries

- keynote: [`./keynote/README.md`](./keynote/README.md) converts `.key` files
  (a zip, a package directory or a zipped package) by decoding the `.iwa`
  protobuf streams with `keynote-parser`.
  - Keynote geometry is used as it is, and the canvas is the show's size.
  - Builds become timeline entries.
  - Move builds are split into copy slides that Morph from the original.
  - Tests: `test/keynoteImport.test.ts`, `test/keynoteImportProgress.test.ts`
    and `test/importerRuntime.test.ts`.
- pptx: [`./pptx/README.md`](./pptx/README.md) converts `.pptx` OOXML using
  only the standard library to parse it.
  - EMU coordinates are scaled to a 1920 px wide canvas.
  - Master and layout decoration is imported on every slide as `.pp-layout`
    elements.
  - Animations are not imported, so `timeline` is always empty.
  - Embedded PDFs are rasterised with PyMuPDF.
  - Tests: `test/pptxImport.test.ts` and `test/importerRuntime.test.ts`.
