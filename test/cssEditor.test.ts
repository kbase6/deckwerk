// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CssEditor } from '../src/renderer/editor/cssEditor.js';

// jsdom has no text layout; these tests only exercise persistence.
Object.assign(Range.prototype, {
  getClientRects: () => [], getBoundingClientRect: () => new DOMRect(),
});

let editor: CssEditor;
afterEach(() => {
  editor?.['view'].destroy();
  document.body.replaceChildren();
  document.querySelectorAll('[data-role="deck-theme"]').forEach(node => node.remove());
});
function setup(persist: (css: string) => Promise<void>) {
  const host = document.createElement('div'); document.body.appendChild(host);
  editor = new CssEditor(host, persist, src => src);
  return (text: string) => editor['view'].dispatch({ changes: { from: 0, to: editor.getValue().length, insert: text } });
}

describe('theme persistence', () => {
  it('waits for an in-flight save even after its timer was cleared', async () => {
    let release!: () => void;
    const persist = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const change = setup(persist);
    change('body { color: red }');
    const first = editor.flush();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    let finished = false;
    const second = editor.flush().then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(finished).toBe(true);
  });

  it('writes newer CSS after an older in-flight save', async () => {
    let release!: () => void;
    const writes: string[] = [];
    const change = setup(async text => {
      if (writes.length === 0) await new Promise<void>(resolve => { release = resolve; });
      writes.push(text);
    });
    change('old'); const first = editor.flush();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    change('new'); const second = editor.flush();
    expect(writes).toEqual([]);
    release(); await Promise.all([first, second]);
    expect(writes).toEqual(['old', 'new']);
  });

  it('retains a failed write for retry', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined);
    const change = setup(persist);
    change('body { color: red }');
    await expect(editor.flush()).rejects.toThrow('disk full');
    await editor.flush();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith('body { color: red }');
  });
});
