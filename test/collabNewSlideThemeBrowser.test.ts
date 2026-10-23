import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadTheme } from '../src/main/deckStore.js';
import { emptyDeck, parseDeck, type Deck } from '../src/shared/deck.js';
import { pinSlidesToTheme } from '../src/shared/clipboard.js';
import { THEMES, THEME_BLOCK_END, THEME_BLOCK_START, themeById, themeStyleOf } from '../src/shared/themes.js';
import { type Cdp, electronBinary, eventually } from './support/browserSession.js';
import { launchWebEditor, type WebEditorSession } from './support/webEditorSession.js';

/**
 * The web-client twin of `newSlideThemeDesktopBrowser.test.ts`.
 *
 * A theme picked in the Design tab reaches the slides already there, and a
 * slide inserted with Return in the slide picker wears it too — checked in the production browser client served
 * by the real collaboration server, driven the way a person drives it. Where
 * the desktop suite reads deck.json and theme.css off disk, this one reads
 * what the server holds (`/api/deck`, `/api/theme`): the theme choice travels
 * over the WebSocket and the server writes theme.css, and that copy is what
 * every peer, Present, and download sees.
 *
 * Nothing here calls `.click()`, `.focus()`, or `dispatchEvent` on a node:
 * every step is a real mouse or keyboard event over the laid-out page, and
 * the outcome is read from the canvas, the rail thumbnail, and the server.
 */

const NOIR = THEMES.find((theme) => theme.id === 'noir')!;
const CANVAS_SLIDE = '#canvas .slide-layer > .slide';
const DESIGN_TAB = '#side-tabs button[data-panel="themePanel"]';
const ACTIVE_CARD = '#themePanel .theme-active-host .theme-card';
const CHOOSER = '#themePanel .theme-chooser';
const NOIR_CARD = `${CHOOSER} .theme-card[data-theme-id="noir"]`;
const TYPE_PROPERTIES = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color'];
/** Three suites share the machine with this one; give the server and browser room. */
const SLOW = 40_000;

let session: WebEditorSession | null = null;

afterEach(async () => {
  await session?.close();
  session = null;
});

