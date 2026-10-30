import type { Deck, ThemeStyle } from '@shared/deck.js';
import { measureTextOverflows } from '@shared/htmlMeasure.js';
import type { FixedLayout } from '@shared/layoutMasters.js';
import {
  THEMES,
  baseThemeId,
  deckTheme,
  deckThemes,
  followThemeOnText,
  presetFromStyle,
  previousThemeUsed,
  restyleDeck,
  themeById,
  themeMode,
  themeStyleCss,
  themeStyleLabel,
  themeStyleOf,
  withThemeBlock,
  type ThemeChangeReport,
  type ThemeMode,
  type ThemePreset,
} from '@shared/themes.js';
import { fitAutoText, renderSlide } from '../player/render.js';
import { colorField } from './colorPicker.js';
import type { CssEditor } from './cssEditor.js';
import { fontFamilyField } from './fontPicker.js';
import { numberField } from './inspector.js';
import { lineSpacingValue } from '@shared/lineHeight.js';
import { FIXED_LAYOUTS, LAYOUT_LABELS_BY_ID, masterTile } from './layoutPreview.js';
import { barButton } from './shellWiring.js';
import type { EditorStore } from './store.js';
import {
  createThemeGallery,
  createThemePreviewCard,
  type ThemeGallery,
} from './themeGallery.js';

/**
 * Whether one of the stack's characterful leading families is installed.
 *
 * Only the first three families count: every stack ends in faces almost any
 * machine has plus a generic keyword, so checking the whole stack would call
 * everything available — while the point of filtering is to hide a theme
 * whose actual voice (Didot, Futura, Optima…) this machine cannot render.
 */
