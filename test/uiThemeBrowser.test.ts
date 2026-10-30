import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveDeck } from '../src/main/deckStore.js';
import { startCollabServer, type RunningCollabServer } from '../src/server/collabServer.js';
import { emptyDeck, parseDeck } from '../src/shared/deck.js';
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
import { isEditorTarget, launchDesktopApp, materializeDesktopApp } from './support/desktopApp.js';
import { launchWebEditor, type WebEditorSession } from './support/webEditorSession.js';

/**
 * Light mode in the real editor.
 *
 * Appearance → Light in the DeckWerk menu turns the chrome light (the slide
 * keeps its own theme), the menu then ticks Light, and the choice survives a
 * reload. In the desktop app the native parts — dialogs, menus, the window
 * behind the page — follow the same choice rather than the OS.
 */
const DECK_ID = 'light';

let workDir = '';
let server: RunningCollabServer | null = null;
let browser: RunningBrowser | null = null;
let editor: Cdp | null = null;
let main: Cdp | null = null;
let appProcess: ChildProcess | null = null;
let session: WebEditorSession | null = null;

afterEach(async () => {
  await session?.close();
  session = null;
  editor?.close();
  editor = null;
  main?.close();
  main = null;
  await stopBrowser(browser?.process ?? null);
  browser = null;
  await stopBrowser(appProcess);
  appProcess = null;
  await server?.close();
  server = null;
  if (workDir) await rm(workDir, { recursive: true, force: true });
  workDir = '';
});

