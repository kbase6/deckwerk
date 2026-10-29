import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { saveDeck } from '../src/main/deckStore.js';
import { getFfmpegPath } from '../src/main/ffmpeg.js';
import { startCollabServer, type RunningCollabServer } from '../src/server/collabServer.js';
import { emptyDeck, type Deck } from '../src/shared/deck.js';
import { circularMaskLayout } from '../src/shared/mediaMask.js';
import {
  Cdp,
  electronBinary,
  eventually,
  findTarget,
  launchBrowser,
  stopBrowser,
  wait,
  type RunningBrowser,
} from './support/browserSession.js';
import { collabClientDir } from './support/collabClient.js';

/**
 * The crop outline of letterboxed media, and the first crop of it.
 *
 * An uncropped `contain` picture in a frame larger than itself was outlined on
 * the empty frame, so its handles floated off the picture; the first crop then
 * started from the frame rather than the picture and stretched or jumped it. A
 * letterboxed frame that paints something (a border, a backdrop, a video's
 * bars) snapped into the picture on its first crop, a circular mask grew past
 * the picture and lost its circle, a pan could drag the picture off its window,
 * and a pan that could not move still left an undo step and a crop behind.
 * In crop mode the ghost of what is cut away was a tint without the picture,
 * stood upright beside turned media, and was missing for an uncropped `cover`.
 *
 * The invariants: **looking at a slide never edits it; a crop moves only the
 * edge dragged, never the picture; the window never shows past the picture;
 * geometry is whole pixels.** Real media, the real Edit mask button, real CDP
 * pointer input; test/mediaCrop.test.ts walks the arithmetic.
 */
const DECK_ID = 'crop-outline-bugs';
const NATURAL = { w: 160, h: 90 };

let workDir = '';
let server: RunningCollabServer | null = null;
let browser: RunningBrowser | null = null;
let cdp: Cdp;

type Rect = { x: number; y: number; w: number; h: number };
type Media = Rect & { sourceBox: Rect | null };

const media = (id: string, type: 'image' | 'video', box: Rect, extra: Record<string, unknown> = {}) => ({
  id, type, ...box, rot: 0, z: 1, opacity: 1, class: [], style: {},
  src: type === 'video' ? 'assets/clip.mp4' : 'assets/pic.png',
  fit: 'contain', sourceBox: null,
  ...(type === 'video'
    ? { autoplay: false, loop: true, muted: true, controls: false, start: 0, end: null, poster: null }
    : { alt: '' }),
  ...extra,
});

// A 16:9 picture in frames that are not 16:9, so `contain` letterboxes it and
// the painted picture lands on fractional pixels (700x393.75 at +53.125).
const FIT: Rect = { x: 80, y: 60, w: 700, h: 500 };
const FRAMED: Rect = { x: 80, y: 580, w: 700, h: 460 };
const BACKED: Rect = { x: 860, y: 60, w: 400, h: 400 };
const CLIP: Rect = { x: 860, y: 560, w: 480, h: 400 };
const EXACT: Rect = { x: 1380, y: 620, w: 480, h: 270 };
// Cropped and turned: what the crop cuts away turns with it.
const TURNED: Rect = { x: 1420, y: 390, w: 180, h: 100 };
// Uncropped `cover`: the picture overflows its window with no crop written.
const COVERED: Rect = { x: 1420, y: 920, w: 160, h: 140 };
// The circle touches the picture's top and bottom: 270 square, picture 480x270.
const ROUND = circularMaskLayout(
  media('round', 'image', { x: 1380, y: 60, w: 480, h: 270 }) as never,
  NATURAL,
);

