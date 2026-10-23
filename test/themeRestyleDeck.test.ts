import { describe, expect, it } from 'vitest';
import { emptyDeck, type Deck, type SlideElement, type TextEl } from '../src/shared/deck.js';
import { pinSlidesToTheme } from '../src/shared/clipboard.js';
import {
  THEMES,
  fullThemeSelection,
  installThemeStyle,
  restyleDeck,
  themeById,
  themeStyleOf,
} from '../src/shared/themes.js';

/**
 * Choosing or editing a theme in the Design tab restyles the whole deck, and
 * keeps what was set on purpose: a box's recorded overrides, formatting on
 * part of its text, an untagged box's size, a slide's own background. What
 * only held a box still -- a pinned copy, an importer's inline type and
 * class, a run repeating its box -- goes.
 */

const SWISS = themeById('swiss')!;
const NOIR = themeById('noir')!;

function text(id: string, patch: Partial<TextEl> = {}): TextEl {
  return {
    id, type: 'text', x: 100, y: 100, w: 800, h: 200, rot: 0, z: 1, opacity: 1,
    class: ['role-body'], style: {}, html: `<p>${id}</p>`, align: 'left', valign: 'top',
    ...patch,
  };
}

function deckWith(...slides: SlideElement[][]): Deck {
  const deck = emptyDeck('Restyle');
  deck.themePreset = SWISS.id;
  deck.themeStyle = themeStyleOf(SWISS);
  deck.slides = slides.map((elements, index) => ({
    ...structuredClone(deck.slides[0]), id: `slide-${index + 1}`, elements,
  }));
  return deck;
}

const textOf = (deck: Deck, id: string): TextEl =>
  deck.slides.flatMap((slide) => slide.elements).find((element) => element.id === id) as TextEl;

