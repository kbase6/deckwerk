import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveDeck } from '../src/main/deckStore.js';
import { startCollabServer, type RunningCollabServer } from '../src/server/collabServer.js';
import { emptyDeck } from '../src/shared/deck.js';
import { Cdp, electronBinary, eventually, findTarget, launchBrowser, stopBrowser, type RunningBrowser } from './support/browserSession.js';
import { collabClientDir } from './support/collabClient.js';
import { launchDesktopEditor, type DesktopEditor } from './support/desktopEditorSession.js';

/**
 * Harper spelling marks in the shipped desktop shell: a misspelling in the
 * box being edited is painted (CSS highlight, no DOM added), the right-click
 * menu offers the fix, applying it is one undo step, and leaving the box
 * clears every mark.
 */
const TEXT_ID = 'spell-text';
const CONTENT = `#canvas [data-element-id="${TEXT_ID}"] .text-content`;
const MOD = process.platform === 'darwin' ? 4 : 2;

let desktop: DesktopEditor | null = null;
let workDir = '';
let server: RunningCollabServer | null = null;
let browser: RunningBrowser | null = null;
let page: Cdp | null = null;

afterEach(async () => {
  await desktop?.close();
  desktop = null;
  page?.close();
  page = null;
  await stopBrowser(browser?.process ?? null);
  browser = null;
  await server?.close();
  server = null;
  if (workDir) await rm(workDir, { recursive: true, force: true });
  workDir = '';
});

const MARKS = `(() => {
  const h = CSS.highlights.get('deckwerk-spelling');
  return h ? [...h].map((r) => r.toString()) : [];
})()`;

describe.skipIf(!electronBinary)('inline spellcheck', () => {
  it('loads the grammar as a local WASM file and starts a fresh worker offline', async () => {
    workDir = await mkdtemp(join(tmpdir(), 'spellcheck-offline-'));
    const decksRoot = join(workDir, 'decks');
    const deckDir = join(decksRoot, 'spelling');
    const profileDir = join(workDir, 'profile');
    await mkdir(deckDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    const deck = emptyDeck('Spelling offline');
    deck.slides[0].elements.push({
      id: TEXT_ID, type: 'text', x: 140, y: 150, w: 1640, h: 500, z: 1,
      html: '<p>We propsoe a method</p>', class: ['role-body'], style: {},
    } as never);
    await saveDeck(deckDir, deck);
    await writeFile(join(deckDir, 'theme.css'), '.role-body { font: 42px Arial; }');
    server = await startCollabServer({
      rootDir: decksRoot, clientDir: await collabClientDir(), host: '127.0.0.1', port: 0,
    });
    browser = await launchBrowser(`http://127.0.0.1:${server.port}/?deck=spelling&name=Test`, profileDir);
    const target = await findTarget(browser.debugPort, (candidate) => candidate.url.includes('deck=spelling'), browser.log);
    page = await Cdp.connect(target.webSocketDebuggerUrl!);
    await eventually(async () => page!.evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(CONTENT)}))`), 'the browser editor did not open');
    await eventually(async () => page!.evaluate<boolean>('Boolean(navigator.serviceWorker.controller)'), 'the offline cache did not become ready', Boolean, 60_000);
    await page.doubleClickTextAtOffset(CONTENT, 'We propsoe a met'.length, 'the word "method"');
    await eventually(async () => (await page!.evaluate<string[]>(MARKS)).join() === 'propsoe', 'the browser spellchecker did not mark the misspelling', Boolean, 60_000);

    const assets = await page.evaluate<{ wasm: string[]; worker: string | undefined }>(`(async () => {
      const urls = new Set();
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) urls.add(request.url);
      }
      return { wasm: [...urls].filter((url) => /harper_wasm_bg-.*\\.wasm$/.test(url)),
        worker: [...urls].find((url) => /spellcheckWorker-.*\\.js$/.test(url)) };
    })()`);
    expect(assets.wasm).toHaveLength(1);
    expect(assets.worker).toBeDefined();
    const response = await fetch(assets.wasm[0]);
    expect(response.headers.get('content-type')).toBe('application/wasm');
    await response.body?.cancel();
    await server.close();
    server = null;

    const reply = await page.evaluate<{ error?: string; lints?: Array<{ suggestions: string[] }> }>(`new Promise((resolve, reject) => {
      const worker = new Worker(${JSON.stringify(assets.worker)}, { type: 'module' });
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('offline spellcheck timed out')); }, 20_000);
      worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data); };
      worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ id: 1, op: 'lint', text: 'We propsoe a method' });
    })`);
    expect(reply.error).toBeUndefined();
    expect(reply.lints).toHaveLength(1);
    expect(reply.lints![0].suggestions).toContain('propose');
  }, 120_000);

  it('flags a misspelling, fixes it from the context menu, and undoes the fix', async () => {
    desktop = await launchDesktopEditor(TEXT_ID, '<p>We propsoe a method</p>');
    const cdp = desktop.cdp;
    await cdp.doubleClickTextAtOffset(CONTENT, 'We propsoe a met'.length, 'the word "method"');
    await eventually(
      async () => (await cdp.evaluate<string[]>(MARKS)).join() === 'propsoe',
      'Harper never marked "propsoe"',
      Boolean,
      60_000,
    );
    // The marks are paint only: the authored markup is untouched.
    expect(await cdp.evaluate(`document.querySelector(${JSON.stringify(CONTENT)}).innerHTML`))
      .toBe('<p>We propsoe a method</p>');

    const point = await cdp.evaluate<{ x: number; y: number }>(`(() => {
      const r = [...CSS.highlights.get('deckwerk-spelling')][0].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await cdp.rightClickAt(point.x, point.y);
    await cdp.clickByText('#ctx-menu button', 'propose');

    const text = () => cdp.evaluate<string>(`document.querySelector(${JSON.stringify(CONTENT)}).textContent`);
    expect(await text()).toBe('We propose a method');
    await eventually(async () => (await cdp.evaluate<string[]>(MARKS)).length === 0, 'the fixed word stayed marked');
    expect(await cdp.evaluate('Boolean(document.querySelector("#canvas .editing"))')).toBe(true);

    await cdp.chord('z', 'KeyZ', 90, MOD);
    await eventually(async () => (await text()) === 'We propsoe a method', 'undo did not take the fix back');

    // Leaving the box clears every mark (asserted by the canvas, too).
    await cdp.key('Escape', 27);
    await eventually(
      async () => cdp.evaluate<boolean>(`!document.querySelector('#canvas .editing')
        && !CSS.highlights.has('deckwerk-spelling') && !CSS.highlights.has('deckwerk-grammar')`),
      'a spelling mark outlived the edit session',
    );
  }, 120_000);
});
