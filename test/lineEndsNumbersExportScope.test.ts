// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { deckForExport, emptyDeck, parseDeck, slideNumber, type Deck, type SlideElement } from '../src/shared/deck.js';
import { shapeSvg } from '../src/shared/shapeSvg.js';
import { renderSlide } from '../src/renderer/player/render.js';

type Shape = Extract<SlideElement, { type: 'shape' }>;

const line = (over: Partial<Shape>): Shape => ({
  id: 'l', type: 'shape', shape: 'line', x: 0, y: 0, w: 400, h: 20, rot: 0, z: 1, opacity: 1, class: [], style: {},
  fill: null, stroke: '#1d2545', strokeWidth: 8, radius: 0, path: null, pathSize: null, arrowStart: false, arrowEnd: false,
  ...over,
} as Shape);

const dots = (svg: string): number => svg.match(/<circle /g)?.length ?? 0;

describe('line ends', () => {
  const roundCap = (svg: string): boolean => svg.includes('stroke-linecap="round"');

  it('keeps the old look when unset: a straight line flat, a curve round', () => {
    expect(roundCap(shapeSvg(line({})))).toBe(false);
    expect(dots(shapeSvg(line({})))).toBe(0);
    expect(roundCap(shapeSvg(line({ control: { x: 200, y: -80 } })))).toBe(true);
  });

  it('rounds or flattens either kind on request, but never an end under a head', () => {
    expect(roundCap(shapeSvg(line({ style: { 'stroke-linecap': 'round' } })))).toBe(true);
    expect(dots(shapeSvg(line({ control: { x: 200, y: -80 }, style: { 'stroke-linecap': 'butt' } })))).toBe(0);
    const headed = shapeSvg(line({ arrowEnd: true, style: { 'stroke-linecap': 'round' } }));
    expect(dots(headed)).toBe(1);
    expect(roundCap(headed)).toBe(false);
  });

  it('paints a round end once, with no dot over the stroke, when there is no head', () => {
    const svg = shapeSvg(line({ stroke: '#1d254580', style: { 'stroke-linecap': 'round' } }));
    expect(dots(svg)).toBe(0);
  });
});

function deckOf(slides: Array<{ id: string; layout?: string; skipped?: boolean }>, show = true): Deck {
  return parseDeck({
    ...emptyDeck(),
    showSlideNumbers: show,
    slides: slides.map((slide) => ({ ...emptyDeck().slides[0], ...slide })),
  });
}

describe('slide numbers', () => {
  const deck = deckOf([
    { id: 'title', layout: 'title' }, { id: 'a' }, { id: 'hidden', skipped: true }, { id: 'b' },
  ]);

  it('count deck order, skipping title and hidden slides, which carry none', () => {
    expect(deck.slides.map((slide) => slideNumber(deck, slide))).toEqual([null, 1, null, 2]);
    expect(slideNumber({ ...deck, showSlideNumbers: false }, deck.slides[1])).toBeNull();
  });

  it('are drawn only when the renderer knows the deck', () => {
    const number = (root: HTMLElement) => root.querySelector('.slide-number')?.textContent ?? null;
    expect(number(renderSlide(deck.slides[3], { deck, resolveSrc: (src) => src }))).toBe('2');
    expect(number(renderSlide(deck.slides[3], { resolveSrc: (src) => src }))).toBeNull();
    expect(number(renderSlide(deck.slides[0], { deck, resolveSrc: (src) => src }))).toBeNull();
  });

  it('default to off for decks saved before numbering existed', () => {
    expect(parseDeck(emptyDeck()).showSlideNumbers).toBe(false);
  });
});

describe('exporting some slides', () => {
  const deck = deckOf([{ id: 'a' }, { id: 'hidden', skipped: true }, { id: 'b' }, { id: 'c' }]);
  const ids = (d: Deck) => d.slides.map((slide) => slide.id);

  it('keeps deck order and leaves hidden slides out unless asked for', () => {
    expect(ids(deckForExport(deck, undefined))).toEqual(['a', 'b', 'c']);
    expect(ids(deckForExport(deck, ['c', 'a']))).toEqual(['a', 'c']);
    expect(ids(deckForExport(deck, ['hidden', 'b'], true))).toEqual(['hidden', 'b']);
  });

  it('refuses rather than exporting the whole deck', () => {
    expect(() => deckForExport(deck, ['hidden'])).toThrow('No slides to export');
    expect(() => deckForExport(deck, ['gone'])).toThrow('no longer exist');
    expect(() => deckForExport(deck, 'a')).toThrow('array of strings');
  });

  it('keeps the deck\'s numbers on the slides it exports', () => {
    const exported = deckForExport(deck, ['c']);
    expect(slideNumber(exported, exported.slides[0])).toBe(3);
    expect(parseDeck(exported).fixedSlideNumbers).toEqual({ c: 3 });
  });
});
