// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mediaNaturalSize } from '../src/renderer/editor/mediaNatural.js';

/**
 * The slide rail renders every slide with the same element ids as the canvas,
 * earlier in the page, and its thumbnails have not loaded (videos have no
 * source at all). "Circular mask", Reset mask and the context-menu mask item
 * read the picture's size with the default root, so it must be the canvas,
 * never the first match in the document.
 */
function withSize<T extends HTMLElement>(node: T, props: Record<string, number>): T {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  return node;
}

function mount(tag: 'img' | 'video', canvasSize: { w: number; h: number }): void {
  const [wKey, hKey] = tag === 'video' ? ['videoWidth', 'videoHeight'] : ['naturalWidth', 'naturalHeight'];
  const element = (media: HTMLElement): HTMLElement => {
    const node = document.createElement('div');
    node.dataset.elementId = 'media-1';
    node.appendChild(media);
    return node;
  };
  const rail = document.createElement('aside');
  rail.id = 'rail';
  rail.appendChild(element(withSize(document.createElement(tag), { [wKey]: 0, [hKey]: 0 })));
  const canvas = document.createElement('main');
  canvas.className = 'canvas-host';
  const layer = document.createElement('div');
  layer.className = 'slide-layer';
  layer.appendChild(element(withSize(document.createElement(tag), {
    [wKey]: canvasSize.w, [hKey]: canvasSize.h,
  })));
  canvas.appendChild(layer);
  document.body.append(rail, canvas);
}

afterEach(() => document.body.replaceChildren());

describe('mediaNaturalSize', () => {
  it('reads a picture off the canvas, not the unloaded rail copy before it', () => {
    mount('img', { w: 4000, h: 1000 });
    expect(mediaNaturalSize('media-1')).toEqual({ w: 4000, h: 1000 });
  });

  it('reads a video off the canvas, not the source-less rail copy before it', () => {
    mount('video', { w: 1920, h: 1080 });
    expect(mediaNaturalSize('media-1')).toEqual({ w: 1920, h: 1080 });
  });

  it('is unknown when no canvas is on the page', () => {
    const rail = document.createElement('aside');
    const node = document.createElement('div');
    node.dataset.elementId = 'media-1';
    node.appendChild(withSize(document.createElement('img'), { naturalWidth: 800, naturalHeight: 600 }));
    rail.appendChild(node);
    document.body.appendChild(rail);
    expect(mediaNaturalSize('media-1')).toBeNull();
  });
});