describe.skipIf(!electronBinary)('light mode', () => {
  it('turns the chrome light from the DeckWerk menu and keeps it across a reload', { timeout: 120_000 }, async () => {
    workDir = await mkdtemp(join(tmpdir(), 'light-'));
    const decksRoot = join(workDir, 'decks');
    const deckDir = join(decksRoot, DECK_ID);
    const clientDir = await collabClientDir();
    const profileDir = join(workDir, 'electron-profile');
    await mkdir(deckDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await saveDeck(deckDir, emptyDeck('Light'));
    server = await startCollabServer({ rootDir: decksRoot, clientDir, host: '127.0.0.1', port: 0 });
    browser = await launchBrowser(`http://127.0.0.1:${server.port}/?deck=${DECK_ID}&name=Light`, profileDir);
    const target = await findTarget(browser.debugPort, (c) => c.url.includes(`deck=${DECK_ID}`), browser.log);
    editor = await Cdp.connect(target.webSocketDebuggerUrl!);
    await eventually(async () => editor!.evaluate<boolean>(`Boolean(document.querySelector('.brand-button'))`), 'no DeckWerk menu');
    const choose = async (name: string): Promise<void> => {
      await editor!.click('.brand-button', 'the DeckWerk menu');
      await editor!.evaluate(
        `[...document.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === ${JSON.stringify(name)}).click()`,
      );
    };
    // System follows the machine's appearance, so pin Dark first.
    await choose('Dark');
    expect(await editor.evaluate<string>('document.documentElement.dataset.uiTheme')).toBe('dark');
    await choose('Light');
    expect(await editor.evaluate<string>('document.documentElement.dataset.uiTheme')).toBe('light');
    await editor.click('.brand-button', 'the DeckWerk menu');
    expect(await editor.evaluate<string | null>(
      `[...document.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Light').getAttribute('aria-checked')`,
    )).toBe('true');
    expect(await editor.evaluate<string>('getComputedStyle(document.getElementById("toolbar")).backgroundColor'))
      .toBe('rgb(248, 249, 251)');
    expect(await editor.evaluate<string>('getComputedStyle(document.querySelector(".canvas-host")).backgroundColor'))
      .toBe('rgb(223, 226, 232)');

    await editor.evaluate('location.reload()');
    await eventually(async () => editor!.evaluate<string | undefined>('document.documentElement.dataset.uiTheme'),
      'theme lost on reload', (theme) => theme === 'light');
  });

  it('desktop app: native window parts follow the chosen appearance, not the OS', { timeout: 120_000 }, async () => {
    workDir = await mkdtemp(join(tmpdir(), 'light-desktop-'));
    const deckDir = join(workDir, 'deck');
    const profileDir = join(workDir, 'electron-profile');
    await mkdir(profileDir, { recursive: true });
    await saveDeck(deckDir, emptyDeck('Light'));
    const appDir = join(workDir, 'app');
    await materializeDesktopApp(appDir, 'deckwerk-ui-theme-test');
    const app = await launchDesktopApp(appDir, [deckDir, '--inspect=0'], { profileDir });
    appProcess = app.process;
    const target = await findTarget(app.debugPort, isEditorTarget, app.log);
    editor = await Cdp.connect(target.webSocketDebuggerUrl!);
    const inspector = await eventually(async () => {
      const response = await fetch(`http://127.0.0.1:${app.inspectorPort}/json/list`);
      const [first] = await response.json() as Array<{ webSocketDebuggerUrl?: string }>;
      return first?.webSocketDebuggerUrl ?? null;
    }, 'the Electron main-process inspector did not come up', (url) => Boolean(url));
    main = await Cdp.connect(inspector!);
    // What the OS draws for this app: dialogs, menus, the window behind the page.
    const native = async (): Promise<{ source: string; background: string }> => {
      const reply = await main!.call('Runtime.evaluate', {
        expression: `(() => {
          const { BrowserWindow, nativeTheme } = require('electron');
          const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/editor/'));
          return { source: nativeTheme.themeSource, background: win?.getBackgroundColor() ?? '' };
        })()`,
        includeCommandLineAPI: true,
        returnByValue: true,
      });
      return reply.result.value;
    };
    await eventually(async () => editor!.evaluate<boolean>(`Boolean(document.querySelector('.brand-button'))`), 'no DeckWerk menu');
    const choose = async (name: string): Promise<void> => {
      await editor!.click('.brand-button', 'the DeckWerk menu');
      await editor!.evaluate(
        `[...document.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === ${JSON.stringify(name)}).click()`,
      );
    };

    // Both directions, so the test bites whichever appearance the OS is in.
    await choose('Dark');
    expect(await eventually(native, 'native parts stayed on the OS appearance',
      (n) => n.source === 'dark')).toEqual({ source: 'dark', background: '#16161E' });
    await eventually(async () => editor!.evaluate<boolean>(`matchMedia('(prefers-color-scheme: dark)').matches`),
      'pages still see the OS appearance');
    await choose('Light');
    expect(await eventually(native, 'native parts stayed dark under Light',
      (n) => n.source === 'light')).toEqual({ source: 'light', background: '#ECEEF2' });
    await eventually(async () => editor!.evaluate<boolean>(`matchMedia('(prefers-color-scheme: light)').matches`),
      'pages still see the OS appearance');
    await choose('Match system');
    expect((await eventually(native, 'native parts kept the old choice',
      (n) => n.source === 'system')).source).toBe('system');
  });

  // A deck's theme.css sits in the editor's own document. When it named its
  // colours --bg, --text or --accent it recoloured the dark chrome, and in
  // light mode the chrome's palette replaced the deck's on its own slides.
  it('keeps a deck theme.css and the chrome palette out of each other', { timeout: 120_000 }, async () => {
    session = await launchWebEditor([{
      id: DECK_ID,
      deck: parseDeck({
        ...emptyDeck('Tokens'),
        slides: [{ id: 'slide-1', elements: [{ id: 'title', type: 'text', x: 140, y: 150, w: 1640, h: 200,
          class: ['role-title'], html: 'Deck accent' }] }],
      }),
      themeCss: ':root { --bg: #00ff00; --text: #ff00ff; --accent: #ff0000; }\n'
        + '.slide { background: #fff; }\n.role-title { color: var(--accent); }\n',
    }], { readyWhen: `Boolean(document.querySelector('#canvas .slide .role-title'))` });
    const page = session.cdp;
    const read = (expression: string): Promise<string> => page.evaluate<string>(expression);
    for (const [theme, chrome] of Object.entries({
      dark: { background: 'rgb(22, 22, 30)', color: 'rgb(200, 208, 245)' },
      light: { background: 'rgb(236, 238, 242)', color: 'rgb(31, 35, 48)' },
    })) {
      await page.click('.brand-button', 'the DeckWerk menu');
      await page.evaluate(`[...document.querySelectorAll('[role="menuitemradio"]')]
        .find((i) => i.textContent === ${JSON.stringify(theme[0].toUpperCase() + theme.slice(1))}).click()`);
      expect(await read('document.documentElement.dataset.uiTheme')).toBe(theme);
      expect(await read('getComputedStyle(document.body).backgroundColor'), `${theme} chrome`).toBe(chrome.background);
      expect(await read('getComputedStyle(document.body).color'), `${theme} chrome`).toBe(chrome.color);
      expect(await read(`getComputedStyle(document.querySelector('#canvas .slide .role-title')).color`), `${theme} slide`)
        .toBe('rgb(255, 0, 0)');
    }
  });
});
