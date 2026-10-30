// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDeck, NEW_MEDIA_FIT, type SlideElement } from '../src/shared/deck.js';
import { EditorCanvas } from '../src/renderer/editor/canvas.js';
import { Inspector } from '../src/renderer/editor/inspector.js';
import { EditorStore, pasteFromClipboard } from '../src/renderer/editor/store.js';
import { makeContextActions, type ShellDeps } from '../src/renderer/editor/shellWiring.js';

/**
 * Cropping and resizing pictures and videos under every "Keep aspect ratio"
 * setting, driven the way a person does it: the inspector's checkbox, its
 * Edit mask button, and pointer drags on the canvas handles.
 *
 * Vincent unticked "Keep aspect ratio" on a video and the crop window still
 * kept its proportions: since #62 every media drag was locked unless Shift
 * was held. The rule now: a crop reshapes the window, never the picture, so
 * it is free whatever the box says and Shift locks it; a resize follows the
 * box, and Shift locks it too; a circle never frees. No drag writes the box. New media starts with the
 * box ticked, so a resize keeps its proportions.
 */

type Media = Extract<SlideElement, { type: 'image' | 'video' }>;
type Fit = Media['fit'];
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

function installDomShims(): void {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  if (!('PointerEvent' in globalThis)) {
    class PointerEventShim extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventShim;
  }
  for (const name of ['setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, { configurable: true, value: () => {} });
    }
  }
  if (!globalThis.CSS) {
    (globalThis as unknown as { CSS: unknown }).CSS = {
      escape: (v: string) => v.replace(/["\\]/g, '\\$&'),
    };
  }
  (globalThis as unknown as { window: Window }).window.api = {
    assetUrl: (src: string) => src,
    pathForFile: () => '',
    importAssets: async () => [],
    probeAsset: async () => ({ width: 640, height: 360, duration: 6 }),
  } as never;
  // Loaded media: a crop starts from where the picture is painted, which
  // needs its own size (jsdom decodes nothing, so it would never be known).
  for (const [proto, w, h] of [
    [HTMLImageElement.prototype, 'naturalWidth', 'naturalHeight'],
    [HTMLVideoElement.prototype, 'videoWidth', 'videoHeight'],
  ] as const) {
    Object.defineProperty(proto, w, { configurable: true, get: () => 640 });
    Object.defineProperty(proto, h, { configurable: true, get: () => 360 });
  }
  for (const [name, paused] of [['play', false], ['pause', true]] as const) {
    Object.defineProperty(HTMLMediaElement.prototype, name, {
      configurable: true,
      value: vi.fn(function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { configurable: true, value: paused });
        return name === 'play' ? Promise.resolve() : undefined;
      }),
    });
  }
}

/** A 640x360 picture or video, clear of the canvas centre lines so no guide snaps it. */
function media(type: 'image' | 'video', fit: Fit, extra: Partial<Media> = {}): Media {
  const base = {
    id: 'media', x: 400, y: 200, w: 640, h: 360, rot: 0, z: 1, opacity: 1,
    class: [], style: {}, src: type === 'video' ? 'assets/clip.mp4' : 'assets/pic.png',
    fit, sourceBox: null,
  };
  return (type === 'video'
    ? { ...base, type, autoplay: false, loop: true, muted: true, controls: false, start: 0, end: null, poster: null, ...extra }
    : { ...base, type, alt: '', ...extra }) as Media;
}

