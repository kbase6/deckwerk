import type { LaserPoint, LaserState, PresentationCommand } from '@shared/ipc.js';

/**
 * The presentation laser pointer: a red dot over the slide, shared by the
 * audience window and Speaker View's current-slide preview.
 *
 * The dot's position travels as a fraction of the slide (0–1 on each axis),
 * so a pointer moved over the small preview lands on the same spot of the
 * projected slide whatever the two windows' sizes and letterboxing. Moves are
 * their own small command, at most one per animation frame, so pointing never
 * re-renders either view. While the pointer is on, the surface swallows
 * clicks: pointing must not advance the slide or press a button inside a page.
 */

export function slidePoint(rect: DOMRect | undefined, x: number, y: number): LaserPoint | null {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const point = { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
  return validLaserPoint(point) ? point : null;
}

export function validLaserPoint(point: unknown): point is LaserPoint {
  if (point === null || typeof point !== 'object') return false;
  const { x, y } = point as LaserPoint;
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

export interface LaserContext {
  slideId: string | undefined;
  step: number | undefined;
}

export interface LaserPointer {
  refresh(): void;
  setState(state: LaserState): void;
  destroy(): void;
}

export function createLaserPointer(options: {
  /** The element holding the `.stage` the dot is drawn over. */
  host: HTMLElement;
  /** Which slide and build step is showing, so a stale move is dropped. */
  getContext: () => LaserContext;
  onCommand: (command: PresentationCommand) => void;
  /** Speaker View's toggle button, kept pressed while the pointer is on. */
  button?: HTMLButtonElement;
}): LaserPointer {
  const { host, getContext, onCommand, button } = options;
  const style = document.createElement('style');
  style.textContent = `
    .deckwerk-laser-surface { position: absolute; inset: 0; z-index: 2147483646; overflow: hidden; cursor: none; touch-action: none; outline: none; }
    .deckwerk-laser-surface[hidden], .deckwerk-laser-dot[hidden] { display: none; }
    .deckwerk-laser-dot { position: absolute; box-sizing: border-box; border: 2px solid white; border-radius: 50%; background: #ff243e; box-shadow: 0 0 0 1px #540016, 0 0 9px 3px #ff243e99; transform: translate(-50%, -50%); pointer-events: none; }
  `;
  document.head.appendChild(style);
  const previousPosition = host.style.position;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const surface = document.createElement('div');
  surface.className = 'deckwerk-laser-surface';
  surface.setAttribute('aria-hidden', 'true');
  surface.tabIndex = -1;
  const dot = document.createElement('div');
  dot.className = 'deckwerk-laser-dot';
  surface.appendChild(dot);

  let state: LaserState = { enabled: false, point: null, blanked: false };
  let context = getContext();
  let frame = 0;
  let pending: PresentationCommand | null = null;
  let pointingHere = false;
  const events = new AbortController();
  const listen = <E extends Event>(target: EventTarget, name: string, fn: (event: E) => void): void => (
    target.addEventListener(name, fn as EventListener, { signal: events.signal })
  );
  const stageRect = (): DOMRect | undefined => host.querySelector(':scope > .stage')?.getBoundingClientRect();
  const cancel = (): void => {
    cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
  };

  function refresh(): void {
    // The host's owner may replace its children; put the surface back on top.
    if (surface.parentNode !== host) host.appendChild(surface);
    surface.hidden = !state.enabled;
    dot.hidden = !state.enabled || state.blanked || !validLaserPoint(state.point);
    if (button) {
      button.setAttribute('aria-pressed', String(state.enabled));
      button.textContent = state.enabled ? 'Laser pointer: On' : 'Laser pointer';
    }
    if (dot.hidden || !state.point) return;
    const rect = stageRect();
    if (!rect) {
      dot.hidden = true;
      return;
    }
    const bounds = host.getBoundingClientRect();
    dot.style.left = `${rect.left - bounds.left + state.point.x * rect.width}px`;
    dot.style.top = `${rect.top - bounds.top + state.point.y * rect.height}px`;
    dot.style.width = dot.style.height = `${Math.max(8, rect.width * 0.0075)}px`;
  }

  function hide(): void {
    cancel();
    if (!pointingHere) return;
    pointingHere = false;
    dot.hidden = true;
    onCommand({ type: 'laserMove', ...getContext(), point: null });
  }

  listen<PointerEvent>(surface, 'pointermove', (event) => {
    if (!state.enabled || state.blanked) return;
    const point = slidePoint(stageRect(), event.clientX, event.clientY);
    surface.style.cursor = point ? 'none' : 'default';
    pointingHere = true;
    pending = { type: 'laserMove', ...getContext(), point };
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        const command = pending;
        pending = null;
        if (command) onCommand(command);
      });
    }
  });
  listen(surface, 'pointerleave', hide);
  listen(surface, 'pointercancel', hide);
  listen(window, 'blur', hide);
  listen(window, 'pagehide', hide);
  for (const name of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'] as const) {
    listen(surface, name, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (name === 'pointerdown') surface.focus({ preventScroll: true });
    });
  }
  listen<KeyboardEvent>(window, 'keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (
      event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey
      || target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')
    ) return;
    if (event.key.toLowerCase() !== 'l') return;
    event.preventDefault();
    onCommand({ type: 'toggleLaser' });
  });
  if (button) listen(button, 'click', () => onCommand({ type: 'toggleLaser' }));
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh);
  resize?.observe(host);
  refresh();

  return {
    refresh,
    setState(next) {
      const nextContext = getContext();
      if (
        !next.enabled || next.blanked
        || nextContext.slideId !== context.slideId || nextContext.step !== context.step
      ) {
        cancel();
        pointingHere = false;
      }
      context = nextContext;
      state = next;
      refresh();
    },
    destroy() {
      cancel();
      events.abort();
      resize?.disconnect();
      surface.remove();
      style.remove();
      host.style.position = previousPosition;
    },
  };
}
