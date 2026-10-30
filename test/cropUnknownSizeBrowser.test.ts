import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveDeck } from '../src/main/deckStore.js';
import { getFfmpegPath } from '../src/main/ffmpeg.js';
import { startCollabServer, type RunningCollabServer } from '../src/server/collabServer.js';
import { emptyDeck, type Deck } from '../src/shared/deck.js';
import {
  Cdp,
  electronBinary,
  eventually,
  findTarget,
  launchBrowser,
  stopBrowser,
  type RunningBrowser,
} from './support/browserSession.js';
import { collabClientDir } from './support/collabClient.js';

/**
 * Cropping or circling a picture before its own size is known used to assume
 * it filled its frame, and locked that stretched guess into the crop for good:
 * a 16:9 picture in a square frame came out squashed square. The picture's
 * request is held open over DevTools, so it is really still loading; real
 * pointer input and the real inspector controls do the rest.
 */
const DECK_ID = 'crop-unknown-size';

let workDir = '';
let server: RunningCollabServer | null = null;
let browser: RunningBrowser | null = null;
let editor: Cdp | null = null;

afterEach(async () => {
  editor?.close();
  editor = null;
  await stopBrowser(browser?.process ?? null);
  browser = null;
  await server?.close();
  server = null;
  if (workDir) await rm(workDir, { recursive: true, force: true });
  workDir = '';
});

type Saved = {
  x: number; y: number; w: number; h: number;
  maskShape?: string;
  sourceBox: { x: number; y: number; w: number; h: number } | null;
};

