import { type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveDeck } from '../src/main/deckStore.js';
import { emptyDeck, parseDeck } from '../src/shared/deck.js';
import {
  Cdp,
  electronBinary,
  eventually,
  findTarget,
  stopBrowser,
  wait,
} from './support/browserSession.js';
import { isEditorTarget, launchDesktopApp, materializeDesktopApp } from './support/desktopApp.js';

/**
 * Speaker View keys after a footer click, slide numbers beside an author's own
 * `.slide-number`, Enter in the web export dialog, and the zoom bar's Gridlines
 * toggle — each driven through the REAL desktop app with real CDP mouse and
 * key input, and read back from what the editor, the rail, the audience
 * window and Speaker View actually draw. Only the native save panel is
 * scripted (DECKWERK_TEST_DIALOGS, see src/main/dialogs.ts).
 */

const FOOTER = '.slide-number:not([data-element-id])';
const USER_NUMBER = '[data-element-id="my-number"]';
const BOLD_TEXT = '[data-element-id="bold-text"]';
const GRIDLINES = '.zoom-controls .zoom-gridlines';

let workDir = '';
let deckDir = '';
let dialogQueue = '';
let appProcess: ChildProcess | null = null;
let appLog: () => string = () => '';
let debugPort = 0;
let editor: Cdp | null = null;
let speaker: Cdp | null = null;
let audience: Cdp | null = null;

function text(id: string, html: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, type: 'text', x: 160, y: 200, w: 1600, h: 200, rot: 0, z: 1, opacity: 1,
    class: ['role-body'], style: {}, html, align: 'left', valign: 'top', ...extra,
  };
}

/** The deck as saved on disk, so an editor-only control can be shown not to touch it. */
async function deckOnDisk(): Promise<{ raw: string; showSlideNumbers: boolean }> {
  const raw = await readFile(join(deckDir, 'deck.json'), 'utf8');
  return { raw, showSlideNumbers: JSON.parse(raw).showSlideNumbers === true };
}

/** Real click on Props → Layout → "Show slide numbers". */
async function clickShowSlideNumbers(): Promise<boolean> {
  const checked = await editor!.evaluate<boolean | null>(`(() => {
    const field = [...document.querySelectorAll('#inspector label.field-check')]
      .find((node) => node.querySelector('span')?.textContent === 'Show slide numbers (all slides)');
    const input = field?.querySelector('input');
    if (!input) return null;
    input.id = 'test-show-slide-numbers';
    return input.checked;
  })()`);
  expect(checked, 'Props → Layout offers "Show slide numbers"').not.toBe(null);
  await editor!.click('#test-show-slide-numbers', 'Show slide numbers');
  return !checked;
}

/**
 * Slide 2 on the canvas, and numbered or not when `numbered` says so, so each
 * case runs on its own (`-t`) as well as after the ones before it.
 */
async function onSlide2(numbered?: boolean): Promise<void> {
  await editor!.click('#rail .rail-item[data-slide-id="slide-2"]', 'rail row 2');
  await eventually(async () => editor!.evaluate<boolean>(
    `Boolean(document.querySelector('#canvas .slide[data-slide-id="slide-2"] ${USER_NUMBER}'))`),
  'slide 2 did not open on the canvas');
  if (numbered === undefined) return;
  const checked = await editor!.evaluate<boolean | null>(`(() => {
    const field = [...document.querySelectorAll('#inspector label.field-check')]
      .find((node) => node.querySelector('span')?.textContent === 'Show slide numbers (all slides)');
    return field?.querySelector('input')?.checked ?? null;
  })()`);
  if (checked !== numbered) expect(await clickShowSlideNumbers()).toBe(numbered);
}

/** What the canvas and the slide-2 rail thumbnail draw for numbers. */
async function numbersDrawn(): Promise<{
  canvasFooter: string | null;
  canvasUser: string | null;
  canvasUserBox: string | null;
  railFooters: Record<string, string | null>;
  railUser: string | null;
}> {
  return editor!.evaluate(`(() => {
    const root = document.querySelector('#canvas .slide[data-slide-id="slide-2"]');
    const user = root?.querySelector('${USER_NUMBER}');
    const box = (node) => {
      if (!node || !root) return null;
      const a = node.getBoundingClientRect();
      const b = root.getBoundingClientRect();
      return [a.left - b.left, a.top - b.top, a.width, a.height].map(Math.round).join(',');
    };
    const railFooters = {};
    for (const id of ['slide-1', 'slide-2', 'slide-3']) {
      railFooters[id] = document.querySelector(
        '#rail .rail-item[data-slide-id="' + id + '"] .slide > ${FOOTER}',
      )?.textContent ?? null;
    }
    return {
      canvasFooter: root?.querySelector(':scope > ${FOOTER}')?.textContent ?? null,
      canvasUser: user?.textContent?.trim() ?? null,
      canvasUserBox: box(user),
      railFooters,
      railUser: document.querySelector(
        '#rail .rail-item[data-slide-id="slide-2"] ${USER_NUMBER}',
      )?.textContent?.trim() ?? null,
    };
  })()`);
}

