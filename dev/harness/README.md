# dev/harness

## Overview

Development-only Vite pages that mount the **real** renderer UI in an ordinary
browser: the editor canvas and slide rail, the Inspector and Build panels, the
Player, the Trim & Crop window, and the agent chat panel. Each page replaces the
Electron preload bridge (`window.api`) with a stub, so you can inspect layout
and pointer behaviour directly or drive them with browser automation. The
`harness*` entries in `.claude/launch.json` start this server.

None of this ships. Electron-vite does not build these pages, `tsconfig.json`
does not `include` them, and no test loads them. When a `src/` API changes,
the harness breaks only when someone next opens the page (see Invariants).

## Interface

Start the server. Its Vite root is the project root
([vite.harness.config.ts](../../vite.harness.config.ts)), and `@shared`
resolves to `src/shared`:

```bash
npx vite --config vite.harness.config.ts --port 5601 --strictPort
# then open http://localhost:5601/dev/harness/<page>.html
```

| Page | Boot module | Mounts | `window` handles | Query params |
| --- | --- | --- | --- | --- |
| `editor.html` | `editor-boot.ts` | `EditorStore`, `SlideRail`, `EditorCanvas` and `SpeakerNotesDrawer` on `emptyDeck('Harness')`. Slide 1 holds `text-1` and a looping muted `video-1`. Slide 2 (`slide-2`) is empty and has notes. | `store`, `rail`, `canvas`, `notes` | none |
| `inspector.html` | `inspector-boot.ts` | `EditorCanvas`, `Inspector` and `TimelinePanel`, joined by `wireCanvasInspector`. The deck has one element of each kind (title, list body, table, image, video, rect, arrow, html) and three timeline entries. | `store`, `canvas`, `inspector`, `pick(ids)`, `tab('inspector' \| 'timeline')` | none |
| `player.html` | `player-boot.ts` | `Player` for `/<deck>/deck.json`, with `/<deck>/theme.css` injected. ArrowRight or Space calls `next()`; ArrowLeft calls `prev()`. | `player` | `deck` (default `decks/animation-reference`), `duration` (ms; replaces every slide's `morphDuration`) |
| `trim.html` | `trim-boot.ts` | The real `src/renderer/trim/main.ts`, given a clip the way the main process would give it one. | none | `src` (default `decks/demo-deck/assets/testclip.mp4`) |
| `agent-chat.html` | `agent-chat-boot.ts` | `AgentChatPanel` backed by an in-memory `AgentChatApi` fake. A sent message becomes "busy" and gets a canned reply after 650 ms. **Currently broken; see Invariants.** | `panel`, `setAgentState(state)` | none |
| `fonttest.html` | none | Static page with four font-family stacks at 40px (`#a`–`#d`) for checking font fallback. | none | none |

What each page stubs on `window.api`:

- **editor and inspector:**
  - `assetUrl(src)` returns `/<src>`.
  - `pathForFile` returns `''`.
  - `importAssets` returns `[]`.
  - `saveDeck`, `loadTheme` and `saveTheme` do nothing.
  - The inspector page also stubs `probeAsset`, which returns 640×360 and 6 s.
- **trim:**
  - `assetUrl`, as above.
  - `onTrimTarget` records its listener.
  - `onTrimProgress` and `onTrimDone` do nothing.
  - `runTrim` logs `[harness] runTrim` and returns `{ src: 'assets/fake.mp4', … }`.
- **player:** no bridge. It fetches deck files over HTTP and passes
  `resolveSrc` to `Player`.

## Invariants

- **Use the real modules and stub only the bridge.** A boot module imports the
  `src/` classes directly and fakes nothing but `window.api` (or, for agent
  chat, the `AgentChatApi` the panel is given). Never copy UI code into this
  folder.
- **Install the stub before the module that reads it.**
  `src/renderer/trim/main.ts` subscribes to `window.api` when it is imported,
  so `trim-boot.ts` assigns the stub first and then loads `main.ts` with a
  dynamic `import()`. Any new boot module whose target reads the bridge at
  import time must follow the same pattern.
- **`trim.html` must match `src/renderer/trim/index.html`.** `main.ts` looks up
  every element with `el(id)`, which throws `missing #<id>` when an id is
  absent. The two `<body>`s may differ only in comments and the `<script src>`.
  Update both together.
- **A stub covers only the bridge methods its page calls.** If `src/` starts
  calling a new `window.api` method on one of these code paths, the page
  throws until the stub gains that method.
- **Media paths are project-root paths.** `assetUrl` maps a `src` to `/<src>`
  under the project root, so the boot decks use `decks/demo-deck/assets/...`,
  not deck-relative `assets/...`.
- **The pages are not type-checked**, so API drift shows up only at page
  load. Known drift as of this README:
  - `agent-chat-boot.ts` imports `AgentChatPanel`/`AgentChatApi` from
    `src/renderer/editor/agentChatPanel.js` and `AgentChatState` from
    `src/shared/ipc.js`. Neither exists any more; the editor's agent UI now
    lives in `src/renderer/editor/agentPanel.ts` and `agentBridge.ts`. As a
    result `agent-chat.html` fails to load.
  - `player.html`'s default deck, `decks/animation-reference`, is not in this
    checkout. Pass `?deck=decks/demo-deck` (or another folder under
    `decks/`).

## Side Effects

- Running the Vite dev server opens a localhost port and serves the **whole
  project root**, because `server.fs.allow` is the project root.
- The pages write nothing to disk: the save, import and trim methods are
  no-ops or fakes. The `/tmp/harness` path given to `EditorStore` and the
  agent-chat fake is only a label.
- `player.html` fetches `deck.json`, `theme.css` and media for the chosen deck
  over HTTP from the dev server.
- Each page puts its handles on `window` so the console or an automation
  driver can reach them.

## Verification

- No suite loads these pages. To smoke-test them, start the server (above),
  open each page, and check that the console shows no errors. `agent-chat.html`
  is expected to fail until it is updated.
- The mounted modules are covered by the unit suites
  `npx vitest run test/speakerNotesDrawer.test.ts test/cropAndTrim.test.ts test/playerReadiness.test.ts`
  and the Electron suite
  `npx vitest run --config vitest.browser.config.ts test/inspectorFieldTabBrowser.test.ts`.
- Full suite: `npm test`.