describe.skipIf(!electronBinary)('new slide from Return in the slide picker (web client)', () => {
  it('preserves formatting and source backgrounds, previews Done, and clears reports after undo', { timeout: 120_000 }, async () => {
    const swiss = themeById('swiss')!;
    const deck = parseDeck({
      ...emptyDeck('Theme regressions'),
      themePreset: swiss.id, themeStyle: themeStyleOf(swiss),
      slides: [
        { id: 'editable', elements: [
          { id: 'imported', type: 'text', x: 140, y: 150, w: 1640, h: 180,
            class: ['role-title'], style: { 'font-size': '80px' }, html: 'Imported title' },
          { id: 'manual', type: 'text', x: 140, y: 400, w: 1640, h: 180,
            class: ['role-body'], style: { 'font-style': 'italic', 'text-decoration': 'underline' },
            overrides: ['font-style', 'text-decoration'], html: 'A <span style="font-size: 60px">large</span> word' },
        ] },
        { id: 'source', elements: [
          { id: 'source-text', type: 'text', x: 140, y: 150, w: 1640, h: 180,
            class: ['role-body'], html: 'Kept source appearance' },
        ] },
      ],
    });
    pinSlidesToTheme([deck.slides[1]], themeStyleOf(swiss));
    session = await launchWebEditor([{ id: 'theme-regressions', deck, themeCss: await builtInThemeCss() }]);
    const { cdp, fetchDeck } = session;
    const previewSize = () => cdp.evaluate<string>(`getComputedStyle(document.querySelector(
      '#canvas .design-slide-preview [data-element-id="imported"] .text-content')).fontSize`);
    await cdp.click(DESIGN_TAB, 'Design tab');
    await cdp.click('#themePanel .theme-edit-button', 'Edit theme');
    await cdp.typeInto('#themePanel .theme-role-size input', '100', 'Title size');
    expect(await previewSize()).toBe('100px');
    expect((await fetchDeck()).themeStyle!.fonts.title.size).toBe(swiss.fonts.title.size);
    await cdp.clickByText('#themePanel .theme-inline-editor button', 'Cancel');
    expect((await computedType(cdp, 'imported')).size).toBe('80px');
    await cdp.click('#themePanel .theme-edit-button', 'Edit theme');
    await cdp.typeInto('#themePanel .theme-role-size input', '100', 'Title size');
    await cdp.clickByText('#themePanel .theme-inline-editor button', 'Done');
    await eventually(() => computedType(cdp, 'imported'), 'Done did not match the preview', (type) => type.size === '100px');

    await cdp.click(ACTIVE_CARD, 'current theme card');
    await cdp.clickByText(`${CHOOSER} .theme-mode-option`, 'Dark', 'Dark appearance');
    await cdp.click(NOIR_CARD, 'Noir theme card');
    const changed = await eventually(fetchDeck, 'Noir did not reach the server', (current) => current.themePreset === 'noir');
    expect(changed.slides[1].background.color).toBe(swiss.colors.background);
    expect(changed.slides[0].elements.find((el) => el.id === 'manual')).toMatchObject({
      style: { 'font-style': 'italic', 'text-decoration': 'underline' },
      html: expect.stringContaining('font-size: 60px'),
    });
    await cdp.clickByText('#themePanel .theme-change-report button', 'Reset them too');
    await eventually(fetchDeck, 'Reset left italic or underline behind', (current) => {
      const style = current.slides[0].elements.find((el) => el.id === 'manual')!.style;
      return style['font-style'] === undefined && style['text-decoration'] === undefined;
    });
    await cdp.chord('z', 'KeyZ', 90, process.platform === 'darwin' ? 4 : 2);
    await eventually(fetchDeck, 'Undo did not restore the custom formatting', (current) =>
      current.slides[0].elements.find((el) => el.id === 'manual')!.style['font-style'] === 'italic');
    expect(await cdp.evaluate<boolean>(`document.querySelector('#themePanel .theme-change-report').hidden`)).toBe(true);
  });

  it('wears the theme chosen in the Design tab, on the canvas and on the server', {
    retry: 2,
    timeout: 120_000,
  }, async () => {
    // Two plain slides on the stylesheet alone: no theme chosen yet. The
    // first carries an unstyled title so the test can prove choosing a theme
    // restyles the slides that already exist, not only new ones.
    const base = emptyDeck('New slide theme');
    const deck: Deck = parseDeck({
      ...base,
      slides: [
        {
          ...base.slides[0],
          id: 's1',
          name: 'First',
          elements: [{
            id: 'existing-title', type: 'text', x: 140, y: 150, w: 1640, h: 200, rot: 0, z: 1,
            opacity: 1, class: ['role-title'], style: {}, html: 'Existing title',
            align: 'left', valign: 'top',
          }],
        },
        { ...base.slides[0], id: 's2', name: 'Second' },
      ],
    });

    // The desktop deck has no theme.css and renders on the app's built-in
    // stylesheet; the server needs the file, so hand it that same stylesheet.
    // (Pinning assumes the deck rendered on those defaults: a theme.css that
    // says otherwise would legitimately move the existing title.)
    const stylesheet = await builtInThemeCss();

    session = await launchWebEditor([{ id: 'new-slide-theme', deck, themeCss: stylesheet }], {
      tmpPrefix: 'deckwerk-web-new-slide-theme-',
      readyWhen: `document.querySelector(${JSON.stringify(CANVAS_SLIDE)})
        && document.querySelector('#rail .rail-item[data-slide-id="s2"]')?.getBoundingClientRect().width > 0`,
    });
    const { cdp, fetchDeck, fetchTheme } = session;

    const groundBefore = await canvasBackground(cdp);
    expect(groundBefore).not.toBe(rgb(NOIR.colors.background));
    const existingTitleBefore = await computedType(cdp, 'existing-title');
    expect(existingTitleBefore.size).not.toBe(`${NOIR.fonts.title.size}px`);
    expect(existingTitleBefore.color).not.toBe(rgb(NOIR.colors.text));
    const themeBefore = await fetchTheme();
    expect(themeBefore).not.toContain(THEME_BLOCK_START);

    // 1. Choose a theme in the Design tab: open the tab, expand the current
    //    card into the chooser, flip to Dark so the Noir card shows Noir
    //    itself (not its light counterpart), and pick it.
    await cdp.click(DESIGN_TAB, 'Design tab');
    await eventually(
      () => cdp.evaluate<boolean>(`!document.getElementById('themePanel').hidden
        && document.querySelector(${JSON.stringify(ACTIVE_CARD)})?.getBoundingClientRect().width > 0`),
      'Design tab did not open',
    );
    await cdp.click(ACTIVE_CARD, 'current theme card');
    await eventually(
      () => cdp.evaluate<string>(`getComputedStyle(document.querySelector(${JSON.stringify(CHOOSER)})).display`),
      'theme chooser did not open',
      (display) => display !== 'none',
    );
    await cdp.clickByText(`${CHOOSER} .theme-mode-option`, 'Dark', 'Dark appearance');
    await eventually(
      () => cdp.evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(NOIR_CARD)}))`),
      'gallery did not offer the Noir card in Dark mode',
    );
    await cdp.click(NOIR_CARD, 'Noir theme card');
    // Picking a card closes the chooser and records the choice on the deck.
    await eventually(
      () => cdp.evaluate<boolean>(`document.querySelector(${JSON.stringify(CHOOSER)}).hidden`),
      'picking a theme card did not close the chooser',
    );
    await eventually(
      () => fetchDeck(),
      'chosen theme did not reach the server deck',
      (saved) => saved.themeSelection?.preset === 'noir',
      SLOW,
    );
    // Choosing installs Noir as the deck's defaults -- the server's theme.css
    // now carries its role rules -- and the slide already on screen wears it.
    await eventually(
      () => fetchTheme(),
      'choosing a theme did not write its block into the server theme.css',
      (css) => css.includes(THEME_BLOCK_START),
      SLOW,
    );
    await eventually(
      () => canvasBackground(cdp),
      'the existing slide did not take the chosen theme background',
      (color) => color === rgb(NOIR.colors.background),
      SLOW,
    );
    const existingTitleNoir = await computedType(cdp, 'existing-title');
    expect(existingTitleNoir.size).toBe(`${NOIR.fonts.title.size}px`);
    expect(existingTitleNoir.color).toBe(rgb(NOIR.fonts.title.color ?? NOIR.colors.text));

    // 2. Select the first slide in the picker with a real mouse press, then
    //    press Return. The keystroke must land on the rail, not on the canvas
    //    or the theme panel that was just in use.
    await cdp.click('#rail .rail-item[data-slide-id="s1"]', 'first slide in the picker');
    await eventually(
      () => cdp.evaluate<boolean>(`(() => {
        const row = document.querySelector('#rail .rail-item[data-slide-id="s1"]');
        return Boolean(row && row.classList.contains('active')
          && document.getElementById('rail').contains(document.activeElement));
      })()`),
      'clicking a slide did not select it and hand the rail focus',
    );
    await cdp.key('Enter', 13);

    // 3. One new slide, right after the first, and it wears Noir.
    const saved = await eventually(
      () => fetchDeck(),
      'Return did not insert a slide after the selected one',
      (candidate) => candidate.slides.length === 3
        && candidate.slides[0].id === 's1' && candidate.slides[2].id === 's2',
      SLOW,
    );
    const added = saved.slides[1];
    // The new slide sits on the cascade: no inline type on its boxes and no
    // ground of its own, because theme.css is Noir now.
    expect(added.background).toEqual({ color: null, image: null });
    const title = added.elements.find((el) => el.type === 'text' && el.class.includes('role-title'));
    expect(title, 'the standard layout gives the new slide a title').toBeTruthy();
    expect(TYPE_PROPERTIES.filter((property) => property in title!.style)).toEqual([]);
    const body = added.elements.find((el) => el.type === 'text' && el.class.includes('role-body'));
    expect(body, 'the standard layout gives the new slide a body').toBeTruthy();
    expect(TYPE_PROPERTIES.filter((property) => property in body!.style)).toEqual([]);
    expect(saved.themePreset).toBe('noir');
    expect(saved.themeStyle?.fonts.title.size).toBe(NOIR.fonts.title.size);
    // theme.css on the server carries the generated block with Noir's title size.
    const themeCss = await fetchTheme();
    const block = themeCss.slice(themeCss.indexOf(THEME_BLOCK_START), themeCss.indexOf(THEME_BLOCK_END));
    expect(block).toMatch(new RegExp(`\\.role-title \\{[^}]*font-size: ${NOIR.fonts.title.size}px;`));
    expect(block).toContain(`font-family: ${NOIR.fonts.title.family};`);
    // The second slide still holds nothing, and follows the theme too.
    expect(saved.slides[2].elements).toEqual([]);
    expect(saved.slides[2].background).toEqual({ color: null, image: null });

    // 4. What the author actually sees: the canvas shows the new slide on
    //    Noir's ground with Noir's title, and its rail thumbnail agrees.
    await eventually(
      () => cdp.evaluate<string>(
        `document.querySelector(${JSON.stringify(CANVAS_SLIDE)})?.dataset.slideId
          ?? document.querySelector('#rail .rail-item.active')?.dataset.slideId`,
      ),
      'the editor did not move to the new slide',
      (id) => id === added.id,
    );
    await eventually(
      () => canvasBackground(cdp),
      'canvas did not paint the new slide on the chosen theme background',
      (color) => color === rgb(NOIR.colors.background),
    );
    const titleOnCanvas = await computedType(cdp, title!.id);
    expect(titleOnCanvas.color).toBe(rgb(NOIR.fonts.title.color ?? NOIR.colors.text));
    expect(titleOnCanvas.size).toBe(`${NOIR.fonts.title.size}px`);
    expect(titleOnCanvas.weight).toBe(String(NOIR.fonts.title.weight));
    expect(normalizeFamily(titleOnCanvas.family)).toBe(normalizeFamily(NOIR.fonts.title.family));
    const bodyOnCanvas = await computedType(cdp, body!.id);
    expect(bodyOnCanvas.size).toBe(`${NOIR.fonts.body.size}px`);
    expect(normalizeFamily(bodyOnCanvas.family)).toBe(normalizeFamily(NOIR.fonts.body.family));

    await eventually(
      () => cdp.evaluate<string>(`(() => {
        // A slide on the cascade paints its ground through theme.css on the
        // rendered slide root; the thumbnail frame around it stays clear.
        const thumb = document.querySelector(
          ${JSON.stringify(`#rail .rail-item[data-slide-id="${added.id}"] .rail-thumb-inner .slide`)},
        );
        return thumb ? getComputedStyle(thumb).backgroundColor : '';
      })()`),
      'rail thumbnail of the new slide is not on the chosen theme background',
      (color) => color === rgb(NOIR.colors.background),
    );

    // 5. Back on the first slide, the existing title still wears Noir.
    await cdp.click('#rail .rail-item[data-slide-id="s1"]', 'first slide in the picker');
    await eventually(
      () => cdp.evaluate<string>(`document.querySelector(${JSON.stringify(CANVAS_SLIDE)})?.dataset.slideId`),
      'the editor did not return to the first slide',
      (id) => id === 's1',
    );
    expect(await canvasBackground(cdp)).toBe(rgb(NOIR.colors.background));
    expect(await computedType(cdp, 'existing-title')).toEqual(existingTitleNoir);
  });
});

describe.skipIf(electronBinary)('new slide from Return in the slide picker (web client, skipped)', () => {
  it('needs Electron', () => expect(electronBinary).toBe(''));
});

/** The stylesheet a deck without a theme.css renders on, as `loadTheme` reports it. */
async function builtInThemeCss(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckwerk-built-in-theme-'));
  try {
    return await loadTheme(dir, 'theme.css');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface ComputedType { family: string; size: string; weight: string; color: string }

/** What the text of one canvas box is actually painted in. */
async function computedType(cdp: Cdp, elementId: string): Promise<ComputedType> {
  return cdp.evaluate<ComputedType>(`(() => {
    const node = document.querySelector(
      ${JSON.stringify(`${CANVAS_SLIDE} [data-element-id="${elementId}"] .text-content`)},
    );
    if (!node) return { family: '', size: '', weight: '', color: '' };
    const cs = getComputedStyle(node);
    return { family: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, color: cs.color };
  })()`);
}

async function canvasBackground(cdp: Cdp): Promise<string> {
  return cdp.evaluate<string>(
    `getComputedStyle(document.querySelector(${JSON.stringify(CANVAS_SLIDE)})).backgroundColor`,
  );
}

/** `#rrggbb` as Chromium reports a computed colour. */
function rgb(hex: string): string {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Computed font-family drops quotes where it can; compare family lists loosely. */
function normalizeFamily(list: string): string {
  return list.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase()).join(',');
}
