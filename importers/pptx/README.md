# PowerPoint importer (`import_pptx.py`)

## Overview

`import_pptx.py` is a Python sidecar. It converts a PowerPoint `.pptx` file
into a DeckWerk deck folder containing `deck.json`, `theme.css`, `assets/` and
an empty `edit/`. A `.pptx` is a zip of OOXML parts, so the importer reads it
with the standard library's `zipfile` and `xml.etree.ElementTree`. Unlike the
Keynote importer, it needs no third-party decoder.

The importer does not abort on bad content. A slide or shape that cannot be
converted becomes a placeholder, and the import continues.

How the importer is run:

- **In a checkout (dev app or collab server).** The Node side runs this script
  with `.venv-import/bin/python`. If that venv does not exist, it falls back to
  `python3`. The callers are
  [`src/main/pptxImport.ts`](/src/main/pptxImport.ts) (`importPowerPoint`) and
  [`src/server/collabServer.ts`](/src/server/collabServer.ts)
  (`POWERPOINT_IMPORTER`).
- **Setting up the venv.** `npm install` creates the venv from
  [`../requirements.txt`](../requirements.txt) by running
  [`scripts/setup-importers.mjs`](/scripts/setup-importers.mjs). To redo it by
  hand, run `npm run setup:importers`.
- **In a packaged app.** `npm run build:importer`
  ([`scripts/build-importer.mjs`](/scripts/build-importer.mjs)) uses PyInstaller
  to freeze this script into the self-contained binary
  `build/importers/pptx-import`. It collects `PIL` and `pymupdf`, then runs the
  binary with `--self-check` to prove it works.
  [`scripts/assert-importer-fresh.cjs`](/scripts/assert-importer-fresh.cjs)
  stops packaging if that binary is missing or older than this script.

## Interface

- **CLI**
  - `import_pptx.py <input.pptx> --out <deck-dir>` imports the deck and writes
    the folder.
  - `import_pptx.py <input.pptx> --report` analyses the deck and writes nothing.
    The JSON it prints has `"dir"` set to `os.devnull` and `"deck"` set to
    `null`.
  - `import_pptx.py --self-check` is recognised only when it is the only
    argument. It checks that `PIL.Image` and `pymupdf` import, then prints
    `ok`.
- **`main(argv) -> int`** is the CLI entry. It parses the arguments with
  argparse and runs `import_pptx` with stdout redirected to stderr. It then
  prints one JSON line to stdout: `{"dir", "report", "deck"}`.
- **`import_pptx(path, out_dir, write, progress=None) -> (deck, Report)`** is the
  library-level entry. It opens the package, computes the canvas, converts each
  slide, classifies text roles and builds the deck dict. It writes the folder
  only when `write` is true.
- **`self_check() -> int`** is the import probe behind `--self-check`.
- **`class Importer`** does the per-deck conversion:
  - Slides: `convert_slide`, `slide_background`, `slide_notes`.
  - Shapes: `convert_shape_tree`, `convert_sp`, `convert_picture`,
    `convert_text`, `convert_graphic_frame`, `convert_table` and
    `convert_connector`.
  - Media: `copy_media` and `_ensure_playable_video`.
  - Embedded OLE objects: `ole_pdf` and `ole_preview`.
  - Units: `emu_to_px` and `pt_to_px`.
- **`class Package`** gives read-only access to the OPC zip, with cached XML
  parsing and relationship resolution (`read`, `xml`, `rels`, `target`,
  `related`).
- **`class Report`** collects counts and warnings for the JSON report.
  `to_dict()` returns these keys: `slides`, `elements`, `unsupported`,
  `converted_images`, `cropped_images`, `transcoded_videos`, `autosized_boxes`
  and `warnings`. The `warnings` list is capped at 200 entries.
- **`class Progress` and `class SilentProgress`** write the stderr
  `@progress <ratio|-> <message>` lines. `--report` mode uses the silent
  variant.
- **Helpers:**
  - DrawingML decoding: `resolve_color`, `read_fill`, `read_line`,
    `load_theme`, `read_run_props`, `read_para_props` and `read_xfrm`.
  - SVG path generation: `preset_path` and `custom_geometry_path`.
  - OLE (Compound File Binary) reading: `compound_file_streams` and
    `embedded_pdf`.
  - Text: `TextConverter` and `_classify_text_roles`.

## Invariants

