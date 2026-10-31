# renderer

## Overview

Every browser-side surface of DeckWerk: the desktop editor and its satellite
windows (built by `electron.vite.config.ts`), the hosted collaboration web
client (`vite.collab.config.ts`), and the standalone player for exported decks
(`vite.export.config.ts`). Pages reach the Electron main process only through
`window.api` (the [preload](../preload/README.md) bridge); the collaboration
client swaps that bridge for HTTP and WebSocket calls to
[`src/server`](../server/README.md). All deck rendering goes through the
[player](./player/README.md), so the editor, presentation, export, PDF and
Speaker View show the same slide.

The three files directly in this folder are the shared app-chrome theme
layer. They recolour the app around the slides (light, dark or system) and
never touch a deck's own theme.

## Interface

### Subdirectories

| Directory | Contract | Role |
| --- | --- | --- |
| `editor/` | [editor](./editor/README.md) | Desktop editor shell: `EditorStore`, `EditorCanvas`, inspector, rail, panels |
| `collab/` | [collab](./collab/README.md) | Browser client of the collaboration server: editor, phone, present and print pages; `CollabBridge` |
| `player/` | [player](./player/README.md) | Electron-free deck runtime: `render.ts` and `Player` |
| `export/` | [export](./export/README.md) | Boot script of the exported standalone deck |
| `present/` | [present](./present/README.md) | Fullscreen audience window |
| `presenter/` | [presenter](./presenter/README.md) | Speaker View component and its Electron transport |
| `print/` | [print](./print/README.md) | Hidden PDF-export page |
| `raster/` | [raster](./raster/README.md) | Raster Paint window for image assets |
| `trim/` | [trim](./trim/README.md) | Trim & Crop window for video assets |

### Local files

- `UiTheme` (`uiTheme.ts`): `'dark' | 'light'`; `UiThemePreference`:
  `UiTheme | 'system'` (default `system`).
- `storedUiThemePreference()` (`uiTheme.ts`): the stored `light` or `dark`,
  otherwise `system` (also when localStorage throws).
- `resolveUiTheme(preference?)` (`uiTheme.ts`): maps `system` to the OS
  appearance via `matchMedia`, falling back to `dark`.
- `applyUiTheme()` (`uiTheme.ts`): sets `<html data-ui-theme>` and, on the
  first call, starts following OS and cross-window changes. Returns the theme.
- `setUiThemePreference(preference)` (`uiTheme.ts`): stores the choice
  (`system` removes the key) and re-applies it.
- `appearanceMenuSection()` (`uiTheme.ts`): the System, Light and Dark menu
  section used by `editor/aboutDialog.ts`.
- `appChrome.css`: dark default tokens on `:root` (`--bg`, `--panel`,
  `--panel-2`, `--line`, `--text`, `--muted`, `--accent`, `--accent-soft`,
  `--green`, `--yellow`, `--danger`, `--shadow`, `--radius`, `--mono`), the
  Monaspace Krypton font face (from `editor/fonts/`), base control styles
  (button, select, input, textarea, focus outlines) and shared dialog classes
  (`.workflow-overlay` / `.app-dialog-backdrop`, `.workflow-dialog` /
  `.app-dialog`, `.workflow-actions` / `.app-dialog-actions`,
  `button.primary`, `button.danger`).
- `lightTheme.css`: token overrides under `:root[data-ui-theme="light"]`,
  plus a few light-only overrides (canvas host, selected rail item, the Trim
  window's command readout).
- Importers: `editor/main.ts`, `collab/main.ts`, `collab/mobile.ts`,
  `presenter/main.ts`, `trim/main.ts` and `raster/main.ts` import all three;
  `collab/present.ts` imports only `appChrome.css`.

## Invariants

- The UI theme only recolours the app chrome; slides keep their deck's theme.
- Only `light` and `dark` are ever stored (localStorage key
  `deckwerk.uiTheme`); `system` means the key is absent, and any other stored
  value reads as `system`.
- The theme is applied to `<html>` before first paint so a window never
  flashes the other theme. Listeners are installed at most once per window.
- Light mode applies only under `:root[data-ui-theme="light"]`; dark is the
  unscoped default.
- Text and muted colours keep at least 4.5:1 contrast against `--bg`,
  `--panel` and `--panel-2` (enforced by `test/appChrome.test.ts`).
- New controls reuse these tokens and classes instead of browser defaults or
  one-off styling (repository AGENTS.md "UI consistency").
- Renderer code never imports Node or Electron directly; everything goes
  through `window.api` or, in the collab client, its HTTP/WebSocket
  replacement.

## Side Effects

- `uiTheme.ts` reads, writes and removes localStorage key
  `deckwerk.uiTheme` (each access in try/catch), sets
  `document.documentElement.dataset.uiTheme`, listens to the
  `prefers-color-scheme` media query, and listens to `storage` events so a
  choice made in one window (Speaker View, a second editor) reaches the others.
- `appChrome.css` loads the Monaspace Krypton font and applies global element
  styles.

## Verification

- Run: `npx vitest run test/appChrome.test.ts test/uiControls.test.ts`
- Run: `npx vitest run --config vitest.browser.config.ts test/uiThemeBrowser.test.ts`
  (launches Electron)
- Full suite: `npm test`
