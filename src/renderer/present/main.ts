import '../player/player.css';
import type { DeckSession } from '@shared/ipc.js';
import type { LaserState, PresentationCommand, PresentationState } from '@shared/ipc.js';
import {
  nextLeavesPresentationRange,
  prevLeavesPresentationRange,
  type PresentationRange,
} from '@shared/presentationRange.js';
import { bindPresentKeys } from '../player/keys.js';
import { createLaserPointer, validLaserPoint, type LaserPointer } from '../player/laserPointer.js';
import { Player } from '../player/player.js';
import { eventOnInteractiveWeb, slideLinkFromEvent } from '../player/links.js';
import { selectionPreventsAdvance } from '../player/presentationPointer.js';
import { rewriteCssAssetUrls } from '../player/render.js';

/**
 * The fullscreen presentation window. Thin by design: it renders the deck with
 * the same `Player` the editor previews with, so what you rehearse is exactly
 * what the projector shows.
 */

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

let player: Player | null = null;
let session: DeckSession | null = null;
let range: PresentationRange | null = null;
let themeLink: HTMLStyleElement | null = null;
const startedAt = Date.now();
let slideStartedAt = startedAt;
let timedSlide = -1;
let laser: LaserPointer | null = null;
let laserState: LaserState = { enabled: false, point: null, blanked: false };
let presentationState: PresentationState | null = null;

/** Show the laser here and hand the whole state on to Speaker View. */
function publishPresentation(): void {
  laser?.setState(laserState);
  if (presentationState) window.api.publishPresentState({ ...presentationState, laser: laserState });
}

function laserContext(): { slideId: string | undefined; step: number | undefined } {
  const cursor = player?.getCursor();
  return { slideId: cursor ? session?.deck.slides[cursor.slide]?.id : undefined, step: cursor?.step };
}

function handleLaser(command: PresentationCommand): void {
  if (!player) return;
  if (command.type === 'toggleLaser') {
    laserState = { ...laserState, enabled: !laserState.enabled, point: null };
  } else if (command.type === 'laserMove') {
    // A move made over a slide or step no longer showing is stale.
    const context = laserContext();
    if (
      !laserState.enabled || laserState.blanked
      || command.slideId !== context.slideId || command.step !== context.step
    ) return;
    if (command.point !== null && !validLaserPoint(command.point)) return;
    laserState = { ...laserState, point: command.point };
  } else return;
  publishPresentation();
}

function toggleBlank(): void {
  if (!player) return;
  laserState = { ...laserState, point: null, blanked: player.toggleBlank() };
  publishPresentation();
}

async function applyTheme(): Promise<void> {
  const css = await window.api.loadTheme();
  if (!themeLink) {
    themeLink = document.createElement('style');
    document.head.appendChild(themeLink);
  }
  themeLink.textContent = rewriteCssAssetUrls(css, (src) => window.api.assetUrl(src));
}

function start(nextSession: DeckSession): void {
  const params = new URLSearchParams(location.search);
  const startSlide = Number(params.get('slide') ?? 0);
  const endSlide = params.has('endSlide') ? Number(params.get('endSlide')) : null;
  range = Number.isFinite(startSlide) && endSlide !== null && Number.isFinite(endSlide)
    ? { start: startSlide, end: endSlide }
    : null;

  if (player) {
    player.setDeck(nextSession.deck);
    return;
  }

  player = new Player({
    deck: nextSession.deck,
    container: root!,
    resolveSrc: (src) => window.api.assetUrl(src),
    onCursor: (cursor, steps) => {
      if (cursor.slide !== timedSlide) {
        timedSlide = cursor.slide;
        slideStartedAt = Date.now();
      }
      presentationState = {
        cursor,
        steps,
        startedAt,
        slideStartedAt,
        ...(range ? { range } : {}),
      };
      // A new slide or step starts without a dot.
      laserState = { ...laserState, point: null };
      publishPresentation();
    },
  });
  // Presenting from a skipped slide would put it on the projector anyway;
  // land on the nearest slide that is actually part of the talk.
  let first = Number.isFinite(startSlide) ? startSlide : 0;
  const slides = nextSession.deck.slides;
  if (slides[first]?.skipped) {
    const last = range?.end ?? slides.length - 1;
    const forward = slides.findIndex((s, i) => i > first && i <= last && !s.skipped);
    if (forward >= 0) {
      first = forward;
    } else {
      const earliest = range?.start ?? 0;
      for (let i = Math.min(first - 1, last); i >= earliest; i--) {
        if (!slides[i].skipped) { first = i; break; }
      }
    }
  }
  laser = createLaserPointer({ host: root!, getContext: laserContext, onCommand: handleLaser });
  player.goToSlide(first, { play: true });

  bindPresentKeys(window, player, {
    onExit: () => window.close(),
    onNext: advance,
    onPrev: retreat,
    onBlank: toggleBlank,
    onHome: () => player?.goToSlide(range?.start ?? 0, { play: true }),
  });

  // Advance on click rather than pointer-down so Chromium can first complete a
  // native drag selection. The click generated by that drag belongs to the
  // selection gesture and must not change the slide.
  window.addEventListener('click', (event) => {
    if (eventOnInteractiveWeb(event)) return;
    if (!slideLinkFromEvent(event) && !selectionPreventsAdvance()) advance();
  });
  window.addEventListener('mousedown', (e) => {
    if (eventOnInteractiveWeb(e)) return;
    if (e.button === 2) retreat();
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
}

function advance(): void {
  if (!player || !session) return;
  if (range && nextLeavesPresentationRange(session.deck.slides, player.getCursor(), range)) {
    window.close();
    return;
  }
  player.next();
}

function retreat(): void {
  if (!player || !session) return;
  if (range && prevLeavesPresentationRange(session.deck.slides, player.getCursor(), range)) return;
  player.prev();
}

window.api.onPresentCommand((command: PresentationCommand) => {
  if (!player) return;
  if (command.type === 'next') advance();
  else if (command.type === 'prev') retreat();
  else if (command.type === 'goTo') {
    const target = range
      ? Math.min(Math.max(command.slide, range.start), range.end)
      : command.slide;
    player.goToSlide(target, { play: true });
  }
  else if (command.type === 'toggleBlank') toggleBlank();
  else handleLaser(command);
});

// Live updates while presenting (editing on a second screen mid-rehearsal).
window.api.onDeckState((nextSession) => {
  session = nextSession;
  void applyTheme();
  start(nextSession);
});

// Pull the current deck on load, rather than waiting for a broadcast that may
// already have fired — reopening this window mid-talk must not show black.
void (async () => {
  const initialSession = await window.api.getDeck();
  if (!initialSession) return;
  session = initialSession;
  await applyTheme();
  start(initialSession);
})();