beforeAll(async () => {
  if (!electronBinary) return;
  workDir = await mkdtemp(join(tmpdir(), 'crop-outline-'));
  const decksRoot = join(workDir, 'decks');
  const deckDir = join(decksRoot, DECK_ID);
  const profileDir = join(workDir, 'electron-profile');
  await mkdir(join(deckDir, 'assets'), { recursive: true });
  await mkdir(profileDir, { recursive: true });
  const pattern = ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${NATURAL.w}x${NATURAL.h}:rate=10:duration=1`];
  execFileSync(getFfmpegPath(), [...pattern, '-frames:v', '1', join(deckDir, 'assets', 'pic.png')]);
  execFileSync(getFfmpegPath(), [...pattern, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', join(deckDir, 'assets', 'clip.mp4')]);
  const deck = emptyDeck('Crop outline');
  deck.slides[0].elements = [
    media('fit', 'image', FIT),
    media('framed', 'image', FRAMED, { borderWidth: 4, borderColor: '#1f2937' }),
    media('backed', 'image', BACKED, { style: { 'background-color': '#e5e7eb' } }),
    media('clip', 'video', CLIP),
    media('exact', 'image', EXACT),
    media('round', 'image', ROUND, { maskShape: 'circle', sourceBox: ROUND.sourceBox }),
    media('turned', 'image', TURNED, { rot: 30, sourceBox: { x: -60, y: -40, w: 320, h: 180 } }),
    media('covered', 'image', COVERED, { fit: 'cover' }),
  ] as Deck['slides'][number]['elements'];
  await saveDeck(deckDir, deck);
  await writeFile(join(deckDir, 'theme.css'), '.slide { background: #fff; }\n', 'utf8');
  server = await startCollabServer({ rootDir: decksRoot, clientDir: await collabClientDir(), host: '127.0.0.1', port: 0 });
  browser = await launchBrowser(`http://127.0.0.1:${server.port}/?deck=${DECK_ID}&name=Crop`, profileDir);
  const target = await findTarget(browser.debugPort, (c) => c.url.includes(`deck=${DECK_ID}`), browser.log);
  cdp = await Cdp.connect(target.webSocketDebuggerUrl!);
  await eventually(() => cdp.evaluate<boolean>(`(() => {
    const ids = ${JSON.stringify(['fit', 'framed', 'backed', 'exact', 'round', 'turned', 'covered'])};
    const images = ids.map((id) => document.querySelector('#canvas [data-element-id="' + id + '"] img'));
    const video = document.querySelector('#canvas [data-element-id="clip"] video');
    return images.every((img) => img?.naturalWidth > 0) && video?.videoWidth > 0;
  })()`), 'the media never loaded');
}, 180_000);

afterAll(async () => {
  cdp?.close();
  await stopBrowser(browser?.process ?? null);
  browser = null;
  await server?.close();
  server = null;
  if (workDir) await rm(workDir, { recursive: true, force: true });
  workDir = '';
});

/* --- reading the page ------------------------------------------------------ */

const element = (id: string) => cdp.evaluate<Media>(`(() => {
  const el = window.store.get().deck.slides[0].elements.find((e) => e.id === ${JSON.stringify(id)});
  return { x: el.x, y: el.y, w: el.w, h: el.h, sourceBox: el.sourceBox ?? null };
})()`);

/** The element as the collaboration server holds it: what everyone else sees. */
const onServer = async (id: string): Promise<Media> => {
  const response = await fetch(`http://127.0.0.1:${server!.port}/api/deck?deck=${DECK_ID}`);
  const el = (await response.json() as Deck).slides[0].elements.find((e) => e.id === id) as unknown as Media;
  return { x: el.x, y: el.y, w: el.w, h: el.h, sourceBox: el.sourceBox ?? null };
};

/** Undo and History, as the person sees them: Cmd+Z goes through the bridge. */
const edits = () => cdp.evaluate<{ history: number; canUndo: boolean; dirty: boolean }>(`({
  history: window.store.history().length,
  canUndo: window.bridge.canUndo(),
  dirty: window.store.get().dirty,
})`);

/** Slide pixels per screen pixel, and where the slide sits on screen. */
const stage = () => cdp.evaluate<{ left: number; top: number; scale: number }>(`(() => {
  const r = document.querySelector('#canvas .slide').getBoundingClientRect();
  return { left: r.left, top: r.top, scale: r.width / 1920 };
})()`);

/**
 * Where the picture is painted, in slide pixels, measured off the DOM: the
 * media tag's box with `object-fit` applied to its natural size. Independent
 * of the editor's own geometry helpers.
 */
