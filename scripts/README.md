# scripts

## Overview

Node entry points and helpers for building, packaging, testing, evaluating and
serving DeckWerk. Most files are executables that `package.json` scripts,
electron-builder hooks, CI workflows or `src/cli/*` launch. Nothing here is
bundled into the app. There are three kinds of file:

- **Node entry points** (`.mjs`, `.cjs`, and `.mts` run through
  `vite-node --config vitest.config.ts`). They import application code from
  `src/` directly.
- **Electron job scripts** (`.cjs`). Callers run them as
  `electron <script> <job.json>`. Each one reads a JSON job from `argv[2]`,
  works in offscreen windows, and writes PNG, PDF or JSON results to paths the
  job names.
- **Shared helpers** that other scripts and tests import:
  `electron-binary.cjs`, `pixel-compare.cjs` and `importer-python.mjs`.

## Interface

### Install, build and packaging

| File | Run by | What it does |
| --- | --- | --- |
| `setup-importers.mjs` | `postinstall`, `npm run setup:importers`, `precollab` | Sets up `.venv-import` for the Keynote/PPTX importers through `ensureImporterVenv`. |
| `importer-python.mjs` | imported by `build-importer.mjs` and `setup-importers.mjs` | Exports `VENV`, `REQUIREMENTS`, `IMPORTER_SCRIPTS`, `venvExe(root, name)`, `findPython()`, `PYTHON_MISSING`, `importerProblems(root, python)` and `ensureImporterVenv(root, { extraPackages, log })`. |
| `build-importer.mjs` | `npm run build:importer` (also run by every `dist*` script) | Freezes the importers with PyInstaller into `build/importers/`. |
| `assert-importer-fresh.cjs` | electron-builder `beforePack` (`electron-builder.config.cjs`) | `assertImporterFresh(context)`: throws if a frozen importer is missing or older than its `.py` source. |
| `adhoc-sign-mac.cjs` | electron-builder `afterPack` | `adhocSignMac(context)`: on macOS builds with no signing identity, runs `codesign --force --deep --sign -` and then `codesign --verify --deep --strict`. |
| `build-katex-inline.mts` | `npm run build:katex` | Generates `src/shared/katexInline.ts` (`KATEX_JS`, `KATEX_AUTO_RENDER_JS`, `KATEX_CSS`, with fonts inlined as `data:` URIs) from the installed `katex/dist`. |
| `build-agent-reference.mts` | `npm run build:reference` | Builds `decks/agent-reference` (one slide per entry in `src/shared/capabilities.ts`). |
| `build-site.mjs` | `npm run build:site`, `.github/workflows/site.yml` | Deletes `dist-site/` and copies `site/` into it. |
| `render-homebrew-cask.mjs` | `.github/workflows/release.yml` | `<version> <x64.dmg> <arm64.dmg>`: prints the Homebrew cask, with sha256 sums computed from the local dmgs. |
| `render-flatpak-manifest.mjs` | `.github/workflows/release.yml` | `<version> <linux-x64.tar.gz> [manifest]`: rewrites the first archive source's `url:` and `sha256:` in `flatpak/org.deckwerk.DeckWerk.yml`. |

### CLI and server entry points

| File | Run by | What it does |
| --- | --- | --- |
| `slide-agent.mts` | `npm run agent -- <command>`, `bin/slide-agent` | Calls `runAgentCli` (`src/cli/agentCli.ts`), flushes stdout/stderr and exits with the CLI's code. |
| `collab-server.mts` | `npm run collab -- <decksRoot> [--port 5800] [--host] [--no-local-agents] [--agent-name] [--access <adminLogin>] [--keep-uploads-days <n>]` | Starts `startCollabServer` (`src/server/collabServer.ts`) with a `LocalAgentRegistry`. |
| `check-collab-environment.cjs` | `precollab` | Exits 1 if the Electron binary is missing or Node is older than 22.23.4, 24.22.1 or 26.12.1 for its major line. |
| `export-deck.mts` | `npm run export -- <deck> <out> [--quality original\|balanced\|compact] [--no-thumbnail]` | Writes a web export through `exportDeck` and a `thumbnail.jpg` through `writeExportThumbnail`. |
| `prepare-media.mts` | `npm run prepare:media -- <deck-or-root>...` | Builds video streaming renditions ahead of time, for every `deck.json` found up to 3 levels deep, using `RenditionStore`. |

