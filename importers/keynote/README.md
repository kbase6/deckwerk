# Keynote importer (`import_keynote.py`)

## Overview

`import_keynote.py` is a Python sidecar. It converts an Apple Keynote document
into a DeckWerk deck folder containing `deck.json`, `theme.css`, `assets/` and
an empty `edit/`.

It reads Keynote's Snappy-framed protobuf `.iwa` streams with
[`keynote-parser`](../requirements.txt) in pure Python. It does not need
Keynote or any Apple framework, so it also runs on Linux.

The importer does not abort on bad content. A slide or drawable that cannot be
converted becomes a placeholder, and the import continues.

How the importer is run:

- **In a checkout (dev app or collab server).** The Node side runs this script
  with `.venv-import/bin/python`. If that venv does not exist, it falls back to
  `python3`. The callers are
  [`src/main/keynoteImport.ts`](/src/main/keynoteImport.ts) (`importKeynote`,
  `runImporterSidecar`) and
  [`src/server/collabServer.ts`](/src/server/collabServer.ts)
  (`KEYNOTE_IMPORTER`).
- **Setting up the venv.** `npm install` creates the venv from
  [`../requirements.txt`](../requirements.txt) by running
  [`scripts/setup-importers.mjs`](/scripts/setup-importers.mjs). To redo it by
  hand, run `npm run setup:importers`.
- **In a packaged app.** `npm run build:importer`
  ([`scripts/build-importer.mjs`](/scripts/build-importer.mjs)) uses PyInstaller
  to freeze this script into the self-contained binary
  `build/importers/keynote-import`. It collects `keynote_parser`, `snappy` and
  `pymupdf`, because they are loaded dynamically. It then runs the binary with
  `--self-check` to prove it works.
  [`scripts/assert-importer-fresh.cjs`](/scripts/assert-importer-fresh.cjs)
  stops packaging if that binary is missing or older than this script.

## Interface

- **CLI**
  - `import_keynote.py <deck.key> --out <deck-dir>` imports the deck and writes
    the folder.
  - `import_keynote.py <deck.key> --report` analyses the deck and writes
    nothing. The JSON it prints has `"dir"` set to `os.devnull` and `"deck"`
    set to `null`.
  - `import_keynote.py --self-check` is recognised only when it is the only
    argument. It checks that these modules import: `keynote_parser.codec`,
    `PIL.Image`, `PIL.ImageChops`, `PIL.ImageFont` and `pymupdf`. It then
    prints `ok`.
- **Accepted input:**
  - a single-file `.key` zip,
  - a `.key` package directory. Its `Index.zip` is mounted in memory as
    `Index/`.
  - a zipped package. The importer drops the `<name>.key/` wrapper folder and
    ignores `__MACOSX/` entries.

  Keynote '09 files (`index.apxl`) are rejected with a message asking the user
  to re-save the file in a current Keynote.
- **`main(argv) -> int`** is the CLI entry. It runs the import with stdout
  redirected to stderr. It then prints one JSON line to stdout:
  `{"dir", "report", "deck"}`.
- **`import_key(path, out_dir, write, progress=None) -> (deck, Report)`** is the
  library-level entry. It opens the package and decodes its objects. It then
  converts the slides, splits slides at Move builds and classifies text roles.
  It writes the folder only when `write` is true.
- **`self_check() -> int`** is the import probe behind `--self-check`.
- **Reading the package:**
  - `class Package` gives read-only access to every accepted `.key` shape
    (`names`, `read`, `close`). It repairs UTF-8 member names that lack the
    zip UTF-8 flag and NFC-normalises all member names.
  - `load_objects(pkg, report, progress)` decodes the `.iwa` streams into a
    dict of protobuf objects, keyed by object id.
  - `data_file_table(objects)` maps data ids to file names under `Data/`.
- **`class Importer`** does the per-deck conversion:
  - Slides: `convert_slide`, `slide_background` and `_slide_notes`.
  - Drawables: `convert_drawable`.
  - Builds: `_convert_builds`, which turns Keynote builds into `timeline`
    entries.
  - Media: `copy_data`, which extracts and converts assets and caches each
    result per data id.
- **`split_at_moves(slide, report) -> list[slide]`** handles Keynote Move
  builds. It continues the slide on copies that Morph in from it, with ids
  `<slide-id>-m<n>` and `morphFromPrevious: true`. Each object keeps one
  `morphId` across the copies.
- **`_classify_text_roles(slides)`** assigns `role-*` classes across the whole
  deck, using the median body font size as its scale.
- **`class Report`, `class Progress` and `class SilentProgress`** are the same
  report and stderr progress classes as in the PowerPoint importer.
- **Constants:** `THEME_CSS`, `DEFAULT_CANVAS` (1920x1080), `RASTER_CONVERT`,
  `WEB_SAFE_IMAGE`, `VIDEO_EXTS`, `PDF_EXTS` and `WEB_SAFE_VIDEO_CODECS`.