const painted = (id: string) => cdp.evaluate<Rect>(`(() => {
  const tag = document.querySelector('#canvas [data-element-id="${id}"]').querySelector('img, video');
  const nw = tag.tagName === 'VIDEO' ? tag.videoWidth : tag.naturalWidth;
  const nh = tag.tagName === 'VIDEO' ? tag.videoHeight : tag.naturalHeight;
  const slide = document.querySelector('#canvas .slide').getBoundingClientRect();
  const scale = slide.width / 1920;
  const r = tag.getBoundingClientRect();
  let { left: x, top: y, width: w, height: h } = r;
  const fit = getComputedStyle(tag).objectFit;
  if (fit === 'contain' || fit === 'cover') {
    const s = (fit === 'cover' ? Math.max : Math.min)(w / nw, h / nh);
    x += (w - nw * s) / 2; y += (h - nh * s) / 2; w = nw * s; h = nh * s;
  }
  return { x: (x - slide.left) / scale, y: (y - slide.top) / scale, w: w / scale, h: h / scale };
})()`);

/** A box measured on screen, in slide pixels. */
const onSlide = (selector: string) => cdp.evaluate<Rect | null>(`(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (!node) return null;
  const slide = document.querySelector('#canvas .slide').getBoundingClientRect();
  const scale = slide.width / 1920;
  const r = node.getBoundingClientRect();
  return { x: (r.left - slide.left) / scale, y: (r.top - slide.top) / scale, w: r.width / scale, h: r.height / scale };
})()`);

const near = (actual: Rect, expected: Rect, what: string, tolerance = 1.5) => {
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    expect(Math.abs(actual[key] - expected[key]), `${what}: ${key} ${actual[key]} vs ${expected[key]}`)
      .toBeLessThanOrEqual(tolerance);
  }
};

/** Where the whole picture sits on the slide, from the deck's geometry. */
const pictureOf = (el: Media): Rect => {
  const box = el.sourceBox ?? { x: 0, y: 0, w: el.w, h: el.h };
  return { x: el.x + box.x, y: el.y + box.y, w: box.w, h: box.h };
};

const wholePixels = (el: Media, what: string) => {
  const values = { x: el.x, y: el.y, w: el.w, h: el.h, 'sourceBox.x': el.sourceBox?.x, 'sourceBox.y': el.sourceBox?.y };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    expect(Number.isInteger(value), `${what}: ${key} = ${value} is not a whole pixel`).toBe(true);
  }
};

/* --- real input ------------------------------------------------------------ */

const screenPoint = async (x: number, y: number) => {
  const s = await stage();
  return { x: s.left + x * s.scale, y: s.top + y * s.scale };
};

/** Drag from a screen point by (dx, dy) slide pixels, in two moves. */
const dragBy = async (from: { x: number; y: number }, dx: number, dy: number) => {
  const { scale } = await stage();
  const gesture = await cdp.beginDrag(from.x, from.y);
  await gesture.moveTo(from.x + (dx / 2) * scale, from.y + (dy / 2) * scale);
  await gesture.moveTo(from.x + dx * scale, from.y + dy * scale);
  await gesture.drop();
  // Out of the double-click interval, so the next press is a first click again.
  await wait(600);
};

const handle = (id: string, name: string) => cdp.evaluate<{ x: number; y: number }>(`(() => {
  const r = document.querySelector('.handle-${name}[data-element-id="${id}"]').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);

/** Click the middle of an element's authored frame and wait for the inspector to show it alone. */
const select = async (id: string, box: Rect) => {
  const at = await screenPoint(box.x + box.w / 2, box.y + box.h / 2);
  await cdp.clickAt(at.x, at.y);
  await eventually(() => cdp.evaluate<boolean>(`(() => {
    const selection = [...window.store.get().selection];
    // A video's panel renders again once its clip length is probed,
    // shifting everything under a click aimed before that.
    const settled = !document.querySelector('#inspector')?.textContent.includes('Reading clip length');
    return selection.length === 1 && selection[0] === ${JSON.stringify(id)} && settled
      && Boolean(document.querySelector('#canvas .sel-box'));
  })()`), `${id} never became the only selection`);
  await wait(600);
};

/** Click an inspector button by its text. */
const clickControl = async (selector: string, text: string) => {
  const at = await eventually(() => cdp.evaluate<{ x: number; y: number } | null>(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((n) => n.textContent.trim() === ${JSON.stringify(text)});
    if (!node) return null;
    node.scrollIntoView({ block: 'center' });
    const r = node.getBoundingClientRect();
    return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  })()`), `no visible "${text}" control`);
  await cdp.clickAt(at!.x, at!.y);
};

