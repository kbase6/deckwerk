# renderer/collab

## Overview

The browser client of the hosted collaboration server (`src/server`), built by
`vite.collab.config.ts` (`npm run build:collab`). It reuses the desktop
[editor](../editor/README.md), [player](../player/README.md),
[Speaker View](../presenter/README.md) and [print](../print/README.md)
components, but replaces the Electron preload with HTTP routes and a WebSocket
session. It builds four pages:

| Page | Entry | Role |
| --- | --- | --- |
| `index.html` | `main.ts` | The full collaborative editor shell |
| `mobile.html` | `mobile.ts` | Phone client: slide list, notes and comments, presenting, remote clicker |
| `present.html` | `present.ts` | Audience Player or Speaker View in one page, so the two roles can swap |
| `print.html` | `print.ts` | PDF export through the browser's print dialog |

The shared core is `CollabBridge`, an optimistic replicator that syncs
element-level transactions against the server's single total order.

## Interface

### Files

| File | Role |
| --- | --- |
| `collabBridge.ts` | WebSocket replication (shadow plus pending), selective op-based undo/redo, presence, cursor, theme, chat and remote messages, reconnect with backoff |
| `netApi.ts` | Browser stand-in for the preload `Api`: deck-scoped asset URLs, XHR uploads, clipboard, URL import, probe and theme fetches |
| `main.ts` | Editor shell entry: wires `CollabBridge`, `netApi`, presence, chat, agent panel, deck picker, remote receiver and present overlay |
| `mobile.ts`, `mobileShell.ts` | Phone client entry, and the choice between editor and phone shells (`?mobile=1`, `?desktop=1`, remembered choice) |
| `present.ts`, `presentOverlay.ts`, `presentationBus.ts` | Presentation page, in-tab fullscreen overlay, and the audience/speaker channel |
| `remoteControl.ts` | Remote clicker: `PresenterRemotes` on the presenting surface, `RemoteReceiver` in editor and phone tabs |
| `print.ts` | Loads the deck from `/api/deck`, lays out `.pdf-page` pages, calls `window.print()` |
| `deckPicker.ts` | Deck and folder browser: create, rename, move, trash, restore, Keynote/PPTX/archive import, Share dialog |
| `chatPanel.ts` | Deck chat panel with optimistic messages, unread badge and mention notifications |
| `presenceBar.ts`, `presenceOverlay.ts` | Peer avatars; peer cursors and selection outlines in slide coordinates |
| `agentPanelApi.ts`, `agentPrompt.ts` | Agent panel transport (`/api/agent-panel/*`) and the prompt that tells a person's own agent how to run `deckwerk-connect.mjs` |
| `connectionNotice.ts`, `deckNameField.ts`, `endCollaborationPopover.ts` | Disconnect notice with deck backup, in-place deck rename, End collaboration confirmation |
| `mediaVariants.ts`, `playerReadiness.ts` | Video variant pinning (`?v=`); paint-readiness signal with a generation counter |
| `*.html`, `*.css`, `favicon.svg` | Page shells and styles (`collab.css`, `mobile.css`, `present.css`, `print.css`, `remote.css`) |

### Key symbols

- `CollabBridge` (`collabBridge.ts`): `connect`, `close`, `rename`, transaction
  sending, `undo(currentDeck)`, `redo`, `canUndo`, `canRedo`, `sendPresence`,
  `sendCursor`, `sendTheme`, `sendChat`, `sendRemote`; `setName`,
  `setParticipant` and `setSurface` are called before `connect`.
- `CollabBridgeHooks` (`collabBridge.ts`): `onDeckReplaced`, `onWelcome`,
  `onPeerPresence`, `onPeerCursor`, `onPeerLeft`, `onThemeCss`, `onChat`,
  `onStatus`, `onCleanChange`, `onEnded`, `onMoved`, `onUnavailable`,
  `onConnectionChange`, `onEditsDiscarded`, `onRemote`.
- `CollabSurface` (`collabBridge.ts`): `{presenting?, device?: 'phone'}`, how a
  peer describes itself. `describeAgentEdit(label, ops)` labels agent edits.
- `installNetApi({deckId, saveTheme})`, `downloadOriginalAsset(deckId, src)`
  (`netApi.ts`).
- `createPresentationBus(deckId)`, `PresentationBus`,
  `PresentationBusMessage`, `PresentationRole` (`presentationBus.ts`).