### Electron job scripts (`electron <script> <job.json>`)

| File | Launched from | What it does |
| --- | --- | --- |
| `compile-slides.cjs` | `src/cli/compileHtml.ts` | Lays out authored HTML pages in one offscreen window and writes the measurement result. The measuring function is passed in through the job. |
| `render-html-draft.cjs` | `src/cli/compileHtml.ts` | Renders one `.slide` of an HTML draft to PNG. The collab server uses it when running under Node. |
| `capture-slides.cjs` | `src/cli/renderSlides.ts` (`slide-agent render`) | Screenshots slides of an exported player bundle to PNG, optionally annotated. |
| `check-web-page.cjs` | `src/cli/renderSlides.ts` (`slide-agent web check`) | Runs one page sandboxed and prints a JSON report of console errors, failed loads and refused remote requests, with an optional screenshot. |
| `compare-slides.cjs` | `src/cli/compareExport.ts` | Pixel-compares the exported player's rendering with the authoring HTML's (default tolerance 24). |
| `compare-pdf.cjs` | `test/pdfLooksLikePlayer.test.ts` | Exports each deck to PDF, rasterises the pages with the job's Python, and pixel-compares them with the player (default tolerance 32). |
| `pdf-fidelity-preload.cjs` | preload for `compare-pdf.cjs` | Exposes `window.api` (`getDeck`, `loadTheme`, `assetUrl`, `pdfReady`), set up from `--pdf-fidelity-job` and `--deck-index`. |
| `compare-scratchpad.cjs` | `test/scratchpadRenderingBrowser.test.ts` | Checks that scratchpad HTML matches in pixels and geometry with and without the injected chrome, and writes `outPath` JSON. |
| `eval-browser.cjs` | `test/support/browserSession.ts` | `<url> <debug-port=9222> [profile-dir]`: a test browser with a remote-debugging port, no background throttling, and autoplay allowed. |

### Test, evaluation and benchmark tooling

| File | Run by | What it does |
| --- | --- | --- |
| `run-test-tiers.cjs` | `npm test`; `npm test -- <unit\|browser\|serial>...` runs only the named tiers | Runs `vitest run` with the default, `vitest.browser.config.ts` and `vitest.serial.config.ts` configs in that order, then prints a summary. |
| `check-test-environment.cjs` | `pretest`, `pretest:browser`, `pretest:serial`, `pretest:long`, `pretest:performance`, `pretest:agents:fuzz` | Fails fast if the Electron binary is missing or binding to localhost is denied. |
| `electron-binary.cjs` / `.d.cts` | imported by both `check-*-environment.cjs`; `test/electronBinary.test.ts` | `findElectronBinary(resolve?) -> string`: the binary's path, or `''` if it is missing. Never throws. |
| `pixel-compare.cjs` | imported by `compare-pdf.cjs`; `test/pixelCompare.test.ts` | `comparePixelBuffers(reference, actual, width, height, { channelTolerance, edgeChannelTolerance, highToleranceAreas, radius })` compares BGRA buffers and allows for anti-aliasing fringes. It is pure. |
| `eval-importer-regressions.mts` | `npm run eval:importer` | Compiles the fixtures in `test/fixtures/html-import` and checks each slide against its native-element ratio, pixel-difference and overflow thresholds. |
| `stress-html-import.mts` | `npx vite-node --config vitest.config.ts scripts/stress-html-import.mts -- page.html` | Reports what every authored region compiled to, and why any region fell back. It reports only and asserts nothing. |
| `serve-agent-benchmark.mts` | `npm run eval:agent:serve` | Seeds the `agent-design-gap-benchmark` deck and serves it (env `AGENT_BENCHMARK_OUTPUT`, `AGENT_BENCHMARK_PORT`, default 5803). |
| `serve-paper-benchmark.mts` | `npm run eval:papers:serve` | Seeds the `paper-showcase-benchmark` deck and serves it (env `PAPER_BENCHMARK_OUTPUT`, `PAPER_BENCHMARK_PORT`, default 5806). |
| `serve-edit-benchmark.mts` | `npm run eval:edits:serve` | Imports a Keynote file, or uses an existing deck, and serves it (env `EDIT_BENCHMARK_EXISTING_DECK`, `_OUTPUT`, `_PORT` (default 5810), `_KEYNOTE`, `_TASK`). |
| `trace-deck-command.mjs` | run by hand: `node scripts/trace-deck-command.mjs <trace.jsonl> -- <command...>` | Runs a CLI command without changing its output, and appends a JSONL record of the command, its streams, exit status and wall time. |

