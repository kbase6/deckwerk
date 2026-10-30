// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CssEditor } from '../src/renderer/editor/cssEditor.js';
import { createThemePanel } from '../src/renderer/editor/themePanel.js';
import { EditorStore } from '../src/renderer/editor/store.js';
import { emptyDeck, type TextEl } from '../src/shared/deck.js';
import { THEMES, fullThemeSelection, themeStyleOf } from '../src/shared/themes.js';

describe('theme panel', () => {
  beforeEach(() => document.body.replaceChildren());

  it('keeps the theme first, then layouts, with no Apply step between them', () => {
    const store = new EditorStore(emptyDeck('Theme panel'), '/tmp/theme-panel');
    const cssEditor = {
      getValue: () => '',
      setValue: vi.fn(),
    } as unknown as CssEditor;
    const onThemePreview = vi.fn();
    const onEditLayouts = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview,
      onEditLayouts,
    });
    document.body.appendChild(panel.element);

    expect([...panel.element.children].map((child) => child.className)).toEqual([
      'theme-browser-intro',
      'insp-option-section theme-current-section',
      'insp-option-section layouts-section',
    ]);
    expect([...panel.element.querySelectorAll('.insp-subtitle')].map((h) => h.textContent))
      .toEqual(['Current theme', 'Layouts']);
    expect(panel.element.querySelectorAll('.theme-active-host .theme-card')).toHaveLength(1);
    expect(panel.element.querySelector('.theme-chooser')?.hasAttribute('hidden')).toBe(true);
    expect(onThemePreview).not.toHaveBeenCalled();
    panel.element.querySelector<HTMLButtonElement>('.theme-active-host .theme-card')!.click();
    expect(onThemePreview).toHaveBeenCalledTimes(1);

    // The three masters, drawn in the theme; clicking one edits it.
    const masters = panel.element.querySelectorAll<HTMLButtonElement>('.layouts-section .design-master');
    expect(masters).toHaveLength(3);
    // The tiles are the way in: no separate "Edit layouts…" button beside them.
    expect(panel.element.querySelectorAll('.layouts-section button')).toHaveLength(3);
    masters[1].click();
    expect(onEditLayouts).toHaveBeenCalledWith('standard');

    // A theme reaches every slide by itself: nothing to tick, nothing to press.
    expect(panel.element.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    // Until a theme changes there is nothing to report.
    expect(panel.element.querySelector<HTMLElement>('.theme-change-report')!.hidden).toBe(true);
  });

  it('dismisses theme picking and the inline theme editor', () => {
    const store = new EditorStore(emptyDeck('Theme panel'), '/tmp/theme-panel');
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);

    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    expect(panel.element.querySelector<HTMLElement>('.theme-chooser')!.hidden).toBe(false);
    expect(panel.dismiss()).toBe(true);
    // Opening the theme editor closes the chooser: a draft is edited alone.
    panel.element.querySelector<HTMLButtonElement>('.theme-edit-button')!.click();
    expect(panel.element.querySelector<HTMLElement>('.theme-chooser')!.hidden).toBe(true);
    expect(panel.element.querySelector<HTMLElement>('.theme-inline-editor')!.hidden).toBe(false);

    expect(panel.dismiss()).toBe(true);
    expect(panel.element.querySelector<HTMLElement>('.theme-chooser')!.hidden).toBe(true);
    expect(panel.element.querySelector<HTMLElement>('.theme-inline-editor')!.hidden).toBe(true);
    expect(panel.dismiss()).toBe(false);
  });

  it('puts the chosen theme on every slide as one undo step, and says so', () => {
    const deck = emptyDeck('Theme panel');
    // A title on the stock stylesheet alone, and one an import pinned inline.
    deck.slides[0].elements.push({
      id: 'title-1', type: 'text', x: 0, y: 0, w: 800, h: 200, rot: 0, z: 1, opacity: 1,
      class: ['role-title'], style: {}, html: 'Existing title',
      align: 'left', valign: 'middle',
    }, {
      id: 'title-2', type: 'text', x: 0, y: 300, w: 800, h: 200, rot: 0, z: 2, opacity: 1,
      class: ['role-title'], style: { 'font-family': 'Papyrus', 'font-size': '40px' }, html: 'Imported title',
      align: 'left', valign: 'middle',
    });
    const store = new EditorStore(deck, '/tmp/theme-panel');
    const setStatusMessage = vi.fn();
    const save = vi.fn();
    const saveThemeCss = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save,
      setStatusMessage,
      saveThemeCss,
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);

    // Open the chooser, then pick a card other than the one already showing.
    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    const showing = panel.currentTheme()!.id;
    const target = THEMES.find((theme) => theme.id !== showing)!;
    const cards = [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-gallery .theme-card')];
    cards.find((element) => element.textContent?.includes(target.name))!.click();

    // The whole theme is the deck's, and theme.css carries it at once.
    expect(store.get().deck.themeSelection).toEqual(fullThemeSelection(target.id));
    expect(store.get().deck.themePreset).toBe(target.id);
    expect(store.get().deck.themeStyle).toEqual(themeStyleOf(target));
    const css = saveThemeCss.mock.calls.at(-1)?.[0] as string;
    expect(css).toContain([
      '.role-title {',
      `  font-family: ${target.fonts.title.family};`,
      `  font-size: ${target.fonts.title.size}px;`,
    ].join('\n'));
    expect(css).toContain(`.slide {\n  background: ${target.colors.background};\n  color: ${target.colors.text};`);

    // Both titles follow it: nothing pinned, the imported type gone.
    const elements = store.get().deck.slides[0].elements;
    expect(elements.map((element) => element.style)).toEqual([{}, {}]);
    expect(store.get().deck.slides[0].background).toEqual({ color: null, image: null });
    expect(save).toHaveBeenCalled();
    expect(setStatusMessage.mock.calls.at(-1)?.[0]).toContain(target.name);
    const report = panel.element.querySelector<HTMLElement>('.theme-change-report')!;
    expect(report.hidden).toBe(false);
    expect(report.textContent).toContain(`Every slide now uses “${target.name}”.`);

    // One undo step brings the import's own type back.
    store.undo();
    expect(store.get().deck.slides[0].elements[1].style).toEqual({ 'font-family': 'Papyrus', 'font-size': '40px' });
    expect(report.hidden).toBe(true);
    expect(report.textContent).toBe('');
  });

  it('reports what kept its own look, finds it, and resets it on request', () => {
    const deck = emptyDeck('Theme panel');
    const box = (id: string, z: number, patch: Partial<TextEl> = {}): TextEl => ({
      id, type: 'text', x: 0, y: z * 100, w: 800, h: 80, rot: 0, z, opacity: 1,
      class: ['role-body'], style: {}, html: id, align: 'left', valign: 'top', ...patch,
    });
    deck.slides = ['slide-1', 'slide-2', 'slide-3'].map((id) => ({ ...structuredClone(deck.slides[0]), id }));
    const ownType = { color: '#cc0000', 'font-style': 'italic', 'text-decoration': 'underline' };
    deck.slides[1].elements.push(box('red', 1, { style: ownType, overrides: Object.keys(ownType) }));
    deck.slides[2].elements.push(box('plain', 1));
    deck.slides[2].background = { color: '#123456', image: null };
    const store = new EditorStore(deck, '/tmp/theme-panel');
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);
    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    panel.element.querySelector<HTMLButtonElement>('.theme-gallery .theme-card[data-theme-id="swiss"]')!.click();

    const report = panel.element.querySelector<HTMLElement>('.theme-change-report')!;
    expect(report.textContent).toContain('1 text box kept its own formatting.');
    expect(report.textContent).toContain('1 slide kept its own background.');
    const button = (line: string, label: string) => {
      const hint = [...report.querySelectorAll('.insp-hint')].find((node) => node.textContent?.startsWith(line))!;
      return [...hint.nextElementSibling!.querySelectorAll<HTMLButtonElement>('button')]
        .find((node) => node.textContent === label)!;
    };

    // Show goes to the slide and selects what kept its own look.
    button('1 text box', 'Show').click();
    expect(store.get().slideIndex).toBe(1);
    expect([...store.get().selection]).toEqual(['red']);
    button('1 slide', 'Show').click();
    expect(store.get().slideIndex).toBe(2);

    // Reset them too: the red box follows the theme as well, as one undo step.
    button('1 text box', 'Reset them too').click();
    const red = store.get().deck.slides[1].elements[0] as TextEl;
    expect(red.style).toEqual({});
    expect(red.overrides).toBeUndefined();
    expect(report.textContent).not.toContain('kept its own formatting');
    store.undo();
    expect((store.get().deck.slides[1].elements[0] as TextEl).style).toEqual(ownType);
    expect(report.hidden).toBe(true);
  });

  it('follows the Light/Dark switch with the selection and the preview', () => {
    const store = new EditorStore(emptyDeck('Theme panel'), '/tmp/theme-panel');
    const onThemePreview = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview,
    });
    document.body.appendChild(panel.element);

    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    const light = panel.currentTheme()!;
    [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-mode-option')]
      .find((button) => button.textContent === 'Dark')!.click();

    // The dark half of the theme that was showing, not a different theme.
    expect(panel.currentTheme()!.id).toBe(`${light.id}-dark`);
    expect(store.get().deck.themeSelection?.preset).toBe(`${light.id}-dark`);
    expect((onThemePreview.mock.calls.at(-1)?.[0] as { id: string }).id).toBe(`${light.id}-dark`);
    // Flipping the switch is still browsing: the chooser stays open.
    expect(panel.element.querySelector<HTMLElement>('.theme-chooser')!.hidden).toBe(false);
  });

  it('offers one Slide colors switch that says it restyles every slide', () => {
    const store = new EditorStore(emptyDeck('Theme panel'), '/tmp/theme-panel');
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
    });
    document.body.appendChild(panel.element);
    const themeName = panel.currentTheme()!.name;

    // With the chooser open there is still one switch, not a second copy above it.
    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    const toggles = panel.element.querySelectorAll<HTMLElement>('.theme-mode-toggle');
    expect(toggles).toHaveLength(1);
    const [toggle] = toggles;
    // Named for what it changes: the slides, not the editor window.
    expect(toggle.getAttribute('aria-label')).toBe('Slide colors');
    expect(toggle.closest('.theme-default-row')!.querySelector('.theme-default-label')!.textContent)
      .toBe('Slide colors');
    expect(toggle.title).toContain(`Switches every slide to the light or dark version of ${themeName}.`);
    expect(toggle.title).toContain('Editor appearance');

    // The dark half is still the same theme by name.
    [...toggle.querySelectorAll<HTMLButtonElement>('.theme-mode-option')]
      .find((button) => button.textContent === 'Dark')!.click();
    expect(store.get().deck.themeSelection?.preset).toMatch(/-dark$/);
    expect(toggle.title).toContain(`light or dark version of ${themeName}.`);
  });

  it('ends the central preview whenever the chooser closes', () => {
    const store = new EditorStore(emptyDeck('Theme panel'), '/tmp/theme-panel');
    const onThemePreview = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview,
    });
    document.body.appendChild(panel.element);
    const chooser = panel.element.querySelector<HTMLElement>('.theme-chooser')!;
    const openChooser = () =>
      panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();

    // The chooser's own Close button.
    openChooser();
    expect(chooser.hidden).toBe(false);
    [...chooser.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Close')!.click();
    expect(chooser.hidden).toBe(true);
    expect(onThemePreview.mock.calls.at(-1)?.[0]).toBeNull();

    // Picking a card is a decision: the picker closes and the deck comes back.
    openChooser();
    [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-gallery .theme-card')]
      .find((card) => card.dataset.themeId !== panel.currentTheme()!.id)!.click();
    expect(chooser.hidden).toBe(true);
    expect(onThemePreview.mock.calls.at(-1)?.[0]).toBeNull();

    // And re-opening the active card while the chooser is up closes it too.
    openChooser();
    openChooser();
    expect(chooser.hidden).toBe(true);
    expect(onThemePreview.mock.calls.at(-1)?.[0]).toBeNull();

    openChooser();
    expect(panel.dismiss()).toBe(true);
    expect(onThemePreview.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('marks the theme the deck wore before the current one', () => {
    const deck = emptyDeck('Theme panel');
    deck.slides[0].elements.push({
      id: 'title-1', type: 'text', x: 0, y: 0, w: 800, h: 200, rot: 0, z: 1, opacity: 1,
      class: ['role-title'], style: {}, html: 'A title', align: 'left', valign: 'middle',
    });
    const store = new EditorStore(deck, '/tmp/theme-panel');
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);
    const openChooser = () =>
      panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    const cardFor = (name: string) =>
      [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-gallery .theme-card')]
        .find((element) => element.textContent?.includes(name))!;
    const markedPrevious = () => [...panel.element
      .querySelectorAll<HTMLElement>('.theme-gallery .theme-previous-badge')]
      .filter((badge) => !badge.hidden)
      .map((badge) => badge.closest<HTMLElement>('.theme-card')!.dataset.themeId);

    // Choosing a theme puts it on the slides: Swiss is now worn.
    openChooser();
    cardFor(THEMES.find((theme) => theme.id === 'swiss')!.name).click();
    openChooser();
    expect(markedPrevious()).toEqual([]);

    // Choosing Salon makes it the deck's look, and Swiss the one to go back to.
    const salon = THEMES.find((theme) => theme.id === 'salon')!;
    cardFor(salon.name).click();
    openChooser();
    expect(store.get().deck.themeHistory).toEqual(['salon', 'swiss']);
    expect(markedPrevious()).toEqual(['swiss']);
  });

  it('carries the theme\'s font weight into theme.css for the slides it restyles', () => {
    const deck = emptyDeck('Theme panel');
    deck.slides[0].elements.push({
      id: 'title-1', type: 'text', x: 0, y: 0, w: 800, h: 200, rot: 0, z: 1, opacity: 1,
      class: ['role-title'], style: { 'font-weight': '700' }, html: 'A heavy title',
      align: 'left', valign: 'middle',
    });
    // The store opens with the first slide selected, which is the apply scope.
    const store = new EditorStore(deck, '/tmp/theme-panel');
    const saveThemeCss = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss,
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);

    // Pick the condensed-medium theme: it reaches the slide at once.
    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    const colloquium = THEMES.find((theme) => theme.id === 'colloquium')!;
    [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-gallery .theme-card')]
      .find((element) => element.textContent?.includes(colloquium.name))!.click();

    // The family without its weight is what left condensed titles at 700. Now
    // both travel together: the title's own 700 is cleared so it follows the
    // deck's defaults, and those carry Colloquium's medium into theme.css.
    const title = store.get().deck.slides[0].elements.find((element) => element.id === 'title-1')!;
    expect(title.style['font-weight']).toBeUndefined();
    expect(title.style['font-family']).toBeUndefined();
    expect(store.get().deck.themeStyle?.fonts.title.family).toBe(colloquium.fonts.title.family);
    expect(store.get().deck.themeStyle?.fonts.title.weight).toBe(colloquium.fonts.title.weight);
    expect(saveThemeCss).toHaveBeenLastCalledWith(expect.stringContaining(
      `.role-title {\n  font-family: ${colloquium.fonts.title.family};\n  font-size: ${colloquium.fonts.title.size}px;\n  font-weight: ${colloquium.fonts.title.weight};`,
    ));
  });

  it('offers a theme the deck carries itself, and applies it like any built-in', () => {
    const deck = emptyDeck('Theme panel');
    // The shape `slide-agent theme create` writes, on a deck that has slides.
    deck.customThemes = [{
      id: 'lab-night',
      name: 'Lab Night',
      description: 'Slab titles on a deep ink ground.',
      fonts: structuredClone(THEMES[0].fonts),
      palette: ['#e9edf2', '#94a0ad', '#f0a83c'],
      colors: { background: '#12151a', text: '#e9edf2', muted: '#94a0ad', accent: '#f0a83c' },
    }];
    deck.slides[0].elements.push({
      id: 'title-1', type: 'text', x: 0, y: 0, w: 800, h: 200, rot: 0, z: 1, opacity: 1,
      class: ['role-title'], style: { 'font-family': 'Comic Sans MS' }, html: 'A title',
      align: 'left', valign: 'middle',
    });
    const store = new EditorStore(deck, '/tmp/theme-panel');
    const saveThemeCss = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss,
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);

    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    const card = [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-gallery .theme-card')]
      .find((element) => element.textContent?.includes('Lab Night'));
    expect(card).toBeDefined();
    card!.click();
    // The gallery opens on the light side of its switch, so a dark deck theme
    // is offered as its generated light counterpart — the same courtesy the
    // built-ins get.
    expect(panel.currentTheme()?.id).toBe('lab-night-light');

    // The title's own Comic Sans is cleared so it follows theme.css, which now
    // carries the deck theme's title face.
    const title = store.get().deck.slides[0].elements.find((element) => element.id === 'title-1')!;
    expect(title.style['font-family']).toBeUndefined();
    expect(store.get().deck.themeStyle?.fonts.title.family).toBe(deck.customThemes[0].fonts.title.family);
    expect(saveThemeCss).toHaveBeenLastCalledWith(expect.stringContaining(
      `.role-title {\n  font-family: ${deck.customThemes[0].fonts.title.family};`,
    ));
  });

  it('offers the presets of a deck opened after the panel was built', () => {
    // The shells build the panel once, against an empty placeholder deck, and
    // hand it the real deck later through noteDeckOpened. A deck theme must
    // still reach the gallery — this is the path every real session takes.
    const store = new EditorStore(emptyDeck('Placeholder'), '/tmp/theme-panel');
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onThemePreview: vi.fn(),
    });
    document.body.appendChild(panel.element);
    const cardIds = () => [...panel.element.querySelectorAll<HTMLElement>('.theme-gallery .theme-card')]
      .map((card) => card.dataset.themeId);
    expect(cardIds()).not.toContain('lab-night');

    const opened = emptyDeck('Opened later');
    opened.customThemes = [{
      id: 'lab-night', name: 'Lab Night', description: '',
      fonts: structuredClone(THEMES[0].fonts),
      palette: ['#e9edf2', '#94a0ad', '#f0a83c'],
      colors: { background: '#12151a', text: '#e9edf2', muted: '#94a0ad', accent: '#f0a83c' },
    }];
    opened.themeSelection = fullThemeSelection('lab-night');
    store.applyRemote(opened, 'open');
    panel.noteDeckOpened(opened);

    // The gallery now lists the deck theme, on the dark side its ground sits on,
    // and the chooser still holds exactly one gallery.
    expect(panel.element.querySelectorAll('.theme-gallery')).toHaveLength(1);
    expect(cardIds()).toContain('lab-night');
    expect(panel.currentTheme()?.id).toBe('lab-night');
    panel.element.querySelector<HTMLButtonElement>('.theme-active-card')!.click();
    expect(panel.element.querySelector('[data-theme-id="lab-night"]')!.classList.contains('selected')).toBe(true);

    // Opening a deck without presets of its own drops the card again.
    const plain = emptyDeck('Plain');
    store.applyRemote(plain, 'open');
    panel.noteDeckOpened(plain);
    expect(panel.element.querySelectorAll('.theme-gallery')).toHaveLength(1);
    expect(cardIds()).not.toContain('lab-night');
  });
});