describe.skipIf(!electronBinary)('cropping a picture whose size is not known yet', () => {
  it('refuses to crop, pan or circle it while it loads, and crops it true once it has', { timeout: 120_000 }, async () => {
    workDir = await mkdtemp(join(tmpdir(), 'crop-unknown-size-'));
    const decksRoot = join(workDir, 'decks');
    const deckDir = join(decksRoot, DECK_ID);
    const profileDir = join(workDir, 'electron-profile');
    await mkdir(join(deckDir, 'assets'), { recursive: true });
    await mkdir(profileDir, { recursive: true });
    execFileSync(getFfmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=1:duration=1',
      '-frames:v', '1', join(deckDir, 'assets', 'slow.png')]);
    const deck = emptyDeck('Crop unknown size');
    // A 16:9 picture letterboxed in a square frame: guessing that it fills
    // the frame is a visibly different picture.
    deck.slides[0].elements = [{
      id: 'slow', type: 'image', x: 120, y: 300, w: 480, h: 480, rot: 0, z: 1, opacity: 1,
      class: [], style: {}, src: 'assets/slow.png', alt: '', fit: 'contain', sourceBox: null,
    }] as Deck['slides'][number]['elements'];
    await saveDeck(deckDir, deck);
    await writeFile(join(deckDir, 'theme.css'), '.slide { background: #fff; }\n', 'utf8');
    server = await startCollabServer({ rootDir: decksRoot, clientDir: await collabClientDir(), host: '127.0.0.1', port: 0 });
    browser = await launchBrowser(`http://127.0.0.1:${server.port}/?deck=${DECK_ID}&name=Crop`, profileDir);
    const target = await findTarget(browser.debugPort, (c) => c.url.includes(`deck=${DECK_ID}`), browser.log);
    editor = await Cdp.connect(target.webSocketDebuggerUrl!);
    const cdp = editor;

    const local = () => cdp.evaluate<Saved>(
      `structuredClone(window.store.get().deck.slides[0].elements.find((e) => e.id === 'slow'))`,
    );
    const slideRect = () => cdp.evaluate<{ left: number; top: number; scale: number }>(`(() => {
      const r = document.querySelector('#canvas .slide').getBoundingClientRect();
      return { left: r.left, top: r.top, scale: r.width / 1920 };
    })()`);
    const mouse = (type: string, x: number, y: number) => cdp.call('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
    });
    /** Press at a viewport point and drag by (dx, dy) slide pixels. */
    const drag = async (x: number, y: number, dx: number, dy: number) => {
      const { scale } = await slideRect();
      await mouse('mouseMoved', x, y);
      await mouse('mousePressed', x, y);
      await mouse('mouseMoved', x + (dx / 2) * scale, y + (dy / 2) * scale);
      await mouse('mouseMoved', x + dx * scale, y + dy * scale);
      await mouse('mouseReleased', x + dx * scale, y + dy * scale);
    };
    const handle = () => cdp.evaluate<{ x: number; y: number }>(`(() => {
      const r = document.querySelector('.handle-se[data-element-id="slow"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    const clickControl = async (selector: string, text: string) => {
      const at = await eventually(() => cdp.evaluate<{ x: number; y: number } | null>(`(() => {
        const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .find((n) => n.textContent.trim() === ${JSON.stringify(text)});
        if (!node) return null;
        node.scrollIntoView({ block: 'center' });
        const r = (node.querySelector('input') ?? node).getBoundingClientRect();
        return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      })()`), `no visible "${text}" control`);
      await cdp.clickAt(at!.x, at!.y);
    };
    /** Select the picture and enter crop mode with the inspector's own button. */
    const editMask = async () => {
      const { left, top, scale } = await slideRect();
      await cdp.clickAt(left + 360 * scale, top + 540 * scale);
      await eventually(() => cdp.evaluate<boolean>(`(() => {
        const selection = [...window.store.get().selection];
        return selection.length === 1 && selection[0] === 'slow'
          && !!document.querySelector('.mask-action-row .panel-action');
      })()`), 'the picture never became the selection');
      await clickControl('.mask-action-row .panel-action', 'Edit mask');
      await eventually(() => cdp.evaluate<boolean>(`!!document.querySelector('#canvas .sel-box.masking')`), 'crop mode never began');
    };
    /** Clear the status bar, so the next message shows up as new. */
    const clearStatus = () => cdp.evaluate(`document.getElementById('status').textContent = ''`);
    const status = () => cdp.evaluate<string>(`document.getElementById('status').textContent`);

    await eventually(() => cdp.evaluate<boolean>(
      `document.querySelector('#canvas [data-element-id="slow"] img')?.naturalWidth > 0`,
    ), 'the picture never loaded the first time');

    // Hold the picture's request open and open the deck again: it is now a
    // picture still loading, with no size of its own yet.
    await cdp.call('Fetch.enable', { patterns: [{ urlPattern: '*slow.png*', requestStage: 'Request' }] });
    await cdp.call('Page.reload', { ignoreCache: true });
    await eventually(() => cdp.evaluate<boolean>(`(() => {
      const img = document.querySelector('#canvas [data-element-id="slow"] img');
      return !!window.store && !!img && !img.complete && img.naturalWidth === 0;
    })()`), 'the picture never stalled');
    const untouched = await local();
    expect(untouched.sourceBox).toBeNull();

    await editMask();

    // A crop handle drag changes nothing and says why.
    await clearStatus();
    const corner = await handle();
    await drag(corner.x, corner.y, -80, -120);
    expect(await local(), 'a crop of a picture still loading').toEqual(untouched);
    await eventually(async () => (await status()).includes('Picture still loading'), 'the crop never said why it did nothing');

    // So does dragging the picture behind its window.
    await clearStatus();
    const { left, top, scale } = await slideRect();
    await drag(left + 360 * scale, top + 540 * scale, 40, 30);
    expect(await local(), 'a pan of a picture still loading').toEqual(untouched);
    await eventually(async () => (await status()).includes('Picture still loading'), 'the pan never said why it did nothing');

    // And the inspector's circle, whose box goes back to unticked.
    await clearStatus();
    await clickControl('label.field-check', 'Circular mask');
    expect(await local(), 'a circle of a picture still loading').toEqual(untouched);
    await eventually(async () => (await status()).includes('Picture still loading'), 'the circle never said why it did nothing');
    expect(await cdp.evaluate<boolean>(`[...document.querySelectorAll('label.field-check')]
      .find((n) => n.textContent.trim() === 'Circular mask')?.querySelector('input').checked`)).toBe(false);

    // Soundness: once the picture has arrived, the very same drag crops, at
    // the picture's own proportions rather than the square frame's.
    await cdp.call('Fetch.disable');
    await cdp.call('Page.reload', { ignoreCache: true });
    await eventually(() => cdp.evaluate<boolean>(
      `!!window.store && document.querySelector('#canvas [data-element-id="slow"] img')?.naturalWidth > 0`,
    ), 'the picture never loaded after the stall');
    await editMask();
    const loadedCorner = await handle();
    await drag(loadedCorner.x, loadedCorner.y, -80, -120);
    const cropped = (await eventually(async () => {
      const el = await local();
      return el.sourceBox ? el : null;
    }, 'the crop never landed once the picture had loaded'))!;
    expect(cropped.sourceBox!.w / cropped.sourceBox!.h, 'the cropped picture is stretched').toBeCloseTo(160 / 90, 1);
  });
});