- **Process protocol.** stdout carries exactly one JSON document. Diagnostics,
  tracebacks and `@progress` phases go to stderr. The Keynote importer uses the
  same protocol, and the shared `runImporterSidecar` in
  [`src/main/keynoteImport.ts`](/src/main/keynoteImport.ts) depends on it. Do
  not `print` to stdout during an import.
- **Exit codes:**

  | Code | When |
  | --- | --- |
  | `0` | Success. |
  | `1` | The input is not a zip or has no presentation part (the message goes to stderr). |
  | `1` | Any other exception (the traceback goes to stderr). |
  | `1` | `--self-check` cannot import Pillow or PyMuPDF. |
  | `2` | The input file is missing. |
  | `2` | `--out` is missing and `--report` is not given. |

- **Geometry:**
  - The canvas width is always 1920 px. The scale is `1920 / sldSz.cx` px per
    EMU, and the height follows the deck's aspect ratio. With the default
    16:9 slide size the canvas is 1920x1080.
  - Font sizes convert as `pt_to_px = pt * 12700 * scale`.
  - `x`, `y`, `w`, `h` and `rot` are rounded to 2 decimals, and `w` and `h`
    are never less than 1.
- **Paint order.** `z` is the element's paint-order index within its slide, in
  this order:
  1. the background image,
  2. master shapes,
  3. layout shapes,
  4. slide shapes.

  Master and layout decoration is imported onto every slide as ordinary
  elements tagged `.pp-layout`. The importer respects `showMasterSp`.
- **Ids.**
  - Slide ids are `slide-<n>`, where `n` is the 1-based slide number.
  - Element ids are `<type>-<n>`, taken from one counter for the whole
    import, so element ids are unique across the deck.
- **Schema:**
  - The deck has `"version": 1` and `"theme": "theme.css"`.
  - Every slide has `"timeline": []`, because animations are not imported.
  - A slide hidden in PowerPoint gets `skipped: true`.
  - Notes are the plain text of the notes slide's body.
  - The Node side validates the deck with `parseDeck` from
    [`src/shared/deck.ts`](/src/shared/deck.ts), so the output must satisfy
    that schema.
- **Failure isolation:**
  - A slide that throws is replaced by an empty `Slide N (failed to import)`.
  - An unrecognised shape becomes an `unsupported` element that keeps its
    geometry and is counted in `report.unsupported`.
- **Media:**
  - Media is deduplicated per package part.
  - A file that already exists in `assets/` is never rewritten.
  - These formats are converted to PNG: TIFF, BMP, TGA, HEIC, EMF and WMF.
  - A video is transcoded to `<stem>.h264.mp4` only if its codec is not h264,
    vp8, vp9, av1 or theora, or its container is not mp4, m4v, webm or mov.
- **Theme.** `theme.css` is written only if it does not already exist.

## Side Effects

- **Disk:** with `--out`, the importer:
  - creates `<out>/`, `assets/` and `edit/`,
  - always overwrites `deck.json`,
  - writes `theme.css` only if it is missing,
  - writes media into `assets/`. A raw EMF or WMF file is placed there only
    while it is being converted and is then deleted. After a successful
    transcode, the original video is deleted.

  `--report` writes nothing.
- **Subprocesses** (each is optional: the importer checks `shutil.which` first
  and records a warning if the tool is missing):
  - `ffprobe` and `ffmpeg`, to check video codecs and transcode video,
  - `inkscape`, then `magick` or `convert` as a fallback, to rasterise EMF and
    WMF files.

  All of these run with timeouts.
- **Network:** none.
- **Process-wide:** the module calls `warnings.simplefilter("ignore")` at import
  time.

## Verification

- `npx vitest run --config vitest.serial.config.ts test/pptxImport.test.ts` checks the reference fixture
  `test/fixtures/pptx/reference.pptx`. `make_reference.py` generates that
  fixture with known positions: 144 px per inch and 2 px per point. To also run
  the corpus check, set `PPTX_FIXTURES` to a folder of real `.pptx` files.
- `npx vitest run test/importerRuntime.test.ts` checks that the venv exists and
  that a PowerPoint deck imports the way the collab server imports it.
- Full suite: `npm test`, run outside sandboxes as the repository's
  `AGENTS.md` describes. `npm run eval:importer` does not cover this
  directory: it evaluates the HTML authoring compile.