function setup(element: Media, others: SlideElement[] = []) {
  installDomShims();
  const deck = emptyDeck('Crop test');
  deck.slides[0].elements = [element, ...others];
  const canvasHost = document.createElement('div');
  const inspectorHost = document.createElement('div');
  document.body.replaceChildren(canvasHost, inspectorHost);

  const store = new EditorStore(deck, '/tmp/crop-test');
  const canvas = new EditorCanvas(canvasHost, store);
  const inspector = new Inspector(inspectorHost, store);
  // The shell's wiring between the two (shellWiring.ts).
  inspector.onToggleMask = (id) => canvas.toggleMaskMode(id);
  inspector.maskingElement = () => canvas.maskingElement();
  inspector.editingFrame = (el) => canvas.editingFrame(el);
  canvas.onMaskModeChange = () => inspector.render();
  canvasHost.querySelector<HTMLElement>('.stage')!.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1920, height: 1080 }) as DOMRect;
  store.select([element.id]);

  const current = () => store.slide!.elements.find((e) => e.id === element.id) as Media;
  const checkbox = (text: string) => {
    const label = [...inspectorHost.querySelectorAll('label.field-check')]
      .find((node) => node.textContent?.trim() === text);
    expect(label, `no "${text}" checkbox in the inspector`).toBeTruthy();
    return label!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  };
  const keepAspectBox = () => checkbox('Keep aspect ratio');
  /** Tick or untick the inspector's checkbox, as a click would. */
  const setKeepAspect = (on: boolean) => {
    const box = keepAspectBox();
    if (box.checked !== on) box.click();
    expect(keepAspectBox().checked).toBe(on);
  };
  /** Press the inspector's Edit mask / Done editing mask button. */
  const toggleMask = () =>
    inspectorHost.querySelector<HTMLButtonElement>('.mask-action-row .panel-action')!.click();
  /** Drag one of the element's handles by (dx, dy) on the 1:1 stage. */
  const drag = (handle: Handle, dx: number, dy: number, shiftKey = false) => {
    const node = canvasHost.querySelector<HTMLElement>(`.handle-${handle}[data-element-id="${element.id}"]`);
    expect(node, `no ${handle} handle`).toBeTruthy();
    const el = current();
    const start = {
      x: el.x + (handle.includes('w') ? 0 : handle.includes('e') ? el.w : el.w / 2),
      y: el.y + (handle.includes('n') ? 0 : handle.includes('s') ? el.h : el.h / 2),
    };
    const event = (type: string, x: number, y: number) => new PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0, shiftKey,
    });
    node!.dispatchEvent(event('pointerdown', start.x, start.y));
    canvasHost.dispatchEvent(event('pointermove', start.x + dx / 2, start.y + dy / 2));
    canvasHost.dispatchEvent(event('pointermove', start.x + dx, start.y + dy));
    canvasHost.dispatchEvent(event('pointerup', start.x + dx, start.y + dy));
    return current();
  };
  /** A Props geometry field: X, Y, W or H. */
  const geometryInput = (label: 'X' | 'Y' | 'W' | 'H') => {
    const field = [...inspectorHost.querySelectorAll('.geometry-section label.field-number')]
      .find((node) => node.querySelector('span')?.textContent === label);
    expect(field, `no ${label} field in Props`).toBeTruthy();
    return field!.querySelector<HTMLInputElement>('input')!;
  };
  /** Type a value into a Props geometry field and commit it, as Return does. */
  const typeGeometry = (label: 'X' | 'Y' | 'W' | 'H', value: number) => {
    const input = geometryInput(label);
    input.value = String(value);
    input.dispatchEvent(new Event('change'));
    return current();
  };
  /** What Props shows for the selection's box. */
  const readouts = () => ({
    x: Number(geometryInput('X').value),
    y: Number(geometryInput('Y').value),
    w: Number(geometryInput('W').value),
    h: Number(geometryInput('H').value),
  });
  /** The selection outline the canvas draws, in slide pixels. */
  const outline = () => {
    const box = canvasHost.querySelector<HTMLElement>('.sel-box')!;
    return {
      x: parseFloat(box.style.left), y: parseFloat(box.style.top),
      w: parseFloat(box.style.width), h: parseFloat(box.style.height),
    };
  };
  return {
    store, canvas, canvasHost, inspectorHost, current, checkbox, keepAspectBox, setKeepAspect, toggleMask, drag,
    typeGeometry, readouts, outline,
  };
}