- `startPresenting`, `presentUrl`, `PresentSeed`, `PresentOptions`
  (`presentOverlay.ts`).
- `PresenterRemotes`, `RemoteReceiver`, `remoteCandidates`, `peerLabel`,
  `bindSwipe` (`remoteControl.ts`).
- `ChatPanel`, `relativeTime` (`chatPanel.ts`).
- `showDeckPicker`, `showShareDialog`, `createDeckOnServer`, `importToServer`,
  `importKeynoteToServer`, `importPowerPointToServer`, `importMenuEntries`,
  `folderOf`, `editedAgo` (`deckPicker.ts`).
- `createConnectionNotice`, `createDeckNameField`,
  `openEndCollaborationPopover`, `closeEndCollaborationPopover`.
- `PresenceBar`, `initials`, `isAgentPeer` (`presenceBar.ts`);
  `PresenceOverlay` (`presenceOverlay.ts`).
- `setMediaVariants`, `mediaVariantsSnapshot`, `pinMediaVariant`
  (`mediaVariants.ts`); `isPhone`, `rememberShell`, `wantsMobileShell`,
  `shellUrl` (`mobileShell.ts`).
- `createAgentPanelApi(deckId)`, `browserParticipantId()`
  (`agentPanelApi.ts`); `agentConnectPrompt`, `agentSessionUrl`
  (`agentPrompt.ts`); `PlayerPaintReadiness` (`playerReadiness.ts`).

## Invariants

- The deck shown is always `shadow + pending`, replayed leniently
  (`applyOpsLenient` in `src/shared/collabApply.ts`). `shadow` advances only
  through server transactions in sequence order, so all clients converge.
- Undo is op-based and selective: the inverse ops are applied to the current
  deck as a new transaction. The collab shell never binds the store's
  whole-deck snapshot undo, which would revert other people's edits. Edits with
  the same coalesce key extend one undo entry; the undo limit is 200.
- On every `welcome`, pending transactions are dropped (the server wins),
  `onEditsDiscarded` reports how many, and the undo and redo stacks are
  cleared.
- Reconnect starts at 500 ms and doubles up to 10 s. Close code 4003 (identity
  refused), `COLLAB_CLOSE.noSuchDeck` and `COLLAB_CLOSE.moved` stop
  reconnecting for good.
- Presenter commands travel over the presentation bus (BroadcastChannel, with
  a localStorage fallback that does not carry `seed`), never over the collab
  WebSocket.
- The present page never sends a transaction, in either role, though it still
  appears to collaborators as a peer.
- Every video URL names its media variant (`?v=`), so a playing `<video>`
  keeps the bytes it started with.
- A deck id is its folder path (`acme/pitch`). Opening a deck navigates to
  `?deck=<id>` with a full reload, which re-keys every deck-scoped route and
  socket.
- The server relays remote clicks only from a peer that accepted an offer.
  Either side can end the remote, and it ends when either page goes away.

## Side Effects

- WebSocket to `ws(s)://<host>/ws?deck=<id>` from `main.ts`, `mobile.ts` and
  `present.ts`, with timed reconnects.
- HTTP to deck-scoped server routes: `/api/upload`, `/api/clipboard/:id`,
  `/api/import-url`, `/api/probe`, `/api/theme` (`netApi.ts`); `/api/decks*`,
  `/api/folders*`, `/api/trash*`, `/api/access`, `/api/users`,
  `/api/import-*` (`deckPicker.ts`); `/api/config` (`mobile.ts`); `/api/deck`
  (`print.ts`). An `EventSource` on `/api/agent-panel/events`.
- BroadcastChannel `deckwerk-present:<deckId>`, or localStorage writes and a
  `storage` listener as fallback.
- localStorage: display name, chat read state and notification preference,
  remembered shell choice.
- Desktop notifications for mentions (permission asked only from a click), a
  30 s timer refreshing relative times, fullscreen requests, an iframe overlay
  and `window.open` for the audience window, `navigator.clipboard.writeText`
  for share links and prompts, `location.replace` redirects, `window.print()`.

## Verification

- Run: `npx vitest run test/collabBridge.test.ts test/presentationBus.test.ts test/chatPanel.test.ts test/mobileShell.test.ts test/deckPickerImportMenu.test.ts test/shareDialog.test.ts`
- Run: `npx vitest run --config vitest.browser.config.ts test/collabBrowserSmoke.test.ts`
  (launches Electron)
- Full suite: `npm test`
