/**
 * The side panel's tabs, in order. The desktop editor shows these and the
 * collab client adds its Chat tab after them; both build from this one list
 * so the names and tooltips cannot drift apart. `id` is the panel element's
 * id (and the tab's `data-panel`), which tests and code address it by.
 */
export interface SidePanel {
  readonly id: string;
  readonly label: string;
  readonly title: string;
}

export const SIDE_PANELS: readonly SidePanel[] = [
  { id: 'inspector', label: 'Format', title: 'Settings for the selected object or slide' },
  { id: 'themePanel', label: 'Design', title: 'Theme and layouts for the whole deck' },
  { id: 'timeline', label: 'Animations', title: 'Build animations on this slide' },
  { id: 'history', label: 'History', title: 'Earlier versions of this deck' },
];

/** Fill `host` with one tab button per panel; clicking one calls `show(id)`. */
export function buildSidePanelTabs(
  host: HTMLElement,
  panels: readonly SidePanel[],
  show: (id: string) => void,
): void {
  host.replaceChildren();
  for (const panel of panels) {
    const b = document.createElement('button');
    b.textContent = panel.label;
    b.title = panel.title;
    b.dataset.panel = panel.id;
    b.addEventListener('click', () => show(panel.id));
    host.appendChild(b);
  }
}
