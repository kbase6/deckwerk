import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { electronBinary, eventually } from './support/browserSession.js';
import { launchDesktopEditor, type DesktopEditor } from './support/desktopEditorSession.js';

/**
 * An edit waits up to 800 ms for autosave. Leaving the page inside that
 * window — a reload, or closing the editor — must write it rather than drop
 * it with the timer. Reload is what CDP can drive; close runs the same
 * `beforeunload`.
 */
const TEXT_ID = 'unload-save-text';

let desktop: DesktopEditor | null = null;

afterAll(async () => {
  await desktop?.close();
  desktop = null;
});

describe.skipIf(!electronBinary)('leaving the editor', () => {
  it('saves an edit still waiting for autosave', { timeout: 120_000 }, async () => {
    desktop = await launchDesktopEditor(TEXT_ID, '<p>nudge me</p>');
    const { cdp, deckDir } = desktop;
    const xOnDisk = async () => {
      const deck = JSON.parse(await readFile(join(deckDir, 'deck.json'), 'utf8'));
      return deck.slides[0].elements.find((el: { id: string }) => el.id === TEXT_ID).x as number;
    };
    expect(await xOnDisk()).toBe(140);

    await cdp.click(`#canvas [data-element-id="${TEXT_ID}"]`, 'the text box');
    for (let i = 0; i < 5; i++) await cdp.key('ArrowRight', 39);
    // Soundness: the reload has to land inside the autosave delay, or this
    // passes without testing anything.
    expect(await xOnDisk(), 'autosave already wrote the nudge').toBe(140);

    const before = await cdp.evaluate<number>('performance.timeOrigin');
    await cdp.call('Page.reload');
    await eventually(
      () => cdp.evaluate<boolean>(`performance.timeOrigin !== ${before}
        && Boolean(document.querySelector('#canvas [data-element-id="${TEXT_ID}"]'))`),
      'the editor did not come back after the reload',
    );
    await eventually(xOnDisk, 'the nudge made just before the reload never reached deck.json',
      (x) => x === 145, 5_000);
  });
});
