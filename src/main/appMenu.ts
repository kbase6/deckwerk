import type { MenuItemConstructorOptions } from 'electron';
import type { EditorAppearance } from '@shared/ipc.js';

/**
 * The application menu. Without one, Electron installs its default, whose
 * View menu offers Reload, Force Reload and Developer Tools in the shipped
 * app: a stray Cmd+R threw away the undo history, any open text edit and the
 * edits still waiting for autosave.
 *
 * Everything else matches the default, role for role. The Edit roles in
 * particular are how copy, paste, undo and select all reach a focused text
 * field from the keyboard (on macOS the menu owns those accelerators), so
 * every one of them is declared again here; leaving one out silently breaks
 * that command in every text box.
 */
export function applicationMenuTemplate(options: {
  platform: NodeJS.Platform;
  packaged: boolean;
  setEditorAppearance: (appearance: EditorAppearance) => void;
}): MenuItemConstructorOptions[] {
  const mac = options.platform === 'darwin';
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  // The same three choices, in the same words, as Appearance in the DeckWerk menu.
  const appearance = (label: string, value: EditorAppearance): MenuItemConstructorOptions => ({
    label,
    click: () => options.setEditorAppearance(value),
  });
  return [
    ...(mac ? [{ role: 'appMenu' } as const] : []),
    { role: 'fileMenu' },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        separator,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(mac
          ? [
            { role: 'pasteAndMatchStyle' },
            { role: 'delete' },
            { role: 'selectAll' },
            separator,
            {
              label: 'Substitutions',
              submenu: [
                { role: 'showSubstitutions' },
                separator,
                { role: 'toggleSmartQuotes' },
                { role: 'toggleSmartDashes' },
                { role: 'toggleTextReplacement' },
              ],
            },
            {
              label: 'Speech',
              submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
            },
          ] satisfies MenuItemConstructorOptions[]
          : [{ role: 'delete' }, separator, { role: 'selectAll' }] satisfies MenuItemConstructorOptions[]),
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Editor appearance',
          submenu: [
            appearance('Match system', 'system'),
            appearance('Light', 'light'),
            appearance('Dark', 'dark'),
          ],
        },
        separator,
        // Development keeps them; nobody presenting from the shipped app needs either.
        ...(options.packaged
          ? []
          : [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, separator] satisfies MenuItemConstructorOptions[]),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        separator,
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
}
