import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Cdp, electronBinary, eventually, findTarget, wait, type DevToolsTarget } from './support/browserSession.js';
import { launchDesktopEditor, type DesktopEditor } from './support/desktopEditorSession.js';
import { isEditorTarget } from './support/desktopApp.js';
import { saveDeck } from '../src/main/deckStore.js';
import { emptyDeck } from '../src/shared/deck.js';

const TEXT_ID = 'unload-save-text';
let desktop: DesktopEditor;
let main: Cdp;

async function inMain<T>(expression: string): Promise<T> {
  const reply = await main.call('Runtime.evaluate', {
    expression, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true,
  });
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
  return reply.result?.value as T;
}

async function disk() {
  return JSON.parse(await readFile(join(desktop.deckDir, 'deck.json'), 'utf8'));
}
async function xOnDisk(): Promise<number> {
  return (await disk()).slides[0].elements.find((el: { id: string }) => el.id === TEXT_ID).x;
}
async function nudge(count = 1) {
  await desktop.cdp.click(`#canvas [data-element-id="${TEXT_ID}"]`, 'the text box');
  for (let i = 0; i < count; i++) await desktop.cdp.key('ArrowRight', 39);
}
const editorCount = () => inMain<number>(`require('electron').BrowserWindow.getAllWindows()
  .filter(w => w.webContents.getURL().includes('/editor/')).length`);
const closeWindow = () => inMain(`require('electron').BrowserWindow.getAllWindows()
  .find(w => w.webContents.getURL().includes('/editor/')).close()`);

// Hold a real IPC writer at its boundary, so the close must wait for it.
async function holdWriter(channel: string, failure = false) {
  await inMain(`(() => {
    const { ipcMain } = require('electron');
    const original = ipcMain._invokeHandlers.get(${JSON.stringify(channel)});
    globalThis.unloadWriteStarted = false;
    globalThis.unloadWriteReleased = false;
    const released = new Promise(resolve => { globalThis.releaseUnloadWrite = resolve; });
    ipcMain.removeHandler(${JSON.stringify(channel)});
    ipcMain.handle(${JSON.stringify(channel)}, async (event, ...args) => {
      globalThis.unloadWriteStarted = true;
      if (!globalThis.unloadWriteReleased) await released;
      if (${failure}) throw new Error('test disk write failed');
      return original(event, ...args);
    });
    globalThis.restoreUnloadWriter = () => {
      ipcMain.removeHandler(${JSON.stringify(channel)});
      ipcMain.handle(${JSON.stringify(channel)}, original);
    };
  })()`);
}
async function releaseWriter() {
  await inMain('globalThis.unloadWriteReleased = true; globalThis.releaseUnloadWrite?.()');
}