## Invariants

- Exit codes: usage errors exit 2 (`export-deck`, `render-flatpak-manifest`,
  `render-homebrew-cask`, `trace-deck-command`). Failed preflights and setup
  exit 1.
- Missing Electron is a failure, never a skip.
  `check-test-environment.cjs` exits 1 without the Electron binary. Set
  `SKIP_ELECTRON_CHECK=1` to skip that check deliberately and run only the
  unit tier. It also exits 1 when binding `127.0.0.1` is denied, as it is in
  restricted agent sandboxes.
- `run-test-tiers.cjs` runs every selected tier even after a tier fails, and
  exits 1 if any tier failed.
- Packaging aborts if `build/importers/{keynote-import,pptx-import}[.exe]` is
  missing or older than `importers/{keynote,pptx}/import_*.py`, or if ad-hoc
  `codesign --verify` fails. Ad-hoc signing runs only for `darwin` with
  `identity === null`.
- `setup-importers.mjs` does nothing (exit 0) when
  `DECKWERK_SKIP_IMPORTER_SETUP=1` is set, when installed under
  `node_modules`, or when `importers/requirements.txt` is absent.
- The importer venv is `.venv-import`. Its stamp is a sha256 of the
  requirements and the interpreter. Python 3.10+ is needed only at build
  time; frozen importers carry their own interpreter.
- `src/shared/katexInline.ts` is generated: regenerate it with
  `npm run build:katex` instead of editing it.
- `comparePixelBuffers` throws when the two buffers differ in length or when
  either length is not `width * height * 4`.
- `stress-html-import.mts` wipes its output directory only if that directory
  contains the `.html-import-stress` marker, and throws otherwise.
- `prepare-media.mts` writes renditions to a cache outside the deck, never
  into `assets/`.
- `slide-agent.mts` flushes stdout and stderr before `process.exit`, so piped
  JSON output is never truncated.
- Homebrew and Flatpak checksums are computed from local release files and
  never fetched.

## Side Effects

- **Processes:** `npx vitest` (`run-test-tiers`), `pyinstaller`, `python`
  and `pip` (`build-importer`, `importer-python`), `codesign`
  (`adhoc-sign-mac`), `electron` (every job script, plus
  `eval-importer-regressions`), and the wrapped command
  (`trace-deck-command`).
- **Ports:** `collab-server.mts` binds `--port` (default 5800). The benchmark
  servers bind 5803 (agent), 5806 (paper) and 5810 (edit). `eval-browser.cjs`
  opens a Chromium remote-debugging port (default 9222) with
  `remote-allow-origins=*`. `check-test-environment.cjs` briefly binds an
  ephemeral port on `127.0.0.1`.
- **Filesystem writes:** `.venv-import/` (created, or deleted and recreated),
  `build/importers/`, `dist-site/` (deleted and recreated),
  `src/shared/katexInline.ts`, `decks/agent-reference/`, the flatpak manifest
  (rewritten in place), the export directory and `thumbnail.jpg`,
  `artifacts/<benchmark>/<timestamp>/`, `artifacts/importer-regression/`
  (`IMPORTER_REGRESSION_OUTPUT`), `artifacts/html-import-stress/`
  (`STRESS_OUTPUT`), the rendition cache, the trace `.jsonl` file (appended),
  and the PNG, PDF and JSON paths named in Electron jobs.
- **Collab server:** keeps uploads under `<decksRoot>/.uploads/` (30 days by
  default). With `--access`, it reads Tailscale identity headers and an
  `access.json` sidecar.

## Verification

- Full run: `npm test`. This runs `check-test-environment.cjs` and then
  `run-test-tiers.cjs`. Run it outside restricted sandboxes.
- Unit tests for the shared helpers, plus the `.venv-import` that
  `setup-importers.mjs` creates:
  `npx vitest run test/electronBinary.test.ts test/pixelCompare.test.ts test/importerRuntime.test.ts`
- Electron-backed scripts:
  `npx vitest run --config vitest.browser.config.ts test/pdfLooksLikePlayer.test.ts test/scratchpadRenderingBrowser.test.ts test/agentCli.test.ts test/webElement.test.ts test/collabServer.test.ts`
