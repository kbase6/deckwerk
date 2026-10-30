import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { applicationMenuTemplate } from '../src/main/appMenu.js';
import type { EditorAppearance } from '../src/shared/ipc.js';

function roles(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...(Array.isArray(item.submenu) ? roles(item.submenu) : []),
  ]);
}

function menu(name: string, items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const found = items.find((item) => item.label === name);
  if (!Array.isArray(found?.submenu)) throw new Error(`no ${name} menu`);
  return found.submenu;
}

describe('application menu', () => {
  for (const platform of ['darwin', 'win32', 'linux'] as const) {
    it(`keeps every Edit role text fields rely on (${platform})`, () => {
      const edit = roles(menu('Edit', applicationMenuTemplate({
        platform, packaged: true, setEditorAppearance: () => {},
      })));
      expect(edit).toEqual(expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']));
      if (platform === 'darwin') expect(edit).toContain('pasteAndMatchStyle');
    });

    it(`offers no Reload or DevTools in the shipped app (${platform})`, () => {
      const shipped = roles(applicationMenuTemplate({ platform, packaged: true, setEditorAppearance: () => {} }));
      for (const role of ['reload', 'forceReload', 'toggleDevTools', 'viewMenu']) {
        expect(shipped).not.toContain(role);
      }
      // Development builds keep them.
      const dev = roles(applicationMenuTemplate({ platform, packaged: false, setEditorAppearance: () => {} }));
      expect(dev).toEqual(expect.arrayContaining(['reload', 'toggleDevTools']));
    });
  }

  it('sets the editor appearance from View › Editor appearance', () => {
    const chosen: EditorAppearance[] = [];
    const template = applicationMenuTemplate({
      platform: 'darwin', packaged: true, setEditorAppearance: (value) => chosen.push(value),
    });
    const options = menu('Editor appearance', menu('View', template));
    expect(options.map((item) => item.label)).toEqual(['Match system', 'Light', 'Dark']);
    for (const item of options) (item.click as () => void)();
    expect(chosen).toEqual(['system', 'light', 'dark']);
  });
});