function stackAvailable(stack: string): boolean {
  if (typeof document === 'undefined' || !document.fonts?.check) return true;
  const leading = stack.split(',').slice(0, 3)
    .map((family) => family.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  for (const family of leading) {
    if (/^(system-ui|ui-monospace|ui-serif|ui-sans-serif|sans-serif|serif|monospace)$/i
      .test(family)) return true;
    try {
      if (document.fonts.check(`16px "${family}"`)) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** The preset the deck is wearing: what was chosen, else what is installed. */
function chosenPresetId(deck: Deck): string | null {
  return deck.themeSelection?.preset ?? deck.themePreset;
}

/**
 * Themes whose display and body voices this machine can actually show.
 *
 * The deck's own presets are offered alongside the built-ins and filtered by
 * the same test: a deck theme naming a typeface this laptop lacks is as
 * unusable here as a shipped one.
 */
function availableThemes(deck: Deck, currentPresetId: string | null): ThemePreset[] {
  const pool = deckThemes(deck);
  const currentBase = baseThemeId(currentPresetId, pool);
  return pool.filter((theme) =>
    theme.id === currentBase
    || (stackAvailable(theme.fonts.title.family) && stackAvailable(theme.fonts.body.family)));
}

/**
 * The Design sidebar tab: theme presets and the fixed layouts. Extracted from
 * the Electron shell so the browser collab shell shows the identical panel.
 *
 * Choosing a theme, its Light/Dark switch and Done in the theme editor each
 * restyle the whole deck as one undo step (`restyleDeck`), keeping what was
 * set on purpose, and the panel then says what kept its own look or no longer
 * fits, with a way to find it.
 */

export interface ThemePanelDeps {
  store: EditorStore;
  cssEditor: CssEditor;
  save: () => Promise<void> | void;
  setStatusMessage: (text: string) => void;
  /** Persist theme.css; the shells route this to disk or the collab server. */
  saveThemeCss: (css: string) => void;
  /**
   * Drive the read-only central Theme × Layout preview. `null` ends the
   * session and returns the canvas to the deck itself.
   */
  onThemePreview?: (theme: ThemePreset | null) => void;
  /** Enter the explicit editor for the fixed layout masters. */
  onEditLayouts?: (layout: FixedLayout) => void;
  /** Lay a theme draft's stylesheet over the editor; `null` removes it. */
  onPreviewThemeDraft?: (theme: ThemePreset | null) => void;
}

export interface ThemePanel {
  element: HTMLElement;
  currentTheme(): ThemePreset | null;
  refreshSwatches(): void;
  /** Reflect a freshly opened deck's installed preset in the gallery. */
  noteDeckOpened(deck: Deck): void;
  /** Close the theme chooser/editor and end its central preview session. */
  dismiss(): boolean;
}

/** Things on slides the last theme change left alone or pushed out of their box. */
interface ThemeChangeFindings extends ThemeChangeReport {
  /** The theme every slide now uses. */
  themeName: string;
  /** Text that no longer fits its box; `null` until measured. */
  overflowing: Array<{ slideId: string; elementId: string }> | null;
}

export function createThemePanel(deps: ThemePanelDeps): ThemePanel {
  const { store, cssEditor, save, setStatusMessage } = deps;

  /** The gallery selection; follows the deck's theme once a card is chosen. */
  let selectedThemeId: string | null = null;
  let themeGallery: ThemeGallery | null = null;
  let reportHost: HTMLElement | null = null;
  let findings: ThemeChangeFindings | null = null;
  let mastersHost: HTMLElement | null = null;
  let mastersKey = '';
  let modeButtons = new Map<ThemeMode, HTMLButtonElement>();
  let activeThemeHost: HTMLElement | null = null;
  let chooser: HTMLElement | null = null;
  let themeEditor: HTMLElement | null = null;
  let themePreviewOpen = false;
  /** A theme edit in progress; nothing lands on the deck until Done. */
  let draft: { style: ThemeStyle; base: ThemePreset } | null = null;

  function currentTheme(): ThemePreset | null {
    const deck = store.get().deck;
    if (draft) return presetFromStyle(draft.style, draft.base);
    const preset = themeById(selectedThemeId, deckThemes(deck));
    if (!preset) return deckTheme(deck);
    if (preset.id === deck.themePreset && deck.themeStyle) {
      return presetFromStyle(deck.themeStyle, preset);
    }
    return preset;
  }

  function renderActiveTheme(): void {
    if (!activeThemeHost) return;
    const theme = currentTheme();
    activeThemeHost.replaceChildren();
    if (!theme) return;
    const card = createThemePreviewCard(theme, () => {
      if (draft) return;
      if (chooser && !chooser.hidden) {
        endPreview();
        return;
      }
      themePreviewOpen = true;
      deps.onThemePreview?.(theme);
      if (chooser) chooser.hidden = false;
      refreshPreviousBadge();
      renderActiveTheme();
    });
    const installed = selectedThemeId === store.get().deck.themePreset;
    card.badge.hidden = !installed && !draft;
    card.badge.textContent = draft ? 'Draft' : installed ? 'Current' : 'Preview';
    card.element.classList.add('selected', 'theme-active-card');
    card.element.setAttribute('aria-expanded', String(chooser ? !chooser.hidden : false));
    activeThemeHost.appendChild(card.element);
    for (const [mode, button] of modeButtons) {
      const on = themeMode(theme) === mode;
      button.classList.toggle('selected', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  /**
   * Leave the chooser and its preview: the central Theme × Layout preview is
   * scaffolding for choosing, and closing the picker means "show me the deck".
   */
  function endPreview(): void {
    if (chooser) chooser.hidden = true;
    if (themePreviewOpen) deps.onThemePreview?.(null);
    themePreviewOpen = false;
    renderActiveTheme();
  }

  /** Point the gallery at the theme the deck wore before this one. */
  function refreshPreviousBadge(): void {
    const deck = store.get().deck;
    themeGallery?.setPrevious(previousThemeUsed(deck, chosenPresetId(deck)));
  }

  function notifyThemePreview(): void {
    const theme = currentTheme();
    renderActiveTheme();
    refreshSwatches();
    renderMasters(true);
    if (themePreviewOpen) deps.onThemePreview?.(theme);
  }

  function refreshThemeCss(): void {
    const deck = store.get().deck;
    if (!deck.themeStyle) return;
    const css = withThemeBlock(cssEditor.getValue(), themeStyleCss(deck.themeStyle, themeStyleLabel(deck)));
    if (css === cssEditor.getValue()) return;
    cssEditor.setValue(css);
    deps.saveThemeCss(css);
  }

  /** The swatch row shown in every colour picker, fed by the installed theme. */
  function refreshSwatches(): void {
    const theme = currentTheme();
    let list = document.getElementById('theme-swatches') as HTMLDataListElement | null;
    if (!list) {
      list = document.createElement('datalist');
      list.id = 'theme-swatches';
      document.body.appendChild(list);
    }
    list.replaceChildren(
      ...(theme?.palette ?? []).map((c) => {
        const o = document.createElement('option');
        o.value = c;
        return o;
      }),
    );
  }

  /* --- restyling the deck, and what it left alone --- */

  /**
   * Put `theme` on every slide as one undo step, then report what kept its
   * own look. Choosing a card, the Light/Dark switch and Done in the theme
   * editor all come through here.
   */
  function restyle(theme: ThemePreset, label: string): void {
    // The stylesheet the slides really load says what the old defaults were.
    const currentCss = cssEditor.getValue();
    const result: { report?: ThemeChangeReport } = {};
    store.commit((deck) => { result.report = restyleDeck(deck, theme, currentCss); }, { label });
    refreshThemeCss();
    themeGallery?.setInstalled(store.get().deck.themePreset);
    void save();
    if (!result.report) return;
    findings = { ...result.report, themeName: theme.name, overflowing: null };
    cursors.clear();
    renderReport();
    void measureOverflow(findings);
    setStatusMessage(`Every slide now uses “${theme.name}”.`);
  }

  /** Where each report line's Show button got to, so the next press moves on. */
  const cursors = new Map<string, number>();

  function renderReport(): void {
    if (!reportHost) return;
    reportHost.replaceChildren();
    reportHost.hidden = !findings;
    if (!findings) return;
    const { themeName, kept, ownBackgrounds, overflowing } = findings;
    const boxes = (n: number) => `${n} text box${n === 1 ? '' : 'es'}`;
    const their = (n: number) => (n === 1 ? 'its' : 'their');
    reportHost.appendChild(hintLine(`Every slide now uses “${themeName}”.`));
    if (kept.length > 0) {
      reportLine(`${boxes(kept.length)} kept ${their(kept.length)} own formatting.`, [
        barButton('Show', () => showNext('kept', kept)),
        barButton('Reset them too', resetKept),
      ]);
    }
    if (ownBackgrounds.length > 0) {
      const n = ownBackgrounds.length;
      reportLine(`${n} slide${n === 1 ? '' : 's'} kept ${their(n)} own background.`, [
        barButton('Show', () => showNext('backgrounds', ownBackgrounds.map((slideId) => ({ slideId })))),
      ]);
    }
    if (overflowing && overflowing.length > 0) {
      const n = overflowing.length;
      reportLine(`${boxes(n)} no longer fit${n === 1 ? 's' : ''}.`, [
        barButton('Show', () => showNext('overflowing', overflowing)),
      ]);
    }
  }

  function reportLine(text: string, buttons: HTMLButtonElement[]): void {
    const actions = document.createElement('div');
    actions.className = 'theme-editor-actions';
    actions.append(...buttons);
    reportHost?.append(hintLine(text), actions);
  }

  /** Go to the next slide holding any of `items`, and select them there. */
  function showNext(key: string, items: Array<{ slideId: string; elementId?: string }>): void {
    const bySlide = new Map<string, string[]>();
    for (const item of items) {
      const ids = bySlide.get(item.slideId) ?? [];
      if (item.elementId) ids.push(item.elementId);
      bySlide.set(item.slideId, ids);
    }
    const stops = store.get().deck.slides
      .map((slide, index) => ({ slide, index }))
      .filter(({ slide }) => bySlide.has(slide.id));
    if (stops.length === 0) return;
    const at = (cursors.get(key) ?? 0) % stops.length;
    cursors.set(key, at + 1);
    const { slide, index } = stops[at];
    endPreview();
    store.selectSlide(index);
    const present = new Set(slide.elements.map((element) => element.id));
    const ids = bySlide.get(slide.id)!.filter((id) => present.has(id));
    if (ids.length > 0) store.select(ids);
  }

  /** Put the boxes that kept their own formatting on the theme too. */
  function resetKept(): void {
    if (!findings) return;
    const previous = findings;
    const ids = new Set(previous.kept.map((item) => item.elementId));
    store.commit((deck) => {
      for (const element of deck.slides.flatMap((slide) => slide.elements)) {
        if (element.type !== 'text' || !ids.has(element.id)) continue;
        followThemeOnText(element);
      }
    }, { label: 'Reset to theme' });
    void save();
    findings = { ...previous, kept: [], overflowing: null };
    cursors.delete('kept');
    renderReport();
    void measureOverflow(findings);
  }

  /**
   * Find text the change pushed out of its box: every slide's text laid out
   * off screen under the stylesheet the canvas uses, and measured as an
   * agent's apply measures it (`measureTextOverflows`).
   */
  async function measureOverflow(of: ThemeChangeFindings): Promise<void> {
    await document.fonts?.ready;
    if (findings !== of) return;
    const { canvas, slides } = store.get().deck;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position: fixed; left: -100000px; top: 0; width: ${canvas.w}px; `
      + `height: ${canvas.h}px; visibility: hidden; pointer-events: none;`;
    const roots = slides.map((slide) => {
      // Overflow is about text alone; leaving media out keeps the probe from loading any.
      const root = renderSlide(
        { ...slide, elements: slide.elements.filter((element) => element.type === 'text') },
        { resolveSrc: (src) => src },
      );
      root.style.position = 'absolute';
      root.style.inset = '0';
      root.style.width = `${canvas.w}px`;
      root.style.height = `${canvas.h}px`;
      host.appendChild(root);
      return root;
    });
    document.body.appendChild(host);
    try {
      fitAutoText(host);
      of.overflowing = measureTextOverflows(document, roots)
        .flatMap(({ slideId, elementId }) => (slideId && elementId ? [{ slideId, elementId }] : []));
    } finally {
      host.remove();
    }
    if (findings === of) renderReport();
  }

  /* --- layouts strip --- */

  function renderMasters(force = false): void {
    if (!mastersHost) return;
    const deck = store.get().deck;
    const theme = currentTheme();
    const key = JSON.stringify([deck.layoutMasters, theme?.id, theme?.colors, theme?.fonts]);
    if (!force && key === mastersKey) return;
    mastersKey = key;
    mastersHost.replaceChildren();
    for (const layout of FIXED_LAYOUTS) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'layout-popover-item design-master';
      item.setAttribute('aria-label', `Edit ${LAYOUT_LABELS_BY_ID[layout]} layout`);
      const { frame } = masterTile(layout, deck.layoutMasters, theme, { caption: false });
      const caption = document.createElement('em');
      caption.textContent = LAYOUT_LABELS_BY_ID[layout];
      item.append(frame, caption);
      item.addEventListener('click', () => deps.onEditLayouts?.(layout));
      mastersHost.appendChild(item);
    }
  }

  /**
   * The Props tab's section: a ruled block under an `insp-subtitle` heading.
   * Built here rather than imported so the two panels stay independent, but
   * the markup and classes are deliberately identical.
   */
  function panelSection(title: string, extraClass = ''): HTMLElement {
    const section = document.createElement('section');
    section.className = `insp-option-section ${extraClass}`.trim();
    const heading = document.createElement('h4');
    heading.className = 'insp-subtitle';
    heading.textContent = title;
    section.appendChild(heading);
    return section;
  }

  /** A label naming a cluster of controls inside a section — a field label. */
  function groupLabel(text: string): HTMLElement {
    const label = document.createElement('div');
    label.className = 'theme-option-title';
    label.textContent = text;
    return label;
  }

  function hintLine(text = '', extraClass = ''): HTMLElement {
    const line = document.createElement('p');
    line.className = `insp-hint design-readout ${extraClass}`.trim();
    line.textContent = text;
    return line;
  }

  /** The ids the gallery currently offers, to tell when a deck needs a new one. */
  let offeredThemeIds = '';

  /**
   * A gallery for this deck's menu of themes. The menu is per deck, not per
   * session (see `noteDeckOpened`).
   */
  function buildGallery(deck: Deck): ThemeGallery {
    const preset = chosenPresetId(deck);
    const themes = availableThemes(deck, preset);
    offeredThemeIds = themes.map((theme) => theme.id).join('\n');
    return createThemeGallery(themes, preset, (theme, source) => {
      selectedThemeId = theme.id;
      restyle(theme, `Use ${theme.name}`);
      // Picking a card is a decision and closes the picker; flipping the
      // Light/Dark switch is still browsing, so the gallery stays open.
      if (source === 'card') endPreview();
      else refreshPreviousBadge();
      notifyThemePreview();
    });
  }

  function build(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'theme-browser';

    themeGallery = buildGallery(store.get().deck);
    selectedThemeId = themeGallery.selectedId();

    const intro = document.createElement('div');
    intro.className = 'theme-browser-intro';
    const title = document.createElement('h2');
    title.className = 'insp-title';
    title.textContent = 'Design';
    intro.append(title);

    /* --- current theme --- */
    activeThemeHost = document.createElement('div');
    activeThemeHost.className = 'theme-active-host';

    chooser = document.createElement('section');
    chooser.className = 'theme-chooser';
    chooser.hidden = true;
    const chooserHeader = document.createElement('div');
    chooserHeader.className = 'theme-chooser-header';
    const chooserTitle = document.createElement('strong');
    chooserTitle.textContent = 'Choose a theme';
    const chooserClose = barButton('Close', () => endPreview());
    chooserHeader.append(chooserTitle, chooserClose);
    chooser.append(chooserHeader, themeGallery.element);

    const modeRow = document.createElement('div');
    modeRow.className = 'theme-default-row';
    const modeLabel = document.createElement('span');
    modeLabel.className = 'theme-default-label';
    modeLabel.textContent = 'Default';
    const modeToggle = document.createElement('div');
    modeToggle.className = 'theme-mode-toggle theme-default-mode';
    modeToggle.setAttribute('role', 'group');
    modeToggle.setAttribute('aria-label', 'Deck default appearance');
    modeButtons = new Map();
    for (const [value, label] of [['light', 'Light'], ['dark', 'Dark']] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-mode-option';
      button.textContent = label;
      button.addEventListener('click', () => {
        if (draft) return;
        themeGallery?.setMode(value);
      });
      modeButtons.set(value, button);
      modeToggle.appendChild(button);
    }
    const editTheme = barButton('Edit…', () => (draft ? cancelDraft() : openDraft()));
    editTheme.classList.add('theme-edit-button');
    modeRow.append(modeLabel, modeToggle, editTheme);

    themeEditor = document.createElement('section');
    themeEditor.className = 'theme-inline-editor';
    themeEditor.hidden = true;

    // What the last theme change left alone, with a way to find it.
    reportHost = document.createElement('div');
    reportHost.className = 'theme-change-report';
    reportHost.hidden = true;

    const themeSection = panelSection('Current theme', 'theme-current-section');
    themeSection.append(activeThemeHost, chooser, modeRow, reportHost, themeEditor);

    /* --- layouts --- */
    mastersHost = document.createElement('div');
    mastersHost.className = 'layout-popover-grid design-masters';
    const layoutsSection = panelSection('Layouts', 'layouts-section');
    layoutsSection.append(mastersHost);

    wrap.append(intro, themeSection, layoutsSection);
    refreshPreviousBadge();
    renderActiveTheme();
    renderMasters(true);
    return wrap;
  }

  /* --- staged theme editor --- */

  function openDraft(): void {
    if (!themeEditor) return;
    const deck = store.get().deck;
    const pool = deckThemes(deck);
    const base = themeById(selectedThemeId, pool) ?? themeById(deck.themePreset, pool) ?? THEMES[0];
    draft = {
      style: structuredClone(deck.themeStyle ?? themeStyleOf(base)),
      base,
    };
    endPreview();
    renderDraftEditor();
    themeEditor.hidden = false;
    previewDraft();
  }

  function previewDraft(): void {
    deps.onPreviewThemeDraft?.(draft ? presetFromStyle(draft.style, draft.base) : null);
    renderActiveTheme();
    renderMasters(true);
  }

  function cancelDraft(): void {
    draft = null;
    if (themeEditor) themeEditor.hidden = true;
    deps.onPreviewThemeDraft?.(null);
    notifyThemePreview();
  }

  function finishDraft(): void {
    if (!draft) return;
    const { style, base } = draft;
    const deck = store.get().deck;
    const changed = JSON.stringify(style) !== JSON.stringify(deck.themeStyle ?? themeStyleOf(base));
    draft = null;
    if (themeEditor) themeEditor.hidden = true;
    deps.onPreviewThemeDraft?.(null);
    if (changed) {
      selectedThemeId = base.id;
      restyle(presetFromStyle(style, base), `Edit theme ${base.name}`);
      themeGallery?.setSelected(base.id);
    }
    notifyThemePreview();
  }

  function renderDraftEditor(): void {
    if (!themeEditor || !draft) return;
    const { style, base } = draft;
    const mutate = (change: (style: ThemeStyle) => void): void => {
      if (!draft) return;
      change(draft.style);
      previewDraft();
    };
    themeEditor.replaceChildren();
    themeEditor.appendChild(groupLabel(`Editing ${base.name.replace(' · Modified', '')}`));
    themeEditor.appendChild(hintLine(
      'Done puts these edits on every slide, keeping what was set on a box by hand. The canvas previews the draft.',
    ));

    const ROLE_LABELS: Record<'title' | 'body' | 'caption', string> = {
      title: 'Title', body: 'Body', caption: 'Caption',
    };
    themeEditor.appendChild(groupLabel('Fonts'));
    for (const role of ['title', 'body', 'caption'] as const) {
      themeEditor.appendChild(fontFamilyField(
        `${ROLE_LABELS[role]} font`,
        style.fonts[role].family,
        (family) => {
          if (family) mutate((target) => { target.fonts[role].family = family; });
        },
      ));
    }
    themeEditor.appendChild(groupLabel('Text sizes'));
    for (const role of ['title', 'body', 'caption'] as const) {
      const sizeField = numberField(
        `${ROLE_LABELS[role]} size`,
        style.fonts[role].size,
        (value) => {
          const size = Math.round(Math.max(6, Math.min(400, value)) * 10) / 10;
          mutate((target) => { target.fonts[role].size = size; });
        },
      );
      sizeField.classList.add('theme-role-size');
      sizeField.querySelector('input')!.title = 'Value in px';
      themeEditor.appendChild(sizeField);
      const spacingField = numberField(
        `${ROLE_LABELS[role]} line spacing`,
        style.fonts[role].lineHeight,
        (value) => {
          if (value > 0) mutate((target) => { target.fonts[role].lineHeight = lineSpacingValue(value); });
        },
        { step: 0.05 },
      );
      spacingField.classList.add('theme-role-line-spacing');
      spacingField.querySelector('input')!.title = 'Multiple of the font size';
      themeEditor.appendChild(spacingField);
    }

    themeEditor.appendChild(groupLabel('Main colors'));
    for (const [key, label] of [
      ['background', 'Background'],
      ['text', 'Text'],
      ['muted', 'Secondary text'],
      ['accent', 'Accent'],
    ] as const) {
      themeEditor.appendChild(colorField(label, style.colors[key], (value) => {
        if (value) mutate((target) => { target.colors[key] = value; });
      }));
    }

    themeEditor.appendChild(groupLabel('Extra colors for shapes'));
    style.palette.forEach((color, index) => {
      themeEditor!.appendChild(colorField(`Color ${index + 1}`, color, (value) => {
        if (value) mutate((target) => { target.palette[index] = value; });
      }));
    });

    const resetRow = document.createElement('div');
    resetRow.className = 'theme-editor-actions';
    resetRow.append(barButton(`Reset to ${base.name.replace(' · Modified', '')}`, () => {
      if (!draft) return;
      draft.style = themeStyleOf(base);
      renderDraftEditor();
      previewDraft();
    }));
    const actions = document.createElement('div');
    actions.className = 'theme-editor-actions';
    actions.append(
      barButton('Cancel', cancelDraft),
      barButton('Done', finishDraft, 'primary'),
    );
    themeEditor.append(resetRow, actions);
  }

  const element = build();
  let previousDeck = store.get().deck;
  store.subscribe(() => {
    const deck = store.get().deck;
    if (deck !== previousDeck) {
      previousDeck = deck;
      findings = null;
      renderReport();
    }
    if (draft) {
      previewDraft();
      return;
    }
    renderMasters();
  });
  return {
    element,
    currentTheme,
    refreshSwatches,
    dismiss: () => {
      const wasOpen = themePreviewOpen
        || Boolean(chooser && !chooser.hidden)
        || Boolean(draft);
      if (draft) cancelDraft();
      endPreview();
      return wasOpen;
    },
    noteDeckOpened: (deck) => {
      if (draft) cancelDraft();
      // A deck with presets of its own (or a different current theme, which
      // can unhide a card) gets a gallery listing them.
      const offered = availableThemes(deck, chosenPresetId(deck)).map((theme) => theme.id).join('\n');
      if (themeGallery && offered !== offeredThemeIds) {
        const stale = themeGallery.element;
        themeGallery = buildGallery(deck);
        stale.replaceWith(themeGallery.element);
      }
      // The chosen theme decides which card is selected; only an installed one
      // wears the "Current" badge, and a deck can have the first without the second.
      themeGallery?.setSelected(chosenPresetId(deck));
      themeGallery?.setInstalled(deck.themePreset);
      themeGallery?.setPrevious(previousThemeUsed(deck, chosenPresetId(deck)));
      selectedThemeId = chosenPresetId(deck) ?? themeGallery?.selectedId() ?? null;
      refreshSwatches();
      renderActiveTheme();
      renderMasters(true);
      findings = null;
      renderReport();
    },
  };
}