/** Speaker View's position line, its current-slide number and the audience's. */
async function presenting(): Promise<{ position: string; speakerNumber: string | null; audienceNumber: string | null }> {
  const [position, speakerNumber] = await speaker!.evaluate<[string, string | null]>(`[
    document.querySelector('.speaker-position')?.textContent ?? '',
    document.querySelector('.speaker-current .stage > .slide > ${FOOTER}')?.textContent ?? null,
  ]`);
  const audienceNumber = await audience!.evaluate<string | null>(
    `document.querySelector('.stage > .slide > ${FOOTER}')?.textContent ?? null`,
  );
  return { position, speakerNumber, audienceNumber };
}

describe.skipIf(!electronBinary)('presenter keys, slide numbers, web export and gridlines (desktop)', () => {
  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'presenter-numbers-'));
    const appDir = join(workDir, 'app');
    const profileDir = join(workDir, 'electron-profile');
    deckDir = join(workDir, 'deck');
    dialogQueue = join(workDir, 'dialogs.json');
    await mkdir(appDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await writeFile(dialogQueue, '[]', 'utf8');
    await materializeDesktopApp(appDir, 'deckwerk-presenter-numbers-test');

    // Slide 1 is a title slide, so it carries no number and slide 2 is "1":
    // a footer that just echoed the rail position would read "2".
    const base = emptyDeck('Presenter numbers');
    const deck = parseDeck({
      ...base,
      slides: [
        { id: 'slide-1', name: 'Title', layout: 'title', elements: [text('t1', 'Opening title')] },
        {
          id: 'slide-2',
          name: 'Two',
          elements: [
            text('bold-text', 'Bold body', { style: { 'font-weight': '700' } }),
            // The author's own element that happens to use the footer's class.
            text('my-number', 'Custom 42', { class: ['role-caption', 'slide-number'], x: 120, y: 860, w: 480, h: 120, z: 2 }),
          ],
        },
        ...[3, 4, 5, 6].map((n) => ({ id: `slide-${n}`, name: `S${n}`, elements: [text(`t${n}`, `Body ${n}`)] })),
      ],
    });
    await saveDeck(deckDir, deck);
    await writeFile(join(deckDir, 'theme.css'), [
      '.slide { background: #fff; color: #111827; }',
      '.role-body { font: 400 42px/1.3 Arial, sans-serif; }',
      '.role-caption { font: 400 28px/1.2 Arial, sans-serif; }',
      '',
    ].join('\n'), 'utf8');

    const app = await launchDesktopApp(appDir, [deckDir], {
      profileDir,
      cwd: appDir,
      env: { DECKWERK_TEST_DIALOGS: dialogQueue },
    });
    appProcess = app.process;
    appLog = app.log;
    debugPort = app.debugPort;
    const target = await findTarget(debugPort, isEditorTarget, appLog, 30_000);
    editor = await Cdp.connect(target.webSocketDebuggerUrl!);
    await eventually(async () => editor!.evaluate<boolean>(`window.api.getDeck().then(
      (session) => session?.dir === ${JSON.stringify(deckDir)}
        && Boolean(document.querySelector('#canvas .slide'))
        && !document.body.classList.contains('welcome-mode')
        && document.querySelectorAll('#rail .rail-item[data-slide-id]').length === 6
    )`), 'the desktop editor did not open the fixture');
    await editor.call('Page.bringToFront');
    await editor.evaluate('window.focus()');
  }, 300_000);

  afterAll(async () => {
    speaker?.close();
    audience?.close();
    editor?.close();
    await stopBrowser(appProcess);
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it('submits Export for the web on Enter straight after it opens', { timeout: 60_000 }, async () => {
    await writeFile(dialogQueue, JSON.stringify([{ canceled: true }]), 'utf8');
    // The responsive toolbar shows either Save As… → Web… or File → Export Web….
    const viaFile = await editor!.evaluate<boolean>(`[...document.querySelectorAll('#toolbar .shape-menu-trigger')]
      .some((node) => node.textContent?.trim() === 'File' && node.getClientRects().length > 0)`);
    await editor!.clickByText('#toolbar .shape-menu-trigger', viaFile ? 'File' : 'Save As…');
    await editor!.clickByText('.shape-menu-item', viaFile ? 'Export Web…' : 'Web…');
    await eventually(async () => editor!.evaluate<boolean>(
      `Boolean(document.querySelector('.web-export-dialog'))`), 'Export for the web did not open');

    // Focus starts on the Slides scope picker, not the media-quality one.
    const focused = await editor!.evaluate<string | null>(`(() => {
      const node = document.activeElement;
      if (!node?.closest('.web-export-dialog') || node.tagName !== 'SELECT') return null;
      return node.closest('label')?.querySelector('span')?.textContent ?? '';
    })()`);
    expect(focused).toBe('Slides');

    await editor!.key('Enter', 13);
    await eventually(async () => editor!.evaluate<boolean>(
      `!document.querySelector('.web-export-dialog')`), 'Enter did not submit the web export dialog');
    // The submit reached the main process: it asked for (and consumed) the
    // scripted save panel, which answered Cancel.
    await eventually(() => readFile(dialogQueue, 'utf8'), 'the export never asked where to save',
      (queue) => queue.trim() === '[]');
  });

  it('numbers slides beside an author\'s own .slide-number, on the canvas and in the rail', { timeout: 60_000 }, async () => {
    await onSlide2(false);

    const off = await numbersDrawn();
    expect(off).toMatchObject({
      canvasFooter: null,
      canvasUser: 'Custom 42',
      railFooters: { 'slide-1': null, 'slide-2': null, 'slide-3': null },
      railUser: 'Custom 42',
    });
    expect(off.canvasUserBox).not.toBe(null);

    expect(await clickShowSlideNumbers()).toBe(true);
    const on = await eventually(numbersDrawn, 'numbering never reached the canvas and the rail',
      (drawn) => drawn.canvasFooter !== null && drawn.railFooters['slide-2'] !== null);
    expect(on).toEqual({
      canvasFooter: '1',
      canvasUser: 'Custom 42',
      canvasUserBox: off.canvasUserBox,
      railFooters: { 'slide-1': null, 'slide-2': '1', 'slide-3': '2' },
      railUser: 'Custom 42',
    });
    await eventually(deckOnDisk, 'Show slide numbers was not saved with the deck',
      (disk) => disk.showSlideNumbers);

    // Off again: only the footer goes; the author's element stays put.
    expect(await clickShowSlideNumbers()).toBe(false);
    const offAgain = await eventually(numbersDrawn, 'turning numbering off left a footer behind',
      (drawn) => drawn.canvasFooter === null && drawn.railFooters['slide-3'] === null);
    expect(offAgain).toEqual(off);

    // Back on for Speaker View below.
    expect(await clickShowSlideNumbers()).toBe(true);
    await eventually(numbersDrawn, 'numbering did not come back', (drawn) => drawn.canvasFooter === '1');
    await eventually(deckOnDisk, 'the deck was not saved numbered', (disk) => disk.showSlideNumbers);
  });

  it('toggles Gridlines as editor chrome, pressed like the app\'s other toggles', { timeout: 60_000 }, async () => {
    await onSlide2();
    // A pressed inspector toggle to compare with: Bold, on a bold text box.
    const box = await editor!.evaluate<{ x: number; y: number }>(`(() => {
      const r = document.querySelector('#canvas ${BOLD_TEXT}').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await editor!.clickAt(box.x, box.y);
    await eventually(async () => editor!.evaluate<boolean>(
      `Boolean(document.querySelector('#inspector .text-format-buttons button.text-format-bold[aria-pressed="true"]'))`),
    'selecting the bold box did not show a pressed Bold button');
    const look = (selector: string) => editor!.evaluate<{ background: string; border: string; color: string }>(`(() => {
      const style = getComputedStyle(document.querySelector(${JSON.stringify(selector)}));
      return { background: style.backgroundColor, border: style.borderTopColor, color: style.color };
    })()`);
    const pressedBold = await look('#inspector .text-format-buttons button[aria-pressed="true"]');

    await wait(1_500); // let any pending autosave land before the baseline
    const diskBefore = (await deckOnDisk()).raw;
    const sessionDeck = () => editor!.evaluate<string>(
      'window.api.getDeck().then((session) => JSON.stringify(session?.deck))');
    const sessionBefore = await sessionDeck();
    const state = () => editor!.evaluate<{ pressed: string | null; shown: boolean }>(`({
      pressed: document.querySelector('${GRIDLINES}')?.getAttribute('aria-pressed') ?? null,
      shown: document.querySelector('.canvas-host')?.classList.contains('show-gridlines') ?? false,
    })`);
    expect(await state()).toEqual({ pressed: 'false', shown: false });

    await editor!.click(GRIDLINES, 'Gridlines');
    expect(await state()).toEqual({ pressed: 'true', shown: true });
    // Read it un-hovered, as the Bold button was.
    await editor!.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
    expect(await look(GRIDLINES)).toEqual(pressedBold);

    await editor!.click(GRIDLINES, 'Gridlines');
    expect(await state()).toEqual({ pressed: 'false', shown: false });

    await wait(1_500); // longer than the 800 ms autosave delay
    expect((await deckOnDisk()).raw).toBe(diskBefore);
    expect(await sessionDeck()).toBe(sessionBefore);
  });

  it('advances on Space and Enter after a footer click, without re-pressing the button', { timeout: 90_000 }, async () => {
    await editor!.key('Escape', 27); // leave the box selection from the gridlines case
    await onSlide2(true);
    await editor!.click('#toolbar .toolbar-split-menu[aria-label="Presentation options"]', 'Presentation options');
    await editor!.clickByText('.shape-menu-item', 'Present in Speaker View');
    const [speakerTarget, audienceTarget] = await Promise.all([
      findTarget(debugPort, (t) => t.url.includes('/presenter/index.html'), appLog),
      findTarget(debugPort, (t) => t.url.includes('/present/index.html'), appLog),
    ]);
    speaker = await Cdp.connect(speakerTarget.webSocketDebuggerUrl!);
    audience = await Cdp.connect(audienceTarget.webSocketDebuggerUrl!);
    await speaker.call('Page.bringToFront');
    await speaker.evaluate('window.focus()');

    // Speaker View's preview numbers the slide as the audience sees it.
    expect(await eventually(presenting, 'Speaker View did not open on slide 2',
      (p) => p.position.startsWith('Slide 2 /') && p.speakerNumber !== null && p.audienceNumber !== null))
      .toMatchObject({ speakerNumber: '1', audienceNumber: '1' });

    const laser = () => speaker!.evaluate<string | null>(
      `document.querySelector('.speaker-laser')?.getAttribute('aria-pressed') ?? null`);
    const blanked = () => audience!.evaluate<boolean>(`document.querySelector('.stage')?.style.opacity === '0'`);
    const focusedOn = (selector: string) => speaker!.evaluate<boolean>(
      `document.activeElement === document.querySelector(${JSON.stringify(selector)})`);
    const advancedTo = async (slide: number) => {
      await eventually(presenting, `the key did not advance to slide ${slide}`,
        (p) => p.position.startsWith(`Slide ${slide} /`));
      // A toggle the same key fired would trail the advance by one round trip.
      await wait(500);
    };

    // Laser pointer: clicked, so it holds focus when the keys arrive.
    await speaker.click('.speaker-laser', 'Laser pointer');
    await eventually(laser, 'the laser did not switch on', (pressed) => pressed === 'true');
    expect(await focusedOn('.speaker-laser'), 'the clicked laser button holds focus').toBe(true);

    await speaker.typeKeys(' ');
    await advancedTo(3);
    expect(await laser(), 'Space re-pressed the focused laser button').toBe('true');
    expect(await presenting()).toMatchObject({ speakerNumber: '2', audienceNumber: '2' });

    await speaker.key('Enter', 13);
    await advancedTo(4);
    expect(await laser(), 'Enter re-pressed the focused laser button').toBe('true');

    // Blank: clicked, then the same two keys.
    await speaker.click('.speaker-blank', 'Blank');
    await eventually(blanked, 'Blank did not blank the audience');
    expect(await focusedOn('.speaker-blank'), 'the clicked Blank button holds focus').toBe(true);

    await speaker.typeKeys(' ');
    await advancedTo(5);
    expect(await blanked(), 'Space re-pressed the focused Blank button').toBe(true);

    await speaker.key('Enter', 13);
    await advancedTo(6);
    expect(await blanked(), 'Enter re-pressed the focused Blank button').toBe(true);
    expect(await laser()).toBe('true');

    // Soundness control: the same Space does press a focused button when the
    // speaker key map never sees it, so the checks above can fail.
    await speaker.click('.speaker-laser', 'Laser pointer');
    await eventually(laser, 'the laser did not switch off', (pressed) => pressed === 'false');
    await speaker.evaluate(`window.__stopKeys = (event) => event.stopPropagation();
      window.addEventListener('keydown', window.__stopKeys, true)`);
    await speaker.typeKeys(' ');
    await eventually(laser, 'the harness Space cannot press a focused button', (pressed) => pressed === 'true');
    await speaker.evaluate(`window.removeEventListener('keydown', window.__stopKeys, true)`);
  });
});