/** Where the whole picture sits on the slide: what a crop must never move or reshape. */
const picture = (el: Media) => {
  const box = el.sourceBox ?? { x: 0, y: 0, w: el.w, h: el.h };
  return { x: el.x + box.x, y: el.y + box.y, w: box.w, h: box.h };
};

/** Each handle's free drag and the box it must make from 400,200 640x360. */
const FREE_DRAGS: Array<{ handle: Handle; dx: number; dy: number; box: { x: number; y: number; w: number; h: number } }> = [
  { handle: 'se', dx: -200, dy: -60, box: { x: 400, y: 200, w: 440, h: 300 } },
  { handle: 'nw', dx: 120, dy: 30, box: { x: 520, y: 230, w: 520, h: 330 } },
  { handle: 'ne', dx: -100, dy: 90, box: { x: 400, y: 290, w: 540, h: 270 } },
  { handle: 'sw', dx: 150, dy: -110, box: { x: 550, y: 200, w: 490, h: 250 } },
  { handle: 'e', dx: -230, dy: 0, box: { x: 400, y: 200, w: 410, h: 360 } },
  { handle: 'w', dx: 170, dy: 0, box: { x: 570, y: 200, w: 470, h: 360 } },
  { handle: 'n', dx: 0, dy: 100, box: { x: 400, y: 300, w: 640, h: 260 } },
  { handle: 's', dx: 0, dy: -130, box: { x: 400, y: 200, w: 640, h: 230 } },
];

const ratio = (el: { w: number; h: number }) => el.w / el.h;

