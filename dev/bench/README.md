# dev/bench

## Overview

Benchmarks you run by hand. They measure things and are not tests. This
folder holds one script, `presentVideoBench.mts`. It measures how long a real
deck's videos take to show a first frame and to start playing in the audience
view (`present.html`, served by the collab server) when Chromium runs over a
throttled link. It is the benchmark behind the before and after numbers in
[docs/media-loading.md](../../docs/media-loading.md).

`npm test` does not run it, no `package.json` script calls it, and
`tsconfig.json` does not `include` it. Type errors show up only when you run
it.

## Interface

- `presentVideoBench.mts`: a CLI entry point with no exports. It runs `main()`
  at import and exits with `0` on success or `1` on any error.

  ```bash
  npx vite-node --config vitest.config.ts dev/bench/presentVideoBench.mts -- \
    --deck "/path/to/Some talk/deck" --kbps 5000 --slides 1-12
  ```

  | Flag | Default | Meaning |
  | --- | --- | --- |
  | `--deck <dir>` | required | Deck folder. It must contain `deck.json` and an `assets/` folder. |
  | `--kbps <n>` | `5000` | Throughput in kbit/s, applied up and down with 30 ms latency through CDP `Network.emulateNetworkConditions`. |
  | `--slides <a-b>` or `<n>` | `1-10` | 1-based positions in `deck.json`'s `slides` array. |
  | `--dwell <ms>` | `4000` | Wait after each slide's measurement. |
  | `--settle <ms>` | `20000` | Longest wait for every video on a slide to play. |
  | `--cold` | off | Load `present.html?slide=<n>` fresh for each slide instead of pressing ArrowRight to reach it. |
  | `BENCH_DEBUG` (env) | unset | Print a DOM probe (stages, video counts, body prefix) after the first paint. |

- Output goes to stdout as one block headed `=== <kbps> kbit/s, <deck name> ===`.
  - The first line is `open  : <s>s to the first slide painting`.
  - Each video then gets one row: `slide <n>  <s> frame  <s> playing  rs=<readyState> buf=<s>s  <file name>`.
  - The other row forms are `never`, `(no videos)`, and `never reached (player on <n>)`.
  - **frame** is the first poll after the slide arrives at which the video's `readyState >= 2`.
  - **playing** is the first poll at which the video is not paused and its `currentTime` has moved more than 0.15 s past its first sample.
  - Polls run every 100 ms. Times count from the moment the player reports the target slide id.
- Dependencies:
  - `startCollabServer` from [src/server/collabServer.ts](../../src/server/collabServer.ts).
  - `Cdp`, `electronBinary`, `findTarget`, `launchBrowser`, `stopBrowser` and `wait` from [test/support/browserSession.ts](../../test/support/browserSession.ts).
  - `collabClientDir` from [test/support/collabClient.ts](../../test/support/collabClient.ts).

## Invariants

- **The source deck is never written to.** The script serves a scratch copy of
  the deck under the id `bench`:
  - `deck.json` and any top-level `*.json` or `*.css` file are copied.
  - Other top-level entries are symlinked.
  - Each entry in `assets/` is hard-linked.
- **Assets must be hard links.**
  - Not symlinks: the server refuses an asset path that resolves outside the
    deck folder.
  - Not copies: a copy gets a new mtime. The mtime is part of the rendition
    cache key, so the benchmark would measure an unprepared deck.
- **The scratch root must be on the deck's filesystem**, because hard links
  cannot cross filesystems. The scratch root is
  `${XDG_CACHE_HOME:-~/.cache}/deckwerk/bench-*`, not the OS temp directory.
  If a link fails (for example cross-device, or a subdirectory inside
  `assets/`), the run aborts. It never falls back to copying.
- **Navigation is by slide id.** Arrow keys step through builds as well as
  slides, so the walk presses ArrowRight until the page's `[data-slide-id]`
  equals `slides[n-1].id`. After 60 s it reports `never reached`. A slide the
  present view does not show, such as a skipped slide, therefore reports
  `never reached`.
- An Electron binary must be installed. Without one, `electronBinary` is empty
  and the script throws `no Electron binary`.

## Side Effects

- It builds the production collab client with Vite through `collabClientDir()`
  and sets `VITE_RENDER_INVARIANTS=1` in the process environment. The browser
  test tiers share this cached build: it is keyed by content hash and stored
  under the OS temp directory.
- It starts the collab server on `127.0.0.1` with an ephemeral port, serving
  the scratch decks folder.
- It launches Electron/Chromium with a throwaway profile inside the scratch
  root. It drives the page over CDP: network throttling, navigation, and
  synthetic ArrowRight key events.
- It creates the scratch root, then deletes it in `finally`. It also closes
  the page, the browser, and the server. A killed process can leave
  `bench-*` folders behind.
- It ends with `process.exit`.

## Verification

- No suite runs this script. To smoke-test it, run it against the bundled
  deck (`decks/demo-deck`; it needs Electron and a localhost port):
  `npx vite-node --config vitest.config.ts dev/bench/presentVideoBench.mts -- --deck "$PWD/decks/demo-deck" --slides 1-3`
- The behaviour it measures is covered by
  `npx vitest run test/mediaLoading.test.ts test/presentVideosFromMemory.test.ts test/collabMediaDelivery.test.ts`.
- Full suite: `npm test`.
