import { describe, expect, it } from 'vitest';
import {
  circularMaskLayout,
  cropWindow,
  fittedImageBox,
  paintedMediaBox,
  pannedSourceBox,
  setCircularMask,
  type MaskRect,
} from '../src/shared/mediaMask.js';
import { parseDeck, emptyDeck, type SlideElement } from '../src/shared/deck.js';

/**
 * The geometry a circular mask has to get right, checked as invariants over
 * many shapes rather than as a handful of worked examples (those live in
 * `test/mediaAssets.test.ts`).
 */

type MediaElement = Extract<SlideElement, { type: 'image' | 'video' }>;

const base = {
  x: 10, y: 20, rot: 0, z: 1, opacity: 1, class: [], style: {},
};

function image(overrides: Partial<Extract<SlideElement, { type: 'image' }>>): MediaElement {
  return {
    ...base, id: 'img', type: 'image', w: 800, h: 400, src: 'assets/p.jpg', fit: 'contain',
    alt: '', sourceBox: null, ...overrides,
  };
}

describe('circular mask geometry', () => {
  const boxes = [
    { w: 800, h: 400 }, { w: 400, h: 800 }, { w: 333, h: 333 }, { w: 9, h: 1000 },
    { w: 1, h: 1 }, { w: 1200, h: 675 }, { w: 7, h: 3 },
  ];
  const naturals = [
    { w: 4000, h: 2000 }, { w: 1000, h: 2000 }, { w: 1000, h: 1000 }, { w: 3, h: 2 },
    { w: 640, h: 481 }, null,
  ];
  const fits = ['contain', 'cover', 'fill'] as const;

  it('always leaves the picture covering the whole circle at its own aspect ratio', () => {
    for (const box of boxes) {
      for (const natural of naturals) {
        for (const fit of fits) {
          const el = image({ ...box, fit });
          const layout = circularMaskLayout(el, natural);
          const where = `${box.w}x${box.h} ${fit} natural=${natural ? `${natural.w}x${natural.h}` : 'unknown'}`;

          // Square, never below the smallest usable handle box, centred on
          // the original box.
          expect(layout.w, where).toBe(layout.h);
          expect(layout.w, where).toBeGreaterThanOrEqual(8);
          expect(Math.abs(layout.x + layout.w / 2 - (el.x + el.w / 2)), where)
            .toBeLessThanOrEqual(0.5);
          expect(Math.abs(layout.y + layout.h / 2 - (el.y + el.h / 2)), where)
            .toBeLessThanOrEqual(0.5);

          // The picture spans the window in both directions (a one-pixel
          // rounding allowance), so slide never shows through the circle.
          const { sourceBox } = layout;
          expect(sourceBox.x, where).toBeLessThanOrEqual(1);
          expect(sourceBox.y, where).toBeLessThanOrEqual(1);
          expect(sourceBox.x + sourceBox.w, where).toBeGreaterThanOrEqual(layout.w - 1);
          expect(sourceBox.y + sourceBox.h, where).toBeGreaterThanOrEqual(layout.h - 1);

          // Aspect ratio is the picture's own, whatever the box did to it.
          if (natural && sourceBox.w > 20 && sourceBox.h > 20) {
            expect(sourceBox.w / sourceBox.h, where)
              .toBeCloseTo(natural.w / natural.h, 1);
          }
          expect(Number.isInteger(sourceBox.x) && Number.isInteger(sourceBox.y), where).toBe(true);
          expect(Number.isInteger(sourceBox.w) && Number.isInteger(sourceBox.h), where).toBe(true);
        }
      }
    }
  });

  it('is stable when applied a second time', () => {
    // Toggling the checkbox off and on, or Reset crop on a circle, re-runs the
    // layout on an element that already carries the crop. It must not creep.
    for (const box of boxes) {
      for (const natural of naturals) {
        const el = image({ ...box, fit: 'cover' });
        setCircularMask(el, true, natural);
        const once = { x: el.x, y: el.y, w: el.w, h: el.h, sourceBox: { ...el.sourceBox! } };
        setCircularMask(el, true, natural);
        setCircularMask(el, true, natural);
        const where = `${box.w}x${box.h}`;
        expect({ x: el.x, y: el.y, w: el.w, h: el.h }, where).toEqual({
          x: once.x, y: once.y, w: once.w, h: once.h,
        });
        expect(Math.abs(el.sourceBox!.x - once.sourceBox.x), where).toBeLessThanOrEqual(1);
        expect(Math.abs(el.sourceBox!.y - once.sourceBox.y), where).toBeLessThanOrEqual(1);
        expect(Math.abs(el.sourceBox!.w - once.sourceBox.w), where).toBeLessThanOrEqual(1);
        expect(Math.abs(el.sourceBox!.h - once.sourceBox.h), where).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps the part of an existing crop that was in view', () => {
    // A picture already panned so its right half shows: the circle must show
    // the same centre, not jump back to the middle of the photograph.
    const el = image({ w: 800, h: 400, sourceBox: { x: -1200, y: -200, w: 2000, h: 1000 } });
    const visibleCentre = { x: -1200 + 1000, y: -200 + 500 };
    setCircularMask(el, true, { w: 4000, h: 2000 });
    expect(el.w).toBe(400);
    // The window moved in by 200 on the left, so the same picture point is
    // 200 nearer its origin.
    expect(el.sourceBox!.x + el.sourceBox!.w / 2).toBeCloseTo(visibleCentre.x - 200, 0);
    expect(el.sourceBox!.y + el.sourceBox!.h / 2).toBeCloseTo(visibleCentre.y, 0);
    // Scale is unchanged: it already covered the circle.
    expect(el.sourceBox!.w).toBe(2000);
  });

  it('returns a copy of an existing crop, never the deck object itself', () => {
    const sourceBox = { x: -5, y: -5, w: 900, h: 450 };
    const el = image({ sourceBox });
    const painted = paintedMediaBox(el, { w: 4000, h: 2000 });
    expect(painted).toEqual(sourceBox);
    expect(painted).not.toBe(sourceBox);
  });

  it('paints fill and unknown-size media across the whole box', () => {
    expect(paintedMediaBox(image({ fit: 'fill' }), { w: 3, h: 2 }))
      .toEqual({ x: 0, y: 0, w: 800, h: 400 });
    expect(paintedMediaBox(image({ fit: 'cover' }), null))
      .toEqual({ x: 0, y: 0, w: 800, h: 400 });
    expect(paintedMediaBox(image({ fit: 'contain' }), { w: 0, h: 0 }))
      .toEqual({ x: 0, y: 0, w: 800, h: 400 });
  });
});

describe('mask fields in the deck format', () => {
  const deckWith = (element: Record<string, unknown>) => ({
    ...emptyDeck(),
    slides: [{ id: 's1', elements: [{ ...base, id: 'img', type: 'image', w: 800, h: 400, src: 'a.png', ...element }] }],
  });
  const first = (raw: unknown): MediaElement =>
    parseDeck(raw).slides[0].elements[0] as MediaElement;

  it('reads an absent mask as rectangular and uncropped', () => {
    const el = first(deckWith({}));
    expect(el.maskShape).toBeUndefined();
    expect(el.sourceBox).toBeNull();
  });

  it('round-trips a circular mask with its crop', () => {
    const sourceBox = { x: -180, y: 0, w: 720, h: 360 };
    const el = first(deckWith({ maskShape: 'circle', sourceBox }));
    expect(el.maskShape).toBe('circle');
    expect(el.sourceBox).toEqual(sourceBox);
    // Serialising and parsing again changes nothing.
    const again = first(JSON.parse(JSON.stringify(parseDeck(deckWith({ maskShape: 'circle', sourceBox })))));
    expect(again.maskShape).toBe('circle');
    expect(again.sourceBox).toEqual(sourceBox);
  });

  it('rejects a crop with no area, which nothing could render', () => {
    expect(() => first(deckWith({ sourceBox: { x: 0, y: 0, w: 0, h: 100 } }))).toThrow(/sourceBox/);
    expect(() => first(deckWith({ sourceBox: { x: 0, y: 0, w: 100, h: -1 } }))).toThrow(/sourceBox/);
  });

  it('accepts the crop on a video with the same shape', () => {
    const el = first(deckWith({
      type: 'video', src: 'a.mp4', maskShape: 'circle', sourceBox: { x: 1, y: 2, w: 3, h: 4 },
    }));
    expect(el.type).toBe('video');
    expect(el.sourceBox).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
});

/** Where a box-relative picture's centre lands on the slide, rotation included. */
function pictureCentre(box: MaskRect, rot: number, picture: MaskRect): { x: number; y: number } {
  const r = (rot * Math.PI) / 180;
  const lx = picture.x + picture.w / 2 - box.w / 2;
  const ly = picture.y + picture.h / 2 - box.h / 2;
  return {
    x: box.x + box.w / 2 + lx * Math.cos(r) - ly * Math.sin(r),
    y: box.y + box.h / 2 + lx * Math.sin(r) + ly * Math.cos(r),
  };
}

describe('fitting an uncropped picture frame to the picture', () => {
  it('shrinks a contain frame to the painted picture without moving it', () => {
    for (const rot of [0, 30, 90, 180]) {
      const el = image({ rot, style: { 'object-position': 'left top' } });
      const natural = { w: 1000, h: 1000 };
      const fitted = fittedImageBox(el, natural)!;
      expect(fitted).toMatchObject({ w: 400, h: 400, style: {} });
      const before = pictureCentre(el, rot, paintedMediaBox(el, natural));
      const after = pictureCentre(fitted, rot, { x: 0, y: 0, w: fitted.w, h: fitted.h });
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
    }
  });

  it('leaves crops, circles, other fits and already-fitted frames alone', () => {
    const natural = { w: 1000, h: 1000 };
    expect(fittedImageBox(image({ sourceBox: { x: 0, y: 0, w: 800, h: 400 } }), natural)).toBeNull();
    expect(fittedImageBox(image({ maskShape: 'circle' }), natural)).toBeNull();
    expect(fittedImageBox(image({ fit: 'cover' }), natural)).toBeNull();
    expect(fittedImageBox(image({ w: 400 }), natural)).toBeNull();
    expect(fittedImageBox(image({}), null)).toBeNull();
  });

  it('leaves a frame that paints something of its own, and fits to whole pixels', () => {
    const natural = { w: 1000, h: 1000 };
    expect(fittedImageBox(image({ borderWidth: 4 }), natural)).toBeNull();
    expect(fittedImageBox(image({ borderRadius: 12 }), natural)).toBeNull();
    expect(fittedImageBox(image({ style: { 'background-color': '#000' } }), natural)).toBeNull();
    expect(fittedImageBox(image({ style: { 'box-shadow': '0 4px 8px #0004' } }), natural)).toBeNull();
    const fitted = fittedImageBox(image({ w: 801, h: 400 }), { w: 1024, h: 767 })!;
    expect(Object.values(fitted).filter((v) => typeof v === 'number').every(Number.isInteger)).toBe(true);
    expect(fittedImageBox({ ...image({}), ...fitted }, { w: 1024, h: 767 })).toBeNull();
  });
});

describe('dragging a crop window', () => {
  const origin = { x: 100, y: 100, w: 400, h: 200 };
  const picture = { x: 0, y: 0, w: 400, h: 200 };

  it('moves only the dragged edge and stops at the picture', () => {
    const inward = cropWindow({ x: 100, y: 100, w: 300, h: 200 }, origin, picture, 0);
    expect(inward).toEqual({ x: 100, y: 100, w: 300, h: 200, sourceBox: { x: 0, y: 0, w: 400, h: 200 } });
    const outward = cropWindow({ x: 40, y: 100, w: 460, h: 200 }, origin, picture, 0);
    expect(outward).toMatchObject({ x: 100, w: 400 });
    const tiny = cropWindow({ x: 100, y: 100, w: -50, h: 200 }, origin, picture, 0);
    expect(tiny.w).toBe(8);
  });

  it('keeps a rotated picture where it was on the slide', () => {
    for (const rot of [15, 90, 200]) {
      const cropped = cropWindow({ x: 160, y: 130, w: 250, h: 120 }, origin, picture, rot);
      const before = pictureCentre(origin, rot, picture);
      const after = pictureCentre(cropped, rot, cropped.sourceBox);
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
    }
  });

  it('keeps a locked (circle, Shift) window in proportion at the picture edge', () => {
    // A circle touching the top and bottom of a landscape picture.
    const circle = { x: 100, y: 100, w: 270, h: 270 };
    const wide = { x: -100, y: 0, w: 480, h: 270 };
    const grown = cropWindow({ x: 100, y: 100, w: 320, h: 320 }, circle, wide, 0, true);
    expect(grown.w).toBe(grown.h);
    expect(grown).toMatchObject({ x: 100, y: 100, w: 270 });
    const fromTopLeft = cropWindow({ x: 50, y: 50, w: 320, h: 320 }, circle, wide, 0, true);
    expect(fromTopLeft).toMatchObject({ x: 100, y: 100, w: 270, h: 270 });
  });

  it('never moves an edge the drag leaves alone, even in a letterboxed frame', () => {
    // An 800x600 contain frame showing 16:9 footage: picture 800x450 at y=75.
    const frame = { x: 0, y: 0, w: 800, h: 600 };
    const footage = { x: 0, y: 75, w: 800, h: 450 };
    expect(cropWindow({ x: 0, y: 0, w: 700, h: 600 }, frame, footage, 0)).toMatchObject({ x: 0, y: 0, w: 700, h: 600 });
    expect(cropWindow({ x: 0, y: -50, w: 800, h: 650 }, frame, footage, 0)).toMatchObject({ y: 0, h: 600 });
    expect(cropWindow({ x: 0, y: 100, w: 800, h: 500 }, frame, footage, 0).sourceBox).toEqual({ x: 0, y: -25, w: 800, h: 450 });
  });

  it('writes whole pixels and leaves the picture where it was', () => {
    const picture = { x: 37.5, y: 12.25, w: 725, h: 375.5 };
    for (let i = 0; i < 50; i += 1) {
      const rect = { x: 100 + i * 1.37, y: 100 + i * 0.91, w: 400 - i * 1.37, h: 200 - i * 0.91 };
      const cropped = cropWindow(rect, origin, picture, 0);
      expect([cropped.x, cropped.y, cropped.w, cropped.h].every(Number.isInteger)).toBe(true);
      expect(Math.abs(cropped.x + cropped.sourceBox.x - (origin.x + picture.x))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(cropped.y + cropped.sourceBox.y - (origin.y + picture.y))).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('panning a crop', () => {
  it('stops where the picture would leave its window, without a jump at the start', () => {
    const picture = { x: -100, y: -50, w: 600, h: 300 };
    const window = { w: 400, h: 200 };
    expect(pannedSourceBox(picture, window, 500, -500)).toEqual({ x: 0, y: -100, w: 600, h: 300 });
    expect(pannedSourceBox(picture, window, 0, 0)).toEqual(picture);
    // Smaller than its window (letterboxed): stays inside it.
    expect(pannedSourceBox({ x: 0, y: 75, w: 800, h: 450 }, { w: 800, h: 600 }, 40, 500))
      .toEqual({ x: 0, y: 150, w: 800, h: 450 });
  });
});