## Invariants

- **Process protocol.** stdout carries exactly one JSON document. Diagnostics,
  tracebacks and `@progress <ratio|-> <message>` phases go to stderr. This
  protocol is shared with [`../pptx`](../pptx/README.md) and parsed by
  `runImporterSidecar` and `createStderrReader` in
  [`src/main/keynoteImport.ts`](/src/main/keynoteImport.ts).
  `test/keynoteImportProgress.test.ts` guards it. Do not `print` to stdout
  during an import.
- **Exit codes:**

  | Code | When |
  | --- | --- |
  | `0` | Success. |
  | `1` | The input has no decodable objects or no ShowArchive (the message goes to stderr). |
  | `1` | Any other exception (the traceback goes to stderr). |
  | `1` | `--self-check` finds missing modules. |
  | `2` | The input path is missing. |
  | `2` | `--out` is missing and `--report` is not given. |
  | `2` | `keynote-parser` cannot be imported when the module loads, with any arguments, including `--self-check`. |

- **Geometry:**
  - Keynote coordinates are used as they are. They are not rescaled to a fixed
    size.
  - The canvas is the show's `size`, or 1920x1080 if the show has no size.
  - Each element's box is the Keynote position and size, offset by the
    origin of any enclosing group.
  - `w` and `h` are never less than 1.
  - Rotation is negated, because Keynote measures it anticlockwise and the
    deck clockwise, and is then normalised.
  - `x`, `y`, `w`, `h` and `rot` are rounded to 2 decimals.
  - `_clamp_text_box` keeps text boxes on the canvas.
- **Ids:**
  - Slide ids are `slide-<n>`, where `n` is the 1-based position in the slide
    tree.
  - Element ids are `<type>-<n>` and build ids are `build-<n>`. All of them
    come from one counter for the whole import.
- **Schema:**
  - The deck has `"version": 1` and `"theme": "theme.css"`.
  - Slide order follows the Keynote slide tree.
  - Skipped slides are kept and flagged `skipped: true`.
  - The Node side validates the deck with `parseDeck` from
    [`src/shared/deck.ts`](/src/shared/deck.ts), so the output must satisfy
    that schema.
- **Failure isolation:**
  - A slide that throws is replaced by an empty `Slide N (failed to import)`
    and counted as `unsupported["<slide>"]`.
  - An unrecognised drawable becomes an `unsupported` element that keeps its
    geometry.
- **Media:**
  - Media is written once per data id.
  - A file that already exists in `assets/` is never overwritten. If two
    sources map to the same safe file name, the first one written wins.
  - TIFF, BMP, TGA and HEIC images are converted to PNG.
  - PDF and EPS files are rasterised with PyMuPDF.
  - A video whose codec is not web-safe is transcoded to `<stem>.h264.mp4`.
- **Theme.** `theme.css` is written only if it does not already exist.
- **Dry run.** `--report` must not touch the filesystem.

## Side Effects

- **Disk:** with `--out`, the importer:
  - creates `<out>/`, `assets/` and `edit/`,
  - always overwrites `deck.json`,
  - writes `theme.css` only if it is missing,
  - writes media into `assets/`. When a `.h264.mp4` version of a video
    already exists, the importer may delete the original video.

  `--report` writes nothing.
- **Subprocesses** (each is optional: the importer checks `shutil.which` first
  and degrades with a warning if the tool is missing):
  - `ffprobe` (60 s timeout) and `ffmpeg` (600 s timeout), to check video
    codecs and transcode video,
  - `fc-match`, to find a font file for measuring text width.
- **Network:** none.
- **Environment variables:** none read.
- **Process-wide:** the module calls `warnings.simplefilter("ignore")` at import
  time.

## Verification

- `npx vitest run --config vitest.serial.config.ts test/keynoteImport.test.ts` runs the import regressions. To
  run the corpus case, set `KEYNOTE_FIXTURES` to a folder of `.key` files.
  Cases whose fixture is missing skip themselves, but a missing venv makes the
  suite fail.
- `npx vitest run test/keynoteImportProgress.test.ts` checks the stderr phase
  channel.
- `npx vitest run test/importerRuntime.test.ts` checks that the venv exists and
  that a Keynote deck imports the way the collab server imports it.
- `test/collabKeynoteImportBrowser.test.ts` is an Electron browser-tier suite
  that covers the upload user interface. It uses a stub adapter instead of
  this script. Run it with
  `npx vitest run --config vitest.browser.config.ts test/collabKeynoteImportBrowser.test.ts`.
- Full suite: `npm test`, run outside sandboxes as the repository's
  `AGENTS.md` describes. `npm run eval:importer` does not cover this
  directory: it evaluates the HTML authoring compile.