const enterCrop = async (id: string, box: Rect) => {
  await select(id, box);
  await clickControl('.mask-action-row .panel-action', 'Edit mask');
  await eventually(() => cdp.evaluate<boolean>(`!!document.querySelector('#canvas .sel-box.masking')`),
    `${id}: mask mode never began`);
};

const leaveCrop = async () => {
  await clickControl('.mask-action-row .panel-action', 'Done editing mask');
  await eventually(() => cdp.evaluate<boolean>(`!document.querySelector('#canvas .sel-box.masking')`),
    'mask mode never ended');
};

/* --- the cases --------------------------------------------------------------- */

// The cases share one editor and run in order: the first two must find the
// deck unedited, so they come before anything that crops.
describe.skipIf(!electronBinary)('the crop outline and the first crop of letterboxed media', () => {
  // Every case leaves mask mode itself; only a failed one is still in it, and
  // that must not fail the next case before it reaches its own assertions.
  afterEach(async () => {
    if (await cdp.evaluate<boolean>(`!!document.querySelector('#canvas .sel-box.masking')`)) await leaveCrop();
  });

  it('outlines an uncropped contain picture on the picture without editing the deck', { timeout: 120_000 }, async () => {
    const before = await edits();
    expect(before.canUndo, 'the fixture opened with an undo step').toBe(false);

    await select('fit', FIT);
    const outline = (await onSlide('#canvas .sel-box'))!;
    const picture = await painted('fit');
    // Soundness: the frame really is larger than its picture.
    expect(FIT.h - picture.h, 'the fixture is not letterboxed').toBeGreaterThan(100);
    near(outline, picture, 'the outline is not on the painted picture');

    // Looking at it edited nothing: not the deck here, not the server's, no
    // undo step, no History row, nothing waiting to be saved.
    await wait(400);
    expect(await element('fit'), 'selecting the picture rewrote its frame').toEqual({ ...FIT, sourceBox: null });
    expect(await onServer('fit'), 'selecting the picture sent a new frame').toEqual({ ...FIT, sourceBox: null });
    expect(await edits(), 'selecting the picture left an edit behind').toEqual(before);

    // A frame that paints something keeps its outline on the frame: fitting it
    // to the picture would move the border or the backdrop.
    for (const [id, box] of [['framed', FRAMED], ['backed', BACKED]] as const) {
      await select(id, box);
      near((await onSlide('#canvas .sel-box'))!, box, `${id}: the outline left its painted frame`);
      expect((await painted(id)).h, `${id} is not letterboxed`).toBeLessThan(box.h - 30);
      expect(await element(id)).toEqual({ ...box, sourceBox: null });
    }
    expect(await edits(), 'selecting framed pictures left an edit behind').toEqual(before);
  });

  it('records nothing for a pan that cannot move', { timeout: 120_000 }, async () => {
    const before = await edits();
    // Both pictures fill their window exactly: the fitted one through its
    // outline, the other because its frame is the picture.
    for (const [id, box] of [['fit', FIT], ['exact', EXACT]] as const) {
      await enterCrop(id, box);
      const centre = await screenPoint(box.x + box.w / 2, box.y + box.h / 2);
      await dragBy(centre, 180, 90);
      expect(await element(id), `${id}: a pan that could not move edited it`).toEqual({ ...box, sourceBox: null });
      expect(await edits(), `${id}: a pan that could not move left an undo step`).toEqual(before);
      await leaveCrop();
    }
    expect(await onServer('fit')).toEqual({ ...FIT, sourceBox: null });
  });

  it('crops a fitted picture from the picture, moving only the dragged edge', { timeout: 120_000 }, async () => {
    const before = await edits();
    const picture = await painted('fit');
    await enterCrop('fit', FIT);
    // The handles are on the picture, not on the empty frame around it.
    const top = await handle('fit', 'n');
    expect(Math.abs(top.y - (await screenPoint(0, picture.y)).y), 'the top handle is not on the picture')
      .toBeLessThanOrEqual(2);
    await dragBy(top, 0, 70);
    const cropped = await eventually(() => element('fit'), 'the crop never landed', (el) => el.sourceBox !== null);

    // Soundness: it cropped, and that is one undo step.
    expect(cropped.y - picture.y, 'the top edge did not move in').toBeGreaterThan(40);
    expect((await edits()).history, 'the crop was not one History row').toBe(before.history + 1);
    // The picture did not move or stretch: by the deck, and as painted.
    near(pictureOf(cropped), picture, 'the first crop moved or stretched the picture');
    near(await painted('fit'), picture, 'the picture as painted moved or stretched');
    // The edges not dragged stayed where the picture's edges were.
    expect(Math.abs(cropped.x - picture.x), 'left edge moved').toBeLessThanOrEqual(1);
    expect(Math.abs(cropped.x + cropped.w - (picture.x + picture.w)), 'right edge moved').toBeLessThanOrEqual(1);
    expect(Math.abs(cropped.y + cropped.h - (picture.y + picture.h)), 'bottom edge moved').toBeLessThanOrEqual(1);
    wholePixels(cropped, 'fit after the first crop');
    await leaveCrop();
  });

  it('crops a letterboxed frame at the dragged edge only, without snapping into the picture', { timeout: 120_000 }, async () => {
    for (const [id, box] of [['clip', CLIP], ['framed', FRAMED]] as const) {
      const picture = await painted(id);
      await enterCrop(id, box);
      // Its outline stays on the frame, letterbox and all.
      near((await onSlide('#canvas .sel-box'))!, box, `${id}: the crop outline left the frame`);
      await dragBy(await handle(id, 'e'), -120, 0);
      const cropped = await eventually(() => element(id), `${id}: the crop never landed`, (el) => el.w < box.w);
      expect(box.w - cropped.w, `${id}: the right edge did not move in`).toBeGreaterThan(80);
      expect({ x: cropped.x, y: cropped.y, h: cropped.h }, `${id}: an edge the drag left alone moved`)
        .toEqual({ x: box.x, y: box.y, h: box.h });
      near(pictureOf(cropped), picture, `${id}: the crop moved or stretched the picture`);
      near(await painted(id), picture, `${id}: the picture as painted moved or stretched`);
      wholePixels(cropped, `${id} after cropping`);
      await leaveCrop();
    }
  });

  it('keeps a circular mask round when a corner is dragged out past the picture', { timeout: 120_000 }, async () => {
    const box = { x: ROUND.x, y: ROUND.y, w: ROUND.w, h: ROUND.h };
    const picture = await painted('round');
    // Soundness: the fixture's circle touches the picture's top and bottom.
    expect(await element('round')).toEqual({ ...box, sourceBox: ROUND.sourceBox });
    expect(ROUND.sourceBox.y).toBe(0);
    expect(ROUND.sourceBox.h).toBe(ROUND.h);
    expect(ROUND.w).toBe(ROUND.h);
    await enterCrop('round', box);

    // In: a smaller circle, so the handle is live.
    await dragBy(await handle('round', 'se'), -80, -80);
    const smaller = await eventually(() => element('round'), 'the circle never shrank', (el) => el.w < box.w - 40);
    expect(smaller.w, 'the shrunk mask is not a circle').toBe(smaller.h);
    wholePixels(smaller, 'round after shrinking');

    // Out, well past the picture's bottom: it stops at the picture, still round.
    await dragBy(await handle('round', 'se'), 160, 160);
    const grown = await eventually(() => element('round'), 'the circle never grew', (el) => el.w > smaller.w + 40);
    expect(grown.w, 'the grown mask is not a circle').toBe(grown.h);
    const crop = grown.sourceBox!;
    expect(crop.y, 'the circle shows past the picture top').toBeLessThanOrEqual(0);
    expect(crop.y + crop.h, 'the circle shows past the picture bottom').toBeGreaterThanOrEqual(grown.h);
    expect(crop.x).toBeLessThanOrEqual(0);
    expect(crop.x + crop.w).toBeGreaterThanOrEqual(grown.w);
    near(pictureOf(grown), picture, 'growing the circle moved the picture');
    wholePixels(grown, 'round after growing');
    await leaveCrop();
  });

  it('stops a pan at the picture edge, and records one that moved', { timeout: 120_000 }, async () => {
    const start = await element('round');
    // Soundness: the picture is wider than its window, so a pan can move it.
    expect(start.sourceBox!.w).toBeGreaterThan(start.w);
    const box = { x: start.x, y: start.y, w: start.w, h: start.h };
    await enterCrop('round', box);
    const centre = await screenPoint(box.x + box.w / 2, box.y + box.h / 2);

    for (const [dx, dy] of [[500, 300], [-500, -300]] as const) {
      const before = await edits();
      const from = (await element('round')).sourceBox!;
      await dragBy(centre, dx, dy);
      const panned = await eventually(() => element('round'), `the ${dx > 0 ? 'right' : 'left'} pan never landed`,
        (el) => el.sourceBox!.x !== from.x);
      const crop = panned.sourceBox!;
      // The window never shows past the picture, however far the pointer went.
      expect(crop.x, 'empty space left of the picture').toBeLessThanOrEqual(0);
      expect(crop.x + crop.w, 'empty space right of the picture').toBeGreaterThanOrEqual(panned.w);
      expect(crop.y, 'empty space above the picture').toBeLessThanOrEqual(0);
      expect(crop.y + crop.h, 'empty space below the picture').toBeGreaterThanOrEqual(panned.h);
      // It went all the way to the edge it was dragged towards.
      expect(crop.x).toBe(dx > 0 ? 0 : panned.w - crop.w);
      expect({ x: panned.x, y: panned.y, w: panned.w, h: panned.h }, 'a pan moved the window').toEqual(box);
      expect((await edits()).history, 'a pan that moved was not one History row').toBe(before.history + 1);
      wholePixels(panned, 'round after panning');
    }
    await leaveCrop();
  });

  it('shows the whole picture faintly where the crop cuts it away, turned as the media is', { timeout: 120_000 }, async () => {
    // `clip` was cropped by an earlier case, so a video's frame is covered too.
    const clip = await element('clip');
    const cases = [
      ['turned', TURNED],
      ['covered', COVERED],
      ['clip', { x: clip.x, y: clip.y, w: clip.w, h: clip.h }],
    ] as const;
    for (const [id, box] of cases) {
      // The picture as painted, turned or not: for a turned crop, the bounds
      // of the whole turned picture.
      const picture = await painted(id);
      // Soundness: the crop really does cut part of the picture away.
      expect(picture.w, `${id}: the fixture cuts nothing away`).toBeGreaterThan(box.w + 40);
      await enterCrop(id, box);
      const ghost = await onSlide('#canvas .mask-ghost');
      expect(ghost, `${id}: nothing shows what the crop cuts away`).not.toBeNull();
      near(ghost!, picture, `${id}: the ghost is not where the whole picture is painted`);
      // It is the picture itself, faint, not merely a tinted box.
      const copy = await eventually(() => cdp.evaluate<{ same: boolean; drawn: boolean; opacity: number } | null>(`(() => {
        const copy = document.querySelector('#canvas .mask-ghost > img, #canvas .mask-ghost > canvas');
        const live = document.querySelector('#canvas [data-element-id="${id}"]').querySelector('img, video');
        if (!copy) return null;
        const image = copy.tagName === 'IMG';
        return {
          same: image
            ? copy.currentSrc === live.currentSrc
            : copy.width === live.videoWidth && copy.height === live.videoHeight,
          drawn: image
            ? copy.complete && copy.naturalWidth > 0
            : copy.getContext('2d').getImageData(copy.width >> 1, copy.height >> 1, 1, 1).data[3] === 255,
          opacity: Number(getComputedStyle(copy).opacity),
        };
      })()`), `${id}: the ghost never showed the picture`, (c) => Boolean(c?.drawn));
      expect(copy!.same, `${id}: the ghost shows something other than this picture`).toBe(true);
      expect(copy!.opacity, `${id}: the ghost's picture is not faint`).toBeGreaterThan(0);
      expect(copy!.opacity, `${id}: the ghost's picture is not faint`).toBeLessThan(1);
      near((await onSlide('#canvas .mask-ghost > :is(img, canvas)'))!, picture,
        `${id}: the ghost's picture does not sit on the picture`);
      await leaveCrop();
    }
  });
});