describe('restyleDeck', () => {
  it('makes the theme the deck’s defaults and records it as worn', () => {
    const deck = deckWith([text('following')]);
    restyleDeck(deck, NOIR);
    expect(deck.themeStyle).toEqual(themeStyleOf(NOIR));
    expect(deck.themePreset).toBe(NOIR.id);
    expect(deck.themeSelection).toEqual(fullThemeSelection(NOIR.id));
    expect(deck.themeHistory?.[0]).toBe(NOIR.id);
    expect(textOf(deck, 'following').style).toEqual({});
  });

  it('drops pinned copies and an importer’s type, so the box follows the theme', () => {
    const deck = deckWith([text('pinned', {
      class: ['role-title', 'pp-text'],
      style: { 'font-family': 'Papyrus', 'font-size': '88px', 'font-weight': '400', color: '#ff0000' },
      contentStyle: { 'font-size': '88px' },
    })]);
    const report = restyleDeck(deck, NOIR);
    const title = textOf(deck, 'pinned');
    expect(title.style).toEqual({});
    expect(title.contentStyle).toBeUndefined();
    expect(title.class).toEqual(['role-title']);
    expect(report.restyled).toBe(1);
    expect(report.kept).toEqual([]);
  });

  it('keeps what the author set on the box, and reports it', () => {
    const deck = deckWith([text('chosen', {
      style: { 'font-family': 'Papyrus', color: '#ff0000' },
      overrides: ['color'],
    })]);
    const report = restyleDeck(deck, NOIR);
    expect(textOf(deck, 'chosen').style).toEqual({ color: '#ff0000' });
    expect(report.kept).toEqual([{ slideId: 'slide-1', elementId: 'chosen' }]);
  });

  it('keeps a bold or coloured word, and drops a run that only repeats its box', () => {
    const deck = deckWith([text('runs', {
      style: { color: '#ff0000', 'font-size': '85px' },
      html: '<p><span style="color: #ff0000; font-size: 85px;">Deck</span>'
        + '<span style="font-size: 0.68em;">1</span> and '
        + '<span style="font-weight: 700;">bold</span> '
        + '<span style="color: #0055ff;">blue</span></p>',
    })]);
    restyleDeck(deck, NOIR);
    const html = textOf(deck, 'runs').html;
    expect(html).not.toContain('#ff0000');
    expect(html).not.toContain('85px');
    expect(html).toContain('font-size: 0.68em');
    expect(html).toContain('font-weight: 700');
    expect(html).toContain('color: #0055ff');
  });

  it('keeps sizes chosen for individual words when the theme changes', () => {
    const deck = deckWith([text('sizes', {
      style: { 'font-size': '40px' },
      html: '<p><span style="font-size: 40px">Copied size</span> '
        + '<span style="font-size: 60px">Large word</span></p>',
    })]);
    restyleDeck(deck, NOIR);
    expect(textOf(deck, 'sizes').html).not.toContain('40px');
    expect(textOf(deck, 'sizes').html).toContain('font-size: 60px');
  });

  it('keeps an authored background even when it matches the previous theme', () => {
    const deck = deckWith([]);
    deck.slides[0].background = { color: SWISS.colors.background, image: null };
    restyleDeck(deck, NOIR);
    expect(deck.slides[0].background.color).toBe(SWISS.colors.background);
  });

  it('keeps a pasted source appearance through later theme switches', () => {
    const deck = deckWith([text('pasted')]);
    deck.slides[0].background = { color: SWISS.colors.background, image: null, themePinned: true };
    pinSlidesToTheme(deck.slides, themeStyleOf(SWISS));
    expect(deck.slides[0].background.themePinned).toBeUndefined();
    restyleDeck(deck, SWISS);
    restyleDeck(deck, NOIR);
    expect(deck.slides[0].background.color).toBe(SWISS.colors.background);
    expect(textOf(deck, 'pasted').style.color).toBe(SWISS.colors.text);
  });

  it('keeps an untagged box’s size, which nothing ever pins, and hands it the rest', () => {
    const deck = deckWith([text('glyph', {
      class: ['kn-text'],
      style: { 'font-family': 'Papyrus', 'font-size': '200px', 'line-height': '1', color: '#111111' },
    })]);
    restyleDeck(deck, NOIR);
    const glyph = textOf(deck, 'glyph');
    expect(glyph.style).toEqual({ 'font-size': '200px', 'line-height': '1' });
    expect(glyph.class).toEqual([]);
  });

  it('keeps a slide’s own background or picture, and lets a pinned old ground follow', () => {
    const deck = deckWith([], [], [], []);
    installThemeStyle(deck, themeStyleOf(NOIR), NOIR.id, {
      slides: new Set(['slide-2', 'slide-3', 'slide-4']), elements: new Set(),
    });
    expect(deck.slides[0].background.themePinned).toBe(true);
    deck.slides[1].background = { color: '#123456', image: null };
    deck.slides[2].background = { color: null, image: 'assets/photo.jpg' };
    const report = restyleDeck(deck, NOIR);
    expect(deck.slides[0].background).toEqual({ color: null, image: null });
    expect(deck.slides[1].background).toEqual({ color: '#123456', image: null });
    expect(deck.slides[2].background).toEqual({ color: null, image: 'assets/photo.jpg' });
    expect(deck.slides[3].background).toEqual({ color: null, image: null });
    expect(report.ownBackgrounds).toEqual(['slide-2', 'slide-3']);
  });

  it('moves a swatch-coloured shape to the same swatch of the new palette', () => {
    const deck = deckWith([{
      id: 'box', type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 100, rot: 0, z: 1, opacity: 1,
      class: [], style: {}, fill: SWISS.palette[2], stroke: '#abcdef', radius: 0,
    } as unknown as SlideElement]);
    restyleDeck(deck, NOIR);
    const shape = deck.slides[0].elements[0] as Extract<SlideElement, { type: 'shape' }>;
    expect(shape.fill).toBe(NOIR.palette[2]);
    expect(shape.stroke).toBe('#abcdef');
  });

  it('is idempotent: a second pass changes nothing and reports nothing restyled', () => {
    const deck = deckWith([text('pinned', { style: { 'font-family': 'Papyrus' } })]);
    restyleDeck(deck, THEMES[0]);
    const once = JSON.stringify(deck);
    const report = restyleDeck(deck, THEMES[0]);
    expect(JSON.stringify(deck)).toBe(once);
    expect(report.restyled).toBe(0);
  });
});
