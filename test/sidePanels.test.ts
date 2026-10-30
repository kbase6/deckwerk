// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SIDE_PANELS, buildSidePanelTabs } from '../src/renderer/editor/sidePanels.js';

describe('the side panel tabs', () => {
  it('name each panel in plain words, explain it in a tooltip and open it on click', () => {
    const host = document.createElement('nav');
    const shown: string[] = [];
    buildSidePanelTabs(host, SIDE_PANELS, (id) => shown.push(id));
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Format', 'Design', 'Animations', 'History']);
    expect(buttons.map((b) => b.dataset.panel)).toEqual(['inspector', 'themePanel', 'timeline', 'history']);
    expect(buttons.filter((b) => !b.title).map((b) => b.textContent)).toEqual([]);
    buttons[2].click();
    expect(shown).toEqual(['timeline']);
  });
});
