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
 * A picture or a video keeps its proportions while it is resized, Shift or
 * not: Shift locks proportions everywhere, and it used to free them here and
 * save the picture stretched for good. Unticking "Keep aspect ratio" is how a
 * picture is stretched, and then it squashes with its box: it fills the box
 * exactly, so the box is always the picture. A fitted (cover/contain) one used
 * to keep re-fitting instead — the box changed shape and the picture inside
 * did not. Real media, real input.
 */
const DECK_ID = 'stretch';

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

const media = (id: string, type: 'image' | 'video', x: number, src: string, fit: 'cover' | 'contain') => ({
  id, type, x, y: 300, w: 480, h: 270, rot: 0, z: 1, opacity: 1, class: [], style: {}, src, fit, sourceBox: null,
  ...(type === 'video'
    ? { autoplay: false, loop: true, muted: true, controls: false, start: 0, end: null, poster: null }
    : { alt: '' }),
});

describe.skipIf(!electronBinary)('resizing pictures and videos', () => {
  it('keeps proportions with or without Shift, and squashes the picture with its box once unticked', { timeout: 120_000 }, async () => {
    workDir = await mkdtemp(join(tmpdir(), 'stretch-'));
    const decksRoot = join(workDir, 'decks');
    const deckDir = join(decksRoot, DECK_ID);
    const profileDir = join(workDir, 'electron-profile');
    await mkdir(join(deckDir, 'assets'), { recursive: true });
    await mkdir(profileDir, { recursive: true });
    const pattern = ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=1'];
    execFileSync(getFfmpegPath(), [...pattern, '-frames:v', '1', join(deckDir, 'assets', 'pic.png')]);
    execFileSync(getFfmpegPath(), [...pattern, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', join(deckDir, 'assets', 'clip.mp4')]);
    const deck = emptyDeck('Stretch');
    deck.slides[0].elements = [
      media('pic', 'image', 120, 'assets/pic.png', 'cover'),
      media('clip', 'video', 1000, 'assets/clip.mp4', 'contain'),
    ] as Deck['slides'][number]['elements'];
    await saveDeck(deckDir, deck);
    await writeFile(join(deckDir, 'theme.css'), '.slide { background: #fff; }\n', 'utf8');
    server = await startCollabServer({ rootDir: decksRoot, clientDir: await collabClientDir(), host: '127.0.0.1', port: 0 });
    browser = await launchBrowser(`http://127.0.0.1:${server.port}/?deck=${DECK_ID}&name=Stretch`, profileDir);
    const target = await findTarget(browser.debugPort, (c) => c.url.includes(`deck=${DECK_ID}`), browser.log);
    editor = await Cdp.connect(target.webSocketDebuggerUrl!);
    const cdp = editor;

    /** The element's box and the media as drawn inside it, both in canvas pixels. */
    const drawn = (id: string) => cdp.evaluate<{ box: number; media: number; loaded: boolean }>(`(() => {
      const node = document.querySelector('#canvas [data-element-id="${id}"]');
      const tag = node.querySelector('img, video');
      const natural = tag.tagName === 'VIDEO' ? [tag.videoWidth, tag.videoHeight] : [tag.naturalWidth, tag.naturalHeight];
      const r = tag.getBoundingClientRect();
      // With object-fit the tag fills the box; what is painted is the fitted rect.
      const fit = getComputedStyle(tag).objectFit;
      let w = r.width, h = r.height;
      if (fit === 'cover' || fit === 'contain') {
        const s = (fit === 'cover' ? Math.max : Math.min)(w / natural[0], h / natural[1]);
        w = natural[0] * s; h = natural[1] * s;
      }
      return { box: node.offsetWidth / node.offsetHeight, media: w / h, loaded: natural[0] > 0 };
    })()`);
    await eventually(async () => (await drawn('pic')).loaded && (await drawn('clip')).loaded, 'the media never loaded');

    const corner = (id: string) => cdp.evaluate<{ x: number; y: number }>(`(() => {
      const r = document.querySelector('#canvas [data-element-id="${id}"]').getBoundingClientRect();
      return { x: r.right, y: r.bottom };
    })()`);
    const scale = await cdp.evaluate<number>(`document.querySelector('#canvas .slide').getBoundingClientRect().width / 1920`);
    const mouse = (type: string, x: number, y: number, shift: boolean) => cdp.call('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers: shift ? 8 : 0,
    });
    const resize = async (id: string, dx: number, dy: number, shift: boolean) => {
      const at = await corner(id);
      await cdp.clickAt(at.x - 40 * scale, at.y - 40 * scale);
      const handle = await cdp.evaluate<{ x: number; y: number }>(`(() => {
        const r = document.querySelector('.handle-se[data-element-id="${id}"]').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      await mouse('mouseMoved', handle.x, handle.y, shift);
      await mouse('mousePressed', handle.x, handle.y, shift);
      await mouse('mouseMoved', handle.x + (dx / 2) * scale, handle.y + (dy / 2) * scale, shift);
      await mouse('mouseMoved', handle.x + dx * scale, handle.y + dy * scale, shift);
      await mouse('mouseReleased', handle.x + dx * scale, handle.y + dy * scale, shift);
      await new Promise((resolve) => setTimeout(resolve, 300));
    };

    const saved = (id: string, ok: (el: Deck['slides'][number]['elements'][number]) => boolean, what: string) => eventually(async () => {
      const response = await fetch(`http://127.0.0.1:${server!.port}/api/deck?deck=${DECK_ID}`);
      const el = (await response.json() as Deck).slides[0].elements.find((e) => e.id === id);
      return el && ok(el) ? el : null;
    }, `${id}: ${what}`);

    for (const [id, fit] of [['pic', 'cover'], ['clip', 'contain']] as const) {
      const before = await drawn(id);
      // Without Shift the box keeps its shape, and the picture with it.
      await resize(id, 120, 10, false);
      const locked = await drawn(id);
      expect(locked.box, id).toBeCloseTo(before.box, 1);
      expect(locked.media, id).toBeCloseTo(160 / 90, 1);
      const lockedWidth = (await saved(id, (el) => el.w > 560, 'the resize never saved'))!.w;
      // With Shift too, and the box stays ticked.
      await resize(id, 160, -120, true);
      const shifted = await drawn(id);
      expect(shifted.box, `${id} Shift freed the box`).toBeCloseTo(before.box, 1);
      expect(shifted.media, id).toBeCloseTo(160 / 90, 1);
      const kept = await saved(id, (el) => el.w > lockedWidth + 60, 'the Shift resize never saved');
      expect('fit' in kept! ? kept.fit : null, `${id} Shift resize wrote the fit`).toBe(fit);

      // Untick "Keep aspect ratio": now a drag stretches the box.
      const box = await eventually(() => cdp.evaluate<{ x: number; y: number } | null>(`(() => {
        // A video's panel renders again once its clip length is probed,
        // shifting everything under a click aimed before that.
        if (document.querySelector('#inspector')?.textContent.includes('Reading clip length')) return null;
        const input = [...document.querySelectorAll('label.field-check')]
          .find((n) => n.textContent.trim() === 'Keep aspect ratio')?.querySelector('input');
        if (!input?.checked) return null;
        input.scrollIntoView({ block: 'center' });
        const r = input.getBoundingClientRect();
        return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      })()`), `${id}: no visible, ticked "Keep aspect ratio" box`);
      await cdp.clickAt(box!.x, box!.y);
      await saved(id, (el) => 'fit' in el && el.fit === 'fill', 'unticking never saved');
      // A much wider box, and the picture is as much wider: squashed. Kept
      // clear of the other element and of the slide's edge.
      await resize(id, 40, -160, false);
      const freed = await drawn(id);
      expect(freed.box, id).toBeGreaterThan(before.box * 1.5);
      expect(freed.media / (160 / 90), `${id} was not stretched`).toBeGreaterThan(1.4);
      // The box is the picture: it fills the box exactly, no crop, no bars.
      expect(freed.media, id).toBeCloseTo(freed.box, 2);
      const stretched = await saved(id, (el) => 'fit' in el && el.fit === 'fill' && el.h < kept!.h - 60,
        'the stretch never reached the deck');
      expect('sourceBox' in stretched! ? stretched.sourceBox : null).toBeNull();
    }
  });
});