describe('cropping media in mask mode', () => {
  for (const type of ['video', 'image'] as const) {
    for (const keepAspect of [false, true]) {
      for (const shift of [false, true]) {
        const free = !shift;
        const name = `${type}, "Keep aspect ratio" ${keepAspect ? 'on' : 'off'}${shift ? ', Shift held' : ''}`;

        it(`${name}: every handle crops ${free ? 'freely' : 'in proportion'}, the picture stays put`, () => {
          for (const { handle, dx, dy, box } of FREE_DRAGS) {
            const t = setup(media(type, 'contain'));
            t.setKeepAspect(keepAspect);
            expect(t.current().fit).toBe(keepAspect ? 'contain' : 'fill');
            const before = picture(t.current());
            t.toggleMask();
            expect(t.canvas.maskingElement()).toBe('media');

            const after = t.drag(handle, dx, dy, shift);
            const where = `${handle} by (${dx}, ${dy})`;
            if (free) {
              expect({ x: after.x, y: after.y, w: after.w, h: after.h }, where).toEqual(box);
            } else {
              expect(ratio(after), where).toBeCloseTo(16 / 9, 1);
              expect(after.w, `${where} did not crop`).toBeLessThan(640);
            }
            // Cropping, not scaling: the picture is exactly where and as big as it was.
            expect(picture(after), where).toEqual(before);
            // The crop leaves the checkbox alone.
            expect(after.fit, where).toBe(keepAspect ? 'contain' : 'fill');
            expect(t.store.history()[0]?.label, where).toBe(`Crop ${type}`);
          }
        });
      }
    }

    it(`${type}: cover crops freely too, and Shift locks it`, () => {
      const t = setup(media(type, 'cover'));
      expect(t.keepAspectBox().checked).toBe(true);
      t.toggleMask();
      const free = t.drag('se', -200, -60);
      expect(free).toMatchObject({ w: 440, h: 300 });
      expect(ratio(t.drag('se', -100, -80, true))).toBeCloseTo(440 / 300, 1);
    });

    it(`${type}: ticking or unticking the box mid-session changes nothing about the crop`, () => {
      const t = setup(media(type, 'contain'));
      t.toggleMask();
      expect(t.drag('se', -200, -60)).toMatchObject({ w: 440, h: 300 });
      t.setKeepAspect(false);
      expect(t.drag('se', -40, -100)).toMatchObject({ w: 400, h: 200 });
      t.setKeepAspect(true);
      expect(t.drag('e', -100, 0)).toMatchObject({ w: 300, h: 200 });
    });

    it(`${type}: an existing crop keeps cropping freely, and its picture never moves`, () => {
      const t = setup(media(type, 'contain', { sourceBox: { x: -80, y: -40, w: 800, h: 450 } }));
      t.setKeepAspect(false);
      const before = picture(t.current());
      t.toggleMask();
      expect(t.drag('nw', 60, 100)).toMatchObject({ x: 460, y: 300, w: 580, h: 260 });
      expect(picture(t.current())).toEqual(before);
      expect(t.current().sourceBox).toEqual({ x: -140, y: -140, w: 800, h: 450 });
    });

    it(`${type}: a circular mask stays round whatever the box and Shift say`, () => {
      const t = setup(media(type, 'contain'));
      t.checkbox('Circular mask').click();
      expect(t.current().maskShape).toBe('circle');
      t.setKeepAspect(false);
      t.toggleMask();
      for (const shift of [false, true]) {
        const after = t.drag('se', -120, -20, shift);
        expect(after.w, `shift ${shift}`).toBe(after.h);
      }
    });

    it(`${type}: dragging an edge out past the picture changes nothing and records no crop`, () => {
      // Like a pan that moved nothing: the window already shows the whole
      // picture, so there is no crop to write, no History entry, no Reset.
      const t = setup(media(type, 'contain'));
      const before = structuredClone(t.current());
      t.toggleMask();
      for (const [handle, dx, dy] of [['se', 120, 90], ['nw', -60, -40], ['e', 200, 0]] as const) {
        expect(t.drag(handle, dx, dy), handle).toEqual(before);
      }
      expect(t.store.history()).toEqual([]);
      expect(t.store.canUndo()).toBe(false);
    });

    it(`${type}: one undo step puts the uncropped media back`, () => {
      const t = setup(media(type, 'fill'));
      t.toggleMask();
      t.drag('se', -200, -60);
      t.drag('w', 50, 0);
      expect(t.current().sourceBox).not.toBeNull();
      t.store.undo();
      t.store.undo();
      expect(t.current()).toMatchObject({ x: 400, y: 200, w: 640, h: 360, sourceBox: null, fit: 'fill' });
    });
  }

  it('image: a letterboxed picture dragged out past its edges is left as authored', () => {
    // A square picture in a 16:9 `contain` frame: the editor fits the frame
    // to the painted picture for the drag, and a crop that moved nothing
    // must not write that fitted frame, or a crop, back into the deck.
    const spies = (['naturalWidth', 'naturalHeight'] as const).map((name) =>
      vi.spyOn(HTMLImageElement.prototype, name, 'get').mockReturnValue(400));
    try {
      const t = setup(media('image', 'contain'));
      const before = structuredClone(t.current());
      t.toggleMask();
      expect(t.drag('se', 80, 60)).toEqual(before);
      expect(t.store.history()).toEqual([]);
      // An edge that does move still crops.
      expect(t.drag('e', -60, 0).sourceBox).not.toBeNull();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('crops the slide 5 Minecraft video of 2610_TRI_site_visit freely', () => {
    // The element exactly as it is saved in that deck: box unticked, already cropped.
    const t = setup(media('video', 'fill', {
      id: 'media', x: -128, y: 392, w: 758, h: 188, autoplay: true, muted: true,
      sourceBox: { x: 0, y: 0, w: 1040, h: 260 },
    }));
    expect(t.keepAspectBox().checked).toBe(false);
    const before = picture(t.current());
    t.toggleMask();
    const after = t.drag('se', -150, 60);
    expect(after).toMatchObject({ x: -128, y: 392, w: 608, h: 248 });
    expect(picture(after)).toEqual(before);
  });
});

describe('a picture made round by CSS border-radius: 50%', () => {
  // Agent imports and older decks carry the circle as CSS, with no maskShape.
  // Props reads it as a circular mask; the right-click menu and the canvas
  // used to test maskShape only, so the menu offered to make it circular and
  // crop mode treated its corners as part of the picture.
  for (const type of ['video', 'image'] as const) {
    const round = () => setup(media(type, 'fill', { style: { 'border-radius': '50%' } }));
    const menu = (t: ReturnType<typeof setup>) => {
      const items = () => makeContextActions(
        { store: t.store, canvas: t.canvas } as unknown as ShellDeps, {} as never,
      )(t.current()).flatMap((item) => (item === 'separator' ? [] : [item]));
      return {
        labels: () => items().map((item) => item.label),
        run: (label: string) => {
          const item = items().find((entry) => entry.label === label);
          expect(item, `no "${label}" row`).toBeTruthy();
          item!.action();
        },
      };
    };

    it(`${type}: the right-click menu agrees with Props, with the same History labels`, () => {
      const t = round();
      const m = menu(t);
      expect(t.checkbox('Circular mask').checked).toBe(true);
      expect(m.labels()).toContain('Rectangular mask');
      expect(m.labels()).not.toContain('Circular mask');

      m.run('Rectangular mask');
      expect(t.current().maskShape).toBe('rect');
      expect(t.checkbox('Circular mask').checked).toBe(false);
      expect(t.store.history()[0]?.label).toBe('Rectangular mask');

      m.run('Circular mask');
      expect(t.current().maskShape).toBe('circle');
      expect(t.checkbox('Circular mask').checked).toBe(true);
      expect(t.store.history()[0]?.label).toBe('Circular mask');
    });

    it(`${type}: in crop mode its corners are outside the picture, and it keeps its shape`, () => {
      const t = round();
      const press = (x: number, y: number) => {
        for (const kind of ['pointerdown', 'pointerup']) {
          t.canvas['host'].dispatchEvent(new PointerEvent(kind, {
            clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0,
          }));
        }
      };
      t.toggleMask();
      press(720, 380);
      expect(t.canvas.maskingElement(), 'a click inside the circle stays cropping').toBe('media');
      press(410, 210);
      expect(t.canvas.maskingElement(), 'a click in the corner is a click away').toBeNull();

      t.toggleMask();
      expect(ratio(t.drag('se', -120, -20))).toBeCloseTo(640 / 360, 1);
    });
  }
});

describe('resizing media outside mask mode', () => {
  for (const type of ['video', 'image'] as const) {
    it(`${type}, box unticked: stretches freely and stays unticked; Shift keeps proportions`, () => {
      const t = setup(media(type, 'contain'));
      t.setKeepAspect(false);
      expect(t.drag('se', 160, -100)).toMatchObject({ w: 800, h: 260, fit: 'fill' });
      const locked = t.drag('se', 200, 10, true);
      expect(ratio(locked)).toBeCloseTo(800 / 260, 1);
      expect(locked.fit).toBe('fill');
      expect(t.keepAspectBox().checked).toBe(false);
    });

    for (const fit of ['contain', 'cover'] as const) {
      it(`${type}, box ticked (${fit}): keeps proportions with or without Shift, and stays ticked`, () => {
        const t = setup(media(type, fit));
        expect(t.keepAspectBox().checked).toBe(true);
        const locked = t.drag('se', 160, -100);
        expect(ratio(locked)).toBeCloseTo(16 / 9, 1);
        expect(locked.fit).toBe(fit);
        // Shift used to free the box and save the picture stretched.
        const shifted = t.drag('e', -100, 0, true);
        expect(shifted.w).toBe(locked.w - 100);
        expect(ratio(shifted)).toBeCloseTo(16 / 9, 1);
        expect(shifted.fit).toBe(fit);
        expect(t.keepAspectBox().checked).toBe(true);
      });
    }

    it(`${type}, cropped and unticked: the crop stretches with its box`, () => {
      const t = setup(media(type, 'fill', { sourceBox: { x: -80, y: -40, w: 800, h: 450 } }));
      expect(t.drag('e', -320, 0)).toMatchObject({
        w: 320, h: 360, sourceBox: { x: -40, y: -40, w: 400, h: 450 },
      });
    });
  }
});

describe('new media starts with "Keep aspect ratio" on', () => {
  it('is the default the editor uses for every new picture and video', () => {
    expect(NEW_MEDIA_FIT).toBe('contain');
  });

  it('a pasted video lands with the box ticked', async () => {
    const t = setup(media('image', 'contain', { id: 'other', x: 0, y: 0, w: 100, h: 100 }));
    window.api.readClipboard = async () => ({
      kind: 'external-image',
      asset: { src: 'assets/clip.abc12345.mp4', kind: 'video', width: 1280, height: 720, duration: 4 },
    });
    expect(await pasteFromClipboard(t.store)).toEqual({ kind: 'elements', count: 1 });
    const [pasted] = t.store.selectedElements() as Media[];
    expect(pasted).toMatchObject({ type: 'video', fit: 'contain' });
    expect(t.keepAspectBox().checked).toBe(true);
  });
});

/** Give every picture on the page this intrinsic size, as a loaded one has; returns the undo. */
function stubNaturalSize(size: { w: number; h: number }): () => void {
  const proto = HTMLImageElement.prototype;
  const saved = (['naturalWidth', 'naturalHeight'] as const)
    .map((name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const);
  Object.defineProperty(proto, 'naturalWidth', { configurable: true, get: () => size.w });
  Object.defineProperty(proto, 'naturalHeight', { configurable: true, get: () => size.h });
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else delete (proto as unknown as Record<string, unknown>)[name];
    }
  };
}

/**
 * One picture, one box. A size typed in Props re-cropped a cropped picture
 * (the window grew, its crop did not) and stretched a circle into an
 * ellipse, where dragging a handle scales both; and a letterboxed picture,
 * outlined on the picture it paints, showed its empty frame's size in Props
 * and snapped other objects to that frame's invisible edges.
 */
describe('a size typed in Props does what a handle drag does', () => {
  const crop = { x: -80, y: -40, w: 800, h: 450 };

  for (const type of ['video', 'image'] as const) {
    it(`${type}, cropped: a typed width or height scales the crop with its window`, () => {
      const dragged = setup(media(type, 'contain', { sourceBox: crop })).drag('se', -320, -180);
      expect(dragged).toMatchObject({ w: 320, h: 180, sourceBox: { x: -40, y: -20, w: 400, h: 225 } });
      for (const [label, value] of [['W', 320], ['H', 180]] as const) {
        const typed = setup(media(type, 'contain', { sourceBox: crop })).typeGeometry(label, value);
        expect(typed, `typed ${label}`).toMatchObject({ x: 400, y: 200 });
        expect({ w: typed.w, h: typed.h, sourceBox: typed.sourceBox }, `typed ${label}`)
          .toEqual({ w: dragged.w, h: dragged.h, sourceBox: dragged.sourceBox });
      }
    });

    it(`${type}, cropped with "Keep aspect ratio" off: a typed width stretches the crop with its box`, () => {
      const t = setup(media(type, 'fill', { sourceBox: crop }));
      expect(t.typeGeometry('W', 320)).toMatchObject({
        w: 320, h: 360, sourceBox: { x: -40, y: -40, w: 400, h: 450 },
      });
    });

    it(`${type}: a typed width keeps a circle declared by CSS round`, () => {
      const t = setup(media(type, 'fill', {
        w: 300, h: 300, style: { 'border-radius': '50%' },
        sourceBox: { x: -150, y: 0, w: 600, h: 300 },
      }));
      expect(t.typeGeometry('W', 150)).toMatchObject({ w: 150, h: 150 });
    });

    it(`${type}: a typed width keeps a circular mask round`, () => {
      const t = setup(media(type, 'contain'));
      t.checkbox('Circular mask').click();
      t.setKeepAspect(false);
      const before = t.current();
      expect(before.w).toBe(before.h);
      const after = t.typeGeometry('W', before.w / 2);
      expect({ w: after.w, h: after.h }).toEqual({ w: before.w / 2, h: before.h / 2 });
      expect(after.sourceBox).toEqual({
        x: Math.round(before.sourceBox!.x / 2), y: Math.round(before.sourceBox!.y / 2),
        w: Math.round(before.sourceBox!.w / 2), h: Math.round(before.sourceBox!.h / 2),
      });
    });
  }

  describe('a letterboxed picture', () => {
    // A 16:9 picture in a 640x500 frame: painted 640x360 at y 270, the frame's
    // bottom edge (y 700) 70px below the picture's (y 630).
    let restore: () => void = () => {};
    beforeEach(() => { restore = stubNaturalSize({ w: 160, h: 90 }); });
    afterEach(() => restore());
    const picture = { x: 400, y: 270, w: 640, h: 360 };
    const block = {
      id: 'block', type: 'shape', shape: 'rect', x: 1300, y: 600, w: 300, h: 100, rot: 0, z: 2, opacity: 1,
      class: [], style: {}, fill: '#888888', stroke: null, strokeWidth: 0, radius: 0,
      path: null, pathSize: null, arrowStart: false, arrowEnd: false,
    } as SlideElement;
    const blockOf = (t: ReturnType<typeof setup>) => t.store.slide!.elements.find((e) => e.id === 'block')!;
    const pointer = (type: string, x: number, y: number) => new PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0,
    });

    it('shows in Props the box its outline draws, and takes a typed size from it', () => {
      const t = setup(media('image', 'contain', { h: 500 }));
      expect(t.outline(), 'the outline is not on the picture').toEqual(picture);
      expect(t.readouts(), 'Props shows the empty frame, not the outlined picture').toEqual(picture);
      expect(t.current(), 'looking at the picture edited it').toMatchObject({ y: 200, h: 500, sourceBox: null });

      expect(t.typeGeometry('W', 320)).toMatchObject({ x: 400, y: 270, w: 320, h: 180, sourceBox: null });
      expect(t.readouts()).toEqual({ x: 400, y: 270, w: 320, h: 180 });
      expect(t.outline()).toEqual(t.readouts());

      // A typed position places the picture, not the empty frame around it.
      t.store.undo();
      expect(t.readouts()).toEqual(picture);
      expect(t.typeGeometry('Y', 100)).toMatchObject({ y: 100, h: 360 });
      expect(t.outline()).toEqual({ ...picture, y: 100 });
    });

    it('is snapped to by the edges it shows, not by its frame', () => {
      const t = setup(media('image', 'contain', { h: 500 }), [block]);
      // A move: the block's top edge 3px below the picture's bottom snaps onto it…
      const move = (dy: number) => {
        t.store.select([]);
        t.canvasHost.dispatchEvent(pointer('pointerdown', 1450, 650));
        t.canvasHost.dispatchEvent(pointer('pointermove', 1450, 650 + dy / 2));
        t.canvasHost.dispatchEvent(pointer('pointermove', 1450, 650 + dy));
        t.canvasHost.dispatchEvent(pointer('pointerup', 1450, 650 + dy));
        const y = blockOf(t).y;
        t.store.undo();
        return y;
      };
      expect(move(27), 'the move did not snap to the picture\'s bottom edge').toBe(630);
      // …and 3px above the frame's invisible bottom edge, nothing pulls it.
      expect(move(97), 'the move snapped to the empty frame\'s bottom edge').toBe(697);

      // A resize snaps to the picture too.
      t.store.select(['block']);
      const handle = t.canvasHost.querySelector<HTMLElement>('.handle-n[data-element-id="block"]')!;
      handle.dispatchEvent(pointer('pointerdown', 1450, 600));
      t.canvasHost.dispatchEvent(pointer('pointermove', 1450, 615));
      t.canvasHost.dispatchEvent(pointer('pointermove', 1450, 627));
      t.canvasHost.dispatchEvent(pointer('pointerup', 1450, 627));
      expect(blockOf(t), 'the resize did not snap to the picture\'s bottom edge').toMatchObject({ y: 630, h: 70 });
    });
  });
});