describe('the theme editor’s wording', () => {
  it('names its groups and colors in plain words', () => {
    const deck = emptyDeck('Wording');
    deck.themePreset = THEMES[0].id;
    const store = new EditorStore(deck, '/tmp/theme-panel-wording');
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
    });
    document.body.appendChild(panel.element);
    panel.element.querySelector<HTMLButtonElement>('.theme-edit-button')!.click();

    const editor = panel.element.querySelector<HTMLElement>('.theme-inline-editor')!;
    expect([...editor.querySelectorAll('.theme-option-title')].map((node) => node.textContent).slice(1))
      .toEqual(['Fonts', 'Text sizes', 'Main colors', 'Extra colors for shapes']);
    expect([...editor.querySelectorAll('.font-family-field .field > span')].map((node) => node.textContent))
      .toEqual(['Title font', 'Body font', 'Caption font']);
    expect([...editor.querySelectorAll('.field-color > span')].slice(0, 4).map((node) => node.textContent))
      .toEqual(['Background', 'Text', 'Secondary text', 'Accent']);
    expect(editor.textContent).not.toMatch(/Typeface|Type scale|Semantic|Swatch|Muted/i);
  });
});

describe('the theme editor’s type scale', () => {
  it('edits one role’s size into theme.css on Done, and every slide follows it', () => {
    const deck = emptyDeck('Scale panel');
    deck.themePreset = THEMES[0].id;
    deck.themeStyle = structuredClone({
      fonts: THEMES[0].fonts, palette: THEMES[0].palette, colors: THEMES[0].colors,
    });
    deck.slides[0].elements.push({
      id: 'following', type: 'text', x: 0, y: 0, w: 100, h: 50, rot: 0, z: 1, opacity: 1,
      class: ['role-title'], style: {}, html: 'Following',
      align: 'left', valign: 'top', autoFit: false,
    });
    const store = new EditorStore(deck, '/tmp/theme-panel-scale');
    const saveThemeCss = vi.fn();
    const onPreviewThemeDraft = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss,
      onPreviewThemeDraft,
    });
    document.body.appendChild(panel.element);
    panel.element.querySelector<HTMLButtonElement>('.theme-edit-button')!.click();

    const sizes = [...panel.element.querySelectorAll<HTMLElement>('.theme-role-size')];
    expect(sizes.map((node) => node.querySelector('span')?.textContent)).toEqual([
      'Title size', 'Body size', 'Caption size',
    ]);
    const title = sizes[0].querySelector('input')!;
    const before = THEMES[0].fonts.title.size;
    expect(Number(title.value)).toBe(before);
    title.value = '100';
    title.dispatchEvent(new Event('change', { bubbles: true }));

    // The edit is a draft: previewed on the canvas, not yet on the deck.
    expect(store.get().deck.themeStyle?.fonts.title.size).toBe(before);
    expect((onPreviewThemeDraft.mock.calls.at(-1)?.[0] as { fonts: { title: { size: number } } }).fonts.title.size).toBe(100);
    expect(saveThemeCss).not.toHaveBeenCalled();

    [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-inline-editor button')]
      .find((node) => node.textContent === 'Done')!.click();
    expect(onPreviewThemeDraft).toHaveBeenLastCalledWith(null);
    expect(store.get().deck.themeStyle?.fonts.title.size).toBe(100);
    expect(saveThemeCss).toHaveBeenLastCalledWith(expect.stringMatching(/\.role-title \{[^}]*font-size: 100px/));
    // The existing title still follows the stylesheet, so it is 100px too.
    expect(store.get().deck.slides[0].elements.find((el) => el.id === 'following')?.style)
      .toEqual({});
    expect(panel.element.querySelector<HTMLElement>('.theme-inline-editor')!.hidden).toBe(true);
  });

  it('edits one role’s line spacing, beside its size, into theme.css on Done', () => {
    const deck = emptyDeck('Scale panel');
    deck.themePreset = THEMES[0].id;
    deck.themeStyle = structuredClone({
      fonts: THEMES[0].fonts, palette: THEMES[0].palette, colors: THEMES[0].colors,
    });
    const store = new EditorStore(deck, '/tmp/theme-panel-scale');
    const saveThemeCss = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss,
    });
    document.body.appendChild(panel.element);
    panel.element.querySelector<HTMLButtonElement>('.theme-edit-button')!.click();

    const spacings = [...panel.element.querySelectorAll<HTMLElement>('.theme-role-line-spacing')];
    expect(spacings.map((node) => node.querySelector('span')?.textContent)).toEqual([
      'Title line spacing', 'Body line spacing', 'Caption line spacing',
    ]);
    // Each sits right after its role's size.
    expect(spacings[0].previousElementSibling?.classList.contains('theme-role-size')).toBe(true);
    const body = spacings[1].querySelector('input')!;
    expect(Number(body.value)).toBe(THEMES[0].fonts.body.lineHeight);
    expect(body.step).toBe('0.05');
    body.value = '1.55';
    body.dispatchEvent(new Event('change', { bubbles: true }));
    [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-inline-editor button')]
      .find((node) => node.textContent === 'Done')!.click();
    expect(store.get().deck.themeStyle?.fonts.body.lineHeight).toBe(1.55);
    expect(saveThemeCss).toHaveBeenLastCalledWith(expect.stringMatching(/\.role-body \{[^}]*line-height: 1\.55/));
  });

  it('throws a draft away on Cancel', () => {
    const deck = emptyDeck('Scale panel');
    deck.themePreset = THEMES[0].id;
    deck.themeStyle = structuredClone({
      fonts: THEMES[0].fonts, palette: THEMES[0].palette, colors: THEMES[0].colors,
    });
    const store = new EditorStore(deck, '/tmp/theme-panel-scale');
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
    });
    document.body.appendChild(panel.element);
    const before = JSON.stringify(store.get().deck);
    panel.element.querySelector<HTMLButtonElement>('.theme-edit-button')!.click();
    const title = panel.element.querySelector<HTMLElement>('.theme-role-size')!.querySelector('input')!;
    title.value = '100';
    title.dispatchEvent(new Event('change', { bubbles: true }));
    [...panel.element.querySelectorAll<HTMLButtonElement>('.theme-inline-editor button')]
      .find((node) => node.textContent === 'Cancel')!.click();
    expect(JSON.stringify(store.get().deck)).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  it('never drops a changed draft without asking, and leaves no preview behind', async () => {
    const deck = emptyDeck('Scale panel');
    deck.themePreset = THEMES[0].id;
    deck.themeStyle = structuredClone({
      fonts: THEMES[0].fonts, palette: THEMES[0].palette, colors: THEMES[0].colors,
    });
    const store = new EditorStore(deck, '/tmp/theme-panel-scale');
    const onPreviewThemeDraft = vi.fn();
    const panel = createThemePanel({
      store,
      cssEditor: { getValue: () => '', setValue: vi.fn() } as unknown as CssEditor,
      save: vi.fn(),
      setStatusMessage: vi.fn(),
      saveThemeCss: vi.fn(),
      onPreviewThemeDraft,
    });
    document.body.appendChild(panel.element);
    const before = JSON.stringify(store.get().deck);
    const edit = panel.element.querySelector<HTMLButtonElement>('.theme-edit-button')!;
    const editor = panel.element.querySelector<HTMLElement>('.theme-inline-editor')!;
    const titleSize = () => panel.element.querySelector<HTMLElement>('.theme-role-size')!.querySelector('input')!;
    const dialog = () => document.querySelector<HTMLElement>('.confirm-dialog');
    const answer = async (label: string): Promise<void> => {
      await vi.waitFor(() => expect(dialog()).not.toBeNull());
      [...dialog()!.querySelectorAll('button')].find((button) => button.textContent === label)!.click();
      await vi.waitFor(() => expect(dialog()).toBeNull());
    };

    edit.click();
    titleSize().value = '100';
    titleSize().dispatchEvent(new Event('change', { bubbles: true }));

    // Escape or a slide click asks first; keeping the edit keeps all of it.
    expect(panel.dismiss()).toBe(true);
    await vi.waitFor(() => expect(dialog()?.querySelector('h2')?.textContent).toBe('Discard theme changes?'));
    expect(editor.hidden).toBe(false);
    // While it asks, Escape is the question's, not another dismissal.
    expect(panel.dismiss()).toBe(false);
    expect(document.querySelectorAll('.confirm-dialog')).toHaveLength(1);
    await answer('Keep editing');
    expect(editor.hidden).toBe(false);
    expect(titleSize().value).toBe('100');
    expect(onPreviewThemeDraft).not.toHaveBeenLastCalledWith(null);

    // Pressing the button again is no way out: it waits for Done or Cancel.
    expect(edit.textContent).toBe('Edit theme…');
    expect(edit.disabled).toBe(true);
    edit.click();
    expect(editor.hidden).toBe(false);
    expect(titleSize().value).toBe('100');

    // Another tab waits for the answer, and goes only once the edit is gone.
    const leave = vi.fn();
    expect(panel.confirmDiscardDraft(leave)).toBe(true);
    expect(leave).not.toHaveBeenCalled();
    await answer('Discard');
    expect(leave).toHaveBeenCalledTimes(1);
    expect(editor.hidden).toBe(true);
    expect(edit.disabled).toBe(false);
    expect(onPreviewThemeDraft).toHaveBeenLastCalledWith(null);
    expect(JSON.stringify(store.get().deck)).toBe(before);

    // An edit that changed nothing has nothing to lose: it ends at once.
    edit.click();
    const quiet = vi.fn();
    expect(panel.confirmDiscardDraft(quiet)).toBe(false);
    expect(quiet).not.toHaveBeenCalled();
    expect(editor.hidden).toBe(true);
    expect(onPreviewThemeDraft).toHaveBeenLastCalledWith(null);
    expect(dialog()).toBeNull();
  });

});
