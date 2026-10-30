import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { electronBinary, eventually, wait } from './support/browserSession.js';
import { launchDesktopEditor, type DesktopEditor } from './support/desktopEditorSession.js';

/**
 * A theme edit in the Design tab is a draft until Done. Escape, a click on a
 * slide in the rail, and another sidebar tab used to throw a changed draft
 * away without a word, and a tab switch left the draft's preview lying over
 * the slide. Checked in the real desktop app with real mouse and keyboard
 * input: a changed draft is asked about ("Discard theme changes?") at each
 * of those doors, and whichever way the draft ends, no preview is left on
 * the canvas.
 */

const TEXT = 'draft-text';
const DESIGN_TAB = '#side-tabs button[data-panel="themePanel"]';
const PROPS_TAB = '#side-tabs button[data-panel="inspector"]';
const EDIT_THEME = '#themePanel .theme-edit-button';
const TITLE_SIZE = '#themePanel .theme-role-size input';

let editor: DesktopEditor | null = null;

afterEach(async () => {
  await editor?.close();
  editor = null;
});

describe.skipIf(!electronBinary)('a theme draft (desktop app)', () => {
  it('asks before Escape, a rail click or another tab discards it, and leaves no preview behind', {
    timeout: 120_000,
  }, async () => {
    editor = await launchDesktopEditor(TEXT, '<p>Draft text</p>');
    const { cdp } = editor;
    const state = () => cdp.evaluate<{
      editing: boolean;
      editDisabled: boolean;
      overlay: boolean;
      draftCss: boolean;
      panel: string;
      dialog: string | null;
      slides: number;
    }>(`(() => ({
      editing: document.querySelector('#themePanel .theme-inline-editor')?.hidden === false,
      editDisabled: document.querySelector(${JSON.stringify(EDIT_THEME)}).disabled,
      overlay: Boolean(document.querySelector('#canvas .design-slide-preview, #canvas .design-slide-preview-banner')),
      draftCss: Boolean(document.querySelector('style[data-design-theme-preview]')?.textContent),
      panel: document.querySelector('#side-tabs button.active')?.dataset.panel ?? '',
      dialog: document.querySelector('.confirm-dialog h2')?.textContent ?? null,
      slides: document.querySelectorAll('#rail .rail-item').length,
    }))()`);
    const answer = async (how: 'Escape' | 'Enter'): Promise<void> => {
      await eventually(state, 'no question was asked', (now) => now.dialog === 'Discard theme changes?');
      if (how === 'Escape') await cdp.key('Escape', 27);
      else await cdp.key('Enter', 13);
      await eventually(state, `${how} left the question open`, (now) => now.dialog === null);
    };
    const startDraft = async (change: boolean): Promise<void> => {
      await cdp.click(DESIGN_TAB, 'the Design tab');
      await cdp.click(EDIT_THEME, 'Edit theme…');
      if (change) await cdp.typeInto(TITLE_SIZE, '100', 'Title size');
      await eventually(state, 'the draft did not preview on the canvas', (now) => (
        now.editing && now.overlay && now.draftCss
      ));
    };
    const onDisk = () => readFile(join(editor!.deckDir, 'deck.json'), 'utf8')
      .then((text) => JSON.stringify(JSON.parse(text).themeStyle ?? null));
    const original = await onDisk();

    // A draft that changed nothing goes quietly with the tab, preview and all.
    await startDraft(false);
    await cdp.click(PROPS_TAB, 'the Props tab');
    await wait(300);
    expect(await state()).toMatchObject({
      editing: false, overlay: false, draftCss: false, panel: 'inspector', dialog: null,
    });

    // A changed one keeps the Design tab until the author says otherwise.
    await startDraft(true);
    await cdp.click(PROPS_TAB, 'the Props tab');
    await answer('Escape');
    expect(await state()).toMatchObject({
      editing: true, overlay: true, draftCss: true, panel: 'themePanel',
    });

    // Escape asks too; keep editing keeps the preview whole.
    await cdp.key('Escape', 27);
    await answer('Escape');
    expect(await state()).toMatchObject({ editing: true, overlay: true, draftCss: true });
    // Pressing "Edit theme…" again is no way out either: Done or Cancel is.
    expect((await state()).editDisabled).toBe(true);

    // So does a click on a slide in the rail; Return discards.
    await cdp.click('#rail .rail-item[data-index="0"]', 'the first slide in the rail');
    await answer('Enter');
    // Return was the question's: it added no slide behind it.
    expect(await state()).toMatchObject({
      editing: false, editDisabled: false, overlay: false, draftCss: false, slides: 1,
    });

    // Discarding on the way to another tab goes there.
    await startDraft(true);
    await cdp.click(PROPS_TAB, 'the Props tab');
    await answer('Enter');
    expect(await state()).toMatchObject({
      editing: false, overlay: false, draftCss: false, panel: 'inspector', slides: 1,
    });
    // Nothing of the discarded drafts reached the deck.
    await wait(1_200);
    expect(await onDisk()).toBe(original);
  });
});