describe.skipIf(!electronBinary)('leaving the editor', () => {
  beforeEach(async () => {
    desktop = await launchDesktopEditor(TEXT_ID, '<p>nudge me</p>', ['--inspect=0']);
    const response = await fetch(`http://127.0.0.1:${desktop.app.inspectorPort}/json/list`);
    const [target] = await response.json() as Array<{ webSocketDebuggerUrl: string }>;
    main = await Cdp.connect(target.webSocketDebuggerUrl);
  }, 120_000);
  afterEach(async () => {
    main?.close();
    await desktop?.close();
  });

  it('reloads only after an in-flight save and the newer edit have reached disk', { timeout: 120_000 }, async () => {
    await holdWriter('deck:save');
    await nudge(2);
    await eventually(() => inMain<boolean>('globalThis.unloadWriteStarted'), 'autosave never started');
    for (let i = 0; i < 3; i++) await desktop.cdp.key('ArrowRight', 39);
    expect(await desktop.cdp.evaluate<number>(`parseFloat(document.querySelector('#canvas [data-element-id="${TEXT_ID}"]').style.left)`)).toBe(145);
    expect(await xOnDisk()).toBe(140);
    const before = await desktop.cdp.evaluate<number>('performance.timeOrigin');
    await desktop.cdp.call('Page.reload');
    await eventually(() => desktop.cdp.evaluate<boolean>(`document.querySelector('#status').getAttribute('aria-busy') === 'true'`), 'saving progress was never shown');
    expect(await desktop.cdp.evaluate<number>('performance.timeOrigin')).toBe(before);
    await releaseWriter();
    await eventually(() => desktop.cdp.evaluate<boolean>(`performance.timeOrigin !== ${before}
      && Boolean(document.querySelector('#canvas [data-element-id="${TEXT_ID}"]'))`), 'the editor did not return after saving and reloading');
    expect(await xOnDisk()).toBe(145);
  });

  it('closes the native window after committing an active text edit and history', { timeout: 120_000 }, async () => {
    await desktop.cdp.doubleClick(`#canvas [data-element-id="${TEXT_ID}"]`, 'the text box');
    await desktop.cdp.call('Input.insertText', { text: ' saved on close' });
    await closeWindow();
    await eventually(editorCount, 'the native editor window never closed', count => count === 0);
    expect((await disk()).slides[0].elements.find((el: { id: string }) => el.id === TEXT_ID).html).toContain('saved on close');
    const history = JSON.parse(gunzipSync(await readFile(join(desktop.deckDir, 'deck-history-v2.json.gz'))).toString());
    expect(JSON.stringify(history)).toContain('saved on close');
  });

  it('waits for a theme write already in flight', { timeout: 120_000 }, async () => {
    await holdWriter('deck:saveTheme');
    // Exercise the retained raw CSS editor, which has no tab in the current UI.
    await desktop.cdp.evaluate(`document.querySelector('#theme').hidden = false`);
    await desktop.cdp.evaluate(`(() => {
      const content = document.querySelector('#theme .cm-content');
      content.focus();
      const selection = getSelection();
      const range = document.createRange(); range.selectNodeContents(content);
      selection.removeAllRanges(); selection.addRange(range);
    })()`);
    await desktop.cdp.call('Input.insertText', { text: '.slide { background: rgb(12, 34, 56); }' });
    await eventually(() => inMain<boolean>('globalThis.unloadWriteStarted'), 'the theme writer never started');
    await closeWindow();
    await wait(650);
    expect(await editorCount()).toBe(1);
    await releaseWriter();
    await eventually(editorCount, 'the editor never closed after the theme save', count => count === 0);
    expect(await readFile(join(desktop.deckDir, 'theme.css'), 'utf8')).toContain('rgb(12, 34, 56)');
  });

  it('keeps the editor open when saving fails, then lets the user retry', { timeout: 120_000 }, async () => {
    await holdWriter('deck:save', true);
    await nudge(5);
    await closeWindow();
    await releaseWriter();
    await eventually(() => desktop.cdp.evaluate<boolean>(`document.querySelector('#status').textContent.includes('test disk write failed')`), 'the failed save was not explained');
    expect(await editorCount()).toBe(1);
    expect(await xOnDisk()).toBe(140);
    await inMain('globalThis.restoreUnloadWriter()');
    await closeWindow();
    await eventually(editorCount, 'the retry never closed the window', count => count === 0);
    expect(await xOnDisk()).toBe(145);
  });

  it('waits for a history write already in flight when Quit is requested', { timeout: 120_000 }, async () => {
    await holdWriter('deckHistory:save');
    await nudge(5);
    await eventually(() => inMain<boolean>('globalThis.unloadWriteStarted'), 'the history writer never started');
    await inMain(`require('electron').app.quit()`);
    await wait(650);
    expect(desktop.app.process.exitCode).toBeNull();
    expect(await editorCount()).toBe(1);
    await releaseWriter();
    main.close(); // Node waits for its debugger to disconnect before exiting.
    await eventually(async () => desktop.app.process.exitCode !== null,
      `Quit never finished. App output: ${desktop.app.log()}`);
    expect(desktop.app.process.exitCode).toBe(0);
    expect(await xOnDisk()).toBe(145);
    const history = JSON.parse(gunzipSync(await readFile(join(desktop.deckDir, 'deck-history-v2.json.gz'))).toString());
    expect(JSON.stringify(history)).toContain('unload-save-text');
  });

  it('saves speaker notes while their field is still focused', { timeout: 120_000 }, async () => {
    await desktop.cdp.click('.notes-toggle', 'Speaker notes');
    await desktop.cdp.call('Input.insertText', { text: 'Notes saved on close.' });
    await closeWindow();
    await eventually(editorCount, 'the notes editor did not close', count => count === 0);
    expect((await disk()).slides[0].notes).toContain('Notes saved on close.');
    expect(await readFile(join(desktop.deckDir, 'notes.md'), 'utf8')).toContain('Notes saved on close.');
  });

  it('saves both documents when Quit closes two editor windows', { timeout: 120_000 }, async () => {
    const targets = await (await fetch(`http://127.0.0.1:${desktop.app.debugPort}/json/list`)).json() as DevToolsTarget[];
    const secondDir = join(desktop.deckDir, '..', 'second-deck');
    const secondDeck = emptyDeck('Second document');
    secondDeck.slides[0].elements = (await disk()).slides[0].elements;
    await saveDeck(secondDir, secondDeck);
    await writeFile(join(secondDir, 'theme.css'), '.slide { background: white; }');
    await desktop.cdp.evaluate(`window.api.openDeckPath(${JSON.stringify(secondDir)})`);
    const target = await findTarget(desktop.app.debugPort,
      candidate => isEditorTarget(candidate) && !targets.some(old => old.id === candidate.id), desktop.app.log);
    const second = await Cdp.connect(target.webSocketDebuggerUrl!);
    try {
      await eventually(() => second.evaluate<boolean>(`Boolean(document.querySelector('#canvas [data-element-id="${TEXT_ID}"]'))`), 'the second editor did not load');
      await holdWriter('deck:save');
      await nudge(2);
      await second.click(`#canvas [data-element-id="${TEXT_ID}"]`, 'the second document’s text box');
      for (let i = 0; i < 3; i++) await second.key('ArrowRight', 39);
      await inMain(`require('electron').app.quit()`);
      await wait(650);
      expect(await editorCount()).toBe(2);
      await releaseWriter();
      main.close();
      await eventually(async () => desktop.app.process.exitCode !== null, 'the app did not finish saving both documents');
      expect(desktop.app.process.exitCode).toBe(0);
      expect(await xOnDisk()).toBe(142);
      const savedSecond = JSON.parse(await readFile(join(secondDir, 'deck.json'), 'utf8'));
      expect(savedSecond.slides[0].elements.find((el: { id: string }) => el.id === TEXT_ID).x).toBe(143);
    } finally { second.close(); }
  });

  it('keeps an unfinished input-method composition open until it is committed', { timeout: 120_000 }, async () => {
    await desktop.cdp.doubleClick(`#canvas [data-element-id="${TEXT_ID}"]`, 'the text box');
    await desktop.cdp.call('Input.imeSetComposition', { text: 'かな', selectionStart: 2, selectionEnd: 2 });
    await closeWindow();
    await eventually(() => desktop.cdp.evaluate<boolean>(`document.querySelector('#status').textContent.includes('Finish entering text')`), 'closing did not preserve the unfinished composition');
    expect(await editorCount()).toBe(1);
    await desktop.cdp.call('Input.insertText', { text: 'かな' });
    await closeWindow();
    await eventually(editorCount, 'the editor did not close after composition finished', count => count === 0);
    expect((await disk()).slides[0].elements.find((el: { id: string }) => el.id === TEXT_ID).html).toContain('かな');
  });

  for (const action of ['close', 'quit'] as const) {
    it(`persists the collaboration host's last edit before ${action}`, { timeout: 120_000 }, async () => {
      await desktop.cdp.evaluate(`window.api.startAgentSession({
        agent: true, activeSlideId: null, selectedSlideIds: [], selectedElementIds: [],
      })`);
      await eventually(() => desktop.cdp.evaluate<boolean>(`document.querySelector('#status').textContent.includes('Filesystem agent connected')`), 'the editor did not join its collaboration server');
      await nudge(5);
      expect(await xOnDisk()).toBe(140);
      if (action === 'close') {
        await closeWindow();
        await eventually(editorCount, 'the host window did not close', count => count === 0);
      } else {
        await inMain(`require('electron').app.quit()`);
        main.close();
        await eventually(async () => desktop.app.process.exitCode !== null, 'the collaboration host did not quit');
        expect(desktop.app.process.exitCode).toBe(0);
      }
      expect(await xOnDisk()).toBe(145);
    });
  }
});
