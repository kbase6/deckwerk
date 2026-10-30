import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { electronBinary, wait } from './support/browserSession.js';
import {
  FAR,
  IMAGE,
  LINE_A,
  LINE_B,
  LIST,
  MOD,
  PARA,
  SHIFT,
  elementSelector,
  startCrossSession,
  type CrossSession,
  type CrossState,
} from './support/crossContextSession.js';
import { sidebarSelectionProbes } from './support/selectionSession.js';
import { editableCircularMask, paintedMediaBox } from '../src/shared/mediaMask.js';
import type { SlideElement } from '../src/shared/deck.js';

/**
 * Cross-context fuzz: a seeded random walk over a slide holding THREE
 * different elements — a paragraph textbox, a list textbox and an image —
 * plus a second slide, all driven by real input. The existing fuzzers each
 * work a single textbox, so every fault that needs two editing contexts, an
 * element selection, or a slide switch is outside their state space. This
 * walk's vocabulary is exactly those moves: clicking the other textbox
 * mid-typing, Escape and empty-canvas clicks mid-edit, shift-click
 * multi-select, marquee drags, rail hops mid-edit, double-clicking the image,
 * Cmd+B mid-word, undo/redo at random points, Backspace with an element
 * selection, Cmd+A in both contexts, Backspace on a multi-slide rail
 * selection (which must ask first; cancelled, or confirmed and undone), and
 * resizing a selected word from the sidebar's Font size field,
 * panning and zooming the view with a plain mouse and the keyboard, the
 * Props tab's line Ends control on one or both lines, its Show slide numbers
 * box, the zoom bar's Gridlines toggle, edge crops, crop pans, Shift-resizes,
 * Text fit, crop resets, typed picture sizes, crop controls, abandoned gestures, Slide colors, theme drafts, and the image Fit strip.
 *
 * After EVERY step five oracles run: the whole-editor invariant set from
 * selectionSession, keystroke routing via per-step nonce strings, an element
 * census, an undo/redo round-trip check, and a page-error trap.
 *
 * Two bugs are already known and must not drown the walk:
 *  - clicking an already-selected box inside a multi-selection enters edit
 *    mode without narrowing the selection ("editing X while the selection is
 *    [X, …]") — counted, not reported;
 *  - formatting+typing coalescing into one undo entry — the round-trip oracle
 *    is deliberately insensitive to undo granularity, so it cannot re-fire.
 *
 * `CROSS_FUZZ_SEEDS`, `CROSS_FUZZ_STEPS` and `CROSS_FUZZ_TRACE=1` are the
 * knobs a failure needs.
 */
const DECK_ID = 'cross-context-fuzz';
const SEEDS = Number.parseInt(process.env.CROSS_FUZZ_SEEDS ?? '', 10) || 8;
const STEPS = Number.parseInt(process.env.CROSS_FUZZ_STEPS ?? '', 10) || 15;
const TRACE = process.env.CROSS_FUZZ_TRACE === '1';

let session: CrossSession;
let close: (() => Promise<void>) | null = null;

beforeAll(async () => {
  if (!electronBinary) return;
  const started = await startCrossSession(DECK_ID, 'Cross Context Fuzz');
  session = started.session;
  close = started.close;
}, 180_000);

afterAll(async () => {
  await close?.();
  close = null;
});

/** A small, reproducible pseudo-random source. */
function random(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/**
 * Element ids an op legitimately created and then undid within itself — the
 * blank slide a confirmed whole-deck delete leaves. A later redo, in this walk
 * or (the walks share one history) a later one, may bring them back, and that
 * is not undo materialising something new.
 */
const producedIds = new Set<string>();

const pick = <T,>(next: () => number, list: T[]): T =>
  list[Math.floor(next() * list.length)];

/**
 * Typed markers must be unique across the whole run, not just within a step:
 * undo can resurrect state from an earlier seed (the walks share one editor
 * and one history), so a reused marker string would let the routing oracle
 * blame a fresh keystroke for text a previous walk legitimately typed.
 */
let tokenCounter = 0;
/** Decimal, so every marker contains a digit and cannot collide with fixture
 * words ("item two" contains "wo", which a base-36 token once produced). */
const uniqueToken = () => `${tokenCounter++}`;

/**
 * KNOWN BUG #1 (selectionStateBugs.test.ts): a click on an already-selected
 * box inside a multi-selection begins an edit without narrowing the
 * selection. Its invariant signature is "editing X while the selection is
 * [... X ...]"; the same broken state also mislabels focus/caret against the
 * multi-selection, so those two strings are carved out only while the
 * signature itself is present.
 */
function splitKnown(problems: string[]): { known: string[]; unknown: string[] } {
  const known: string[] = [];
  const unknown: string[] = [];
  const signature = problems.find((problem) => {
    const match = /^editing (\S+) while the selection is \[(.*)\]$/.exec(problem);
    if (!match) return false;
    const listed = match[2].split(',').map((id) => id.trim());
    return listed.length > 1 && listed.includes(match[1]);
  });
  for (const problem of problems) {
    if (signature && problem === signature) known.push(problem);
    else unknown.push(problem);
  }
  return { known, unknown };
}

/**
 * BUG (new, found by this fuzzer — see the directed repro below): ending a
 * text-edit session that changed nothing leaves `style="outline: none;
 * cursor: text"` on the .text-content (beginTextEdit sets them at
 * canvas.ts:2189, commitTextEdit's no-change branch never clears them), and
 * the app's own render-invariant checker reports the canvas DOM as stale at
 * the next in-place patch. Counted here so it does not drown the walk.
 */
function isKnownStaleEditChrome(error: string): boolean {
  if (!error.includes('[render-invariant]')) return false;
  if (!error.includes('div.text-content')) return false;
  const properties = [...error.matchAll(/style\.([a-z-]+)/g)].map((m) => m[1]);
  return properties.length > 0 && properties.every((property) =>
    ['outline-color', 'outline-style', 'outline-width', 'cursor'].includes(property));
}

/**
 * BUG (new, found by this fuzzer — see the directed repro below): navigating
 * between two structurally identical slides takes render()'s in-place patch
 * path, which never rewrites slide-scoped DOM (data-slide-id stays on the
 * previous slide's value). Counted here so it does not drown the walk.
 */
function isKnownStaleSlideIdentity(error: string): boolean {
  return error.includes('[render-invariant]')
    && error.includes('@data-slide-id')
    && !/style\.[a-z-]+/.test(error);
}

type OpName =
  | 'click' | 'shift-click' | 'double-click text' | 'double-click image then text'
  | 'type nonce' | 'bold mid-word' | 'escape' | 'click empty' | 'marquee'
  | 'rail hop' | 'undo' | 'redo' | 'undo round-trip' | 'delete selection'
  | 'cmd+a' | 'click with stray hover' | 'rail multi-delete' | 'stack key' | 'spelling fix'
  | 'size from sidebar' | 'viewport gesture' | 'line ends' | 'slide numbers' | 'gridlines'
  | 'crop edge drag' | 'shift resize image' | 'reset crop' | 'theme pick' | 'geometry from sidebar'
  | 'crop pan' | 'crop toggle from panel' | 'escape during crop' | 'circle toggle' | 'abandon gesture' | 'text fit' | 'slide colors light/dark' | 'theme draft' | 'set fit';

interface Violation { seed: number; step: number; op: OpName; oracle: string; detail: string }

interface OracleStats {
  invariants: number;
  routing: number;
  census: number;
  undoRoundTrip: number;
  pageErrors: number;
  knownMultiSelectEdit: number;
  knownStaleEditChrome: number;
  knownStaleSlideIdentity: number;
}

describe.skipIf(!electronBinary)('cross-context fuzz over three elements and two slides', () => {
  it(`survives ${SEEDS} seeded walks of ${STEPS} cross-context steps`, {
    timeout: 30 * 60_000,
  }, async () => {
    const violations: Violation[] = [];
    const stats: OracleStats = {
      invariants: 0, routing: 0, census: 0, undoRoundTrip: 0, pageErrors: 0,
      knownMultiSelectEdit: 0, knownStaleEditChrome: 0, knownStaleSlideIdentity: 0,
    };
    const opCounts = new Map<OpName, number>();

    for (let seedIndex = 0; seedIndex < SEEDS; seedIndex++) {
      const seed = 90_2026 + seedIndex * 7919;
      const next = random(seed);
      await session.reset();
      await session.drainPageErrors();
      /** ids ever seen in the deck, slide-qualified — undo may resurrect any. */
      const everKnown = new Set(await session.allElementIds());
      /** what the census expects right now. */
      let expectedIds = [...everKnown];
      const steps: string[] = [];

      for (let step = 0; step < STEPS; step++) {
        const pre = await session.state();
        const op = chooseOp(next, pre);
        opCounts.set(op, (opCounts.get(op) ?? 0) + 1);
        steps.push(op);
        const label = `seed ${seed} step ${step + 1} (${op}) after [${steps.join(' → ')}]`;
        if (TRACE) console.log(label);

        const flag = (oracle: keyof OracleStats, detail: string) => {
          stats[oracle] += 1;
          violations.push({ seed, step: step + 1, op, oracle, detail: `${label}: ${detail}` });
        };

        let censusMode: 'same' | 'resync' | string[] = 'same';
        try {
          censusMode = await performOp(op, next, pre, flag);
        } catch (error) {
          flag('invariants', `the op itself failed: ${(error as Error).message}`);
          break;
        }

        // Oracle 1: the whole-editor invariant set, with the known-bug carve-out.
        const { known, unknown } = splitKnown(await session.problems());
        stats.knownMultiSelectEdit += known.length;
        if (unknown.length > 0) {
          flag('invariants', unknown.join(' | '));
          break; // a broken editor cascades; stop this seed at the first fault
        }

        // Oracle 3: element census — nothing appears or disappears except via
        // an explicit delete, and undo/redo only ever resurrect known ids.
        const ids = await session.allElementIds();
        if (new Set(ids).size !== ids.length) {
          flag('census', `duplicate element ids: [${ids.join(', ')}]`);
          break;
        }
        if (censusMode === 'resync') {
          const foreign = ids.filter((id) => !everKnown.has(id) && !producedIds.has(id));
          if (foreign.length > 0) {
            flag('census', `undo/redo materialised never-seen elements: [${foreign.join(', ')}]`);
            break;
          }
          expectedIds = ids;
        } else {
          const expected = Array.isArray(censusMode) ? censusMode : expectedIds;
          if ([...ids].sort().join('|') !== [...expected].sort().join('|')) {
            flag('census', `elements changed: expected [${expected.join(', ')}] got [${ids.join(', ')}]`);
            break;
          }
          expectedIds = expected;
        }
        for (const id of ids) everKnown.add(id);

        // Oracle 5: nothing on the page blew up.
        const errors = await session.drainPageErrors();
        stats.knownStaleEditChrome += errors.filter(isKnownStaleEditChrome).length;
        stats.knownStaleSlideIdentity += errors.filter(isKnownStaleSlideIdentity).length;
        const realErrors = errors.filter((error) => !isKnownStaleEditChrome(error)
          && !isKnownStaleSlideIdentity(error));
        if (realErrors.length > 0) {
          flag('pageErrors', realErrors.join(' | '));
          break;
        }

      }
    }

    console.log('cross-context fuzz stats:', JSON.stringify({
      seeds: SEEDS,
      steps: STEPS,
      ops: Object.fromEntries(opCounts),
      oracleFirings: stats,
    }, null, 2));

    expect(
      violations,
      violations.map((v) => `[${v.oracle}] ${v.detail}`).join('\n\n'),
    ).toEqual([]);
  });
});

describe.skipIf(!electronBinary)('directed repros minimised from the fuzz walk', () => {
  // BUG (new): ending a text-edit session that changed nothing leaves the
  // edit-session inline styles (`outline: none; cursor: text`) on the
  // .text-content. beginTextEdit writes them (canvas.ts:2189-2190);
  // commitTextEdit removes contenteditable and the .editing class but never
  // these styles, and its no-change branch does not re-render either, so
  // after the session the box permanently shows a text cursor on hover and
  // the app's own render-invariant checker reports "canvas DOM is stale
  // after an in-place patch" at the next patch (here: nudging the box with an
  // arrow key; in the fuzz walk it was an undo). Expected: leaving an
  // unchanged edit restores the node exactly and no render-invariant error
  // fires. Observed: the stale styles persist and the checker fires.
  // Minimised from fuzz seed 941621 step 2 (double-click text → undo).
  it('leaves no stale edit styling after an unchanged edit session', {
    timeout: 120_000,
  }, async () => {
    await session.reset();
    await session.drainPageErrors();
    // A real history entry, so the later undo produces an in-place patch.
    await session.click(PARA);
    await session.key('ArrowRight', 39);
    await wait(200);
    await session.doubleClick(PARA); // enter edit
    await session.key('Escape', 27); // leave without changing anything
    const residue = await session.cdp.evaluate<string>(`(() => {
      const body = document.querySelector('${elementSelector(PARA)} .text-content');
      return body ? body.getAttribute('style') ?? '' : '(missing)';
    })()`);
    // Undoing the move patches the slide in place, which runs the app's own
    // staleness check while nothing is being edited.
    await session.clickEmpty();
    await session.chord('z', 'KeyZ', 90, MOD);
    await wait(300);

    const errors = await session.drainPageErrors();
    expect(
      errors,
      `stale edit chrome after an unchanged edit (inline style left behind: "${residue}")`,
    ).toEqual([]);
  });

  // Fixed: crop mode outlived a slide change. A rail hop while an image was
  // in crop mode left the mode on that image, so the app's own selection
  // checker reported "cropping xc-image, which is not on the current slide",
  // and back on the image's slide the next double-click turned the invisible
  // leftover mode off instead of on. Minimised from fuzz seed 933702 step 14.
  it('ends crop mode when the slide changes', {
    timeout: 120_000,
  }, async () => {
    await session.reset();
    await session.drainPageErrors();
    const masking = () => session.cdp.evaluate<string | null>('window.canvas.maskingElement()');
    await session.doubleClick(IMAGE);
    expect(await masking(), 'double-click enters crop mode').toBe(IMAGE);
    await session.clickRail(1);
    await wait(300);
    expect(await masking(), 'crop mode after leaving the slide').toBeNull();
    expect(await session.drainPageErrors(), 'no selection-invariant report').toEqual([]);
    await session.clickRail(0);
    await session.doubleClick(IMAGE);
    expect(await masking(), 'back on the slide, double-click enters crop mode again').toBe(IMAGE);
  });

  // Fixed: crop mode outlived the selection. Escape deselected the picture
  // and Cmd+A selected everything, but crop mode stayed on with its Props
  // button gone, so the next drag on the picture panned it inside its crop
  // instead of moving the object.
  for (const [how, press] of [
    ['Escape', () => session.key('Escape', 27)],
    ['Cmd+A', () => session.chord('a', 'KeyA', 65, MOD)],
  ] as const) {
    it(`ends crop mode when ${how} moves the selection off the picture`, {
      timeout: 120_000,
    }, async () => {
      await session.reset();
      const masking = () => session.cdp.evaluate<string | null>('window.canvas.maskingElement()');
      await session.doubleClick(IMAGE);
      expect(await masking(), 'double-click enters crop mode').toBe(IMAGE);
      await press();
      await wait(150);
      expect((await session.state()).selection, `${how} moved the selection`).not.toEqual([IMAGE]);
      expect(await masking(), `crop mode after ${how}`).toBeNull();
      expect(await session.problems(), 'the invariant set').toEqual([]);
    });
  }
  // Fixed: Reset crop only dropped the crop, leaving the frame at the cropped
  // window's size, so `contain` shrank the whole picture into that window.
  it('restores the whole picture when a crop is reset', {
    timeout: 120_000,
  }, async () => {
    await session.reset();
    // A suite before this one may have left crop mode on; a click away ends it.
    await session.clickEmpty();
    await session.drainPageErrors();
    const problems: string[] = [];
    // 0.9 drags the west edge inward, so the window is narrower than the picture.
    await resetCrop(() => 0.9, (oracle, detail) => problems.push(`[${oracle}] ${detail}`));
    expect(problems).toEqual([]);
    expect(await session.drainPageErrors()).toEqual([]);
  });
});

describe.skipIf(!electronBinary)('resetting a circular crop', () => {
  it('re-centres the picture without changing the circle window', { timeout: 120_000 }, async () => {
    await session.reset();
    await session.clickEmpty();
    const problems: string[] = [];
    const flag = (oracle: string, detail: string) => problems.push(`[${oracle}] ${detail}`);
    await circleToggle(flag);
    await resetCrop(() => 0.9, flag);
    expect(problems).toEqual([]);
    expect(await session.problems()).toEqual([]);
  });
});

describe.skipIf(!electronBinary)('directed repro: stale slide identity across a rail hop', () => {
  // BUG (new): navigating between two slides whose element lists are
  // structurally identical (here: both emptied by Cmd+A + Backspace) takes
  // the in-place patch path — render() checks sameStructure(renderedSlide,
  // slide) (canvas.ts:529) BEFORE it checks whether the slide index changed,
  // and sameStructure (canvas.ts:4486) compares only the elements, never the
  // slide's own identity or background. The canvas therefore keeps showing
  // the previous slide's DOM: data-slide-id stays stale (the app's own
  // render-invariant checker reports 'canvas has "slide-1", a fresh render
  // gives "slide-2"'), and anything else keyed off the slide node — e.g. a
  // different slide background — would keep the old slide's paint. Expected:
  // a rail hop always shows the target slide's DOM identity. Observed: the
  // slide node still carries the previous slide's data-slide-id. Minimised
  // from fuzz seed 989135 step 16.
  it('shows the target slide identity after hopping between identical slides', {
    timeout: 120_000,
  }, async () => {
    await session.reset();
    await session.drainPageErrors();
    // Empty slide 1 with real input: select every object, delete them.
    await session.chord('a', 'KeyA', 65, MOD);
    await session.key('Backspace', 8);
    // Empty slide 2 the same way. The rail keeps keyboard focus after a rail
    // click, so click the canvas first — otherwise Cmd+A selects slides.
    await session.clickRail(1);
    await session.clickEmpty();
    await session.chord('a', 'KeyA', 65, MOD);
    await session.key('Backspace', 8);
    await session.drainPageErrors();
    // Hop back: two structurally identical (empty) slides.
    await session.clickRail(0);
    await wait(300);

    const identity = await session.cdp.evaluate<{ dom: string; model: string }>(`(() => {
      const state = window.store.get();
      return {
        dom: document.querySelector('.slide-layer .slide')?.getAttribute('data-slide-id')
          ?? '(none)',
        model: state.deck.slides[state.slideIndex]?.id ?? '(none)',
      };
    })()`);
    const errors = (await session.drainPageErrors())
      .filter((error) => !isKnownStaleEditChrome(error));
    expect(
      identity.dom,
      `the canvas still shows ${identity.dom} after navigating to ${identity.model}`
      + (errors.length > 0 ? ` (page errors: ${errors.join(' | ')})` : ''),
    ).toBe(identity.model);
    expect(errors, 'no staleness reported by the render-invariant checker').toEqual([]);
  });
});

describe.skipIf(electronBinary)('cross-context fuzz (skipped)', () => {
  it('needs Electron', () => expect(electronBinary).toBe(''));
});

/** The elements an op can aim at on the current slide, live. */
function targetsOn(pre: CrossState): string[] {
  const known = [PARA, LIST, IMAGE, FAR];
  return pre.elements.filter((id) => known.includes(id));
}

function chooseOp(next: () => number, pre: CrossState): OpName {
  const targets = targetsOn(pre);
  const ops: OpName[] = [];
  const add = (op: OpName, weight: number) => {
    for (let i = 0; i < weight; i++) ops.push(op);
  };
  if (targets.length > 0) {
    add('click', 3);
    add('shift-click', 2);
    add('click with stray hover', 1);
    if (targets.some((id) => id !== IMAGE)) add('double-click text', 3);
  }
  if (pre.slideIndex === 0 && pre.elements.includes(IMAGE)
    && pre.elements.some((id) => id === PARA || id === LIST)) {
    add('double-click image then text', 1);
  }
  if (pre.editing !== null) {
    add('type nonce', 3);
    add('bold mid-word', 2);
    add('click', 2); // click the other box mid-typing, no Escape first
    add('spelling fix', 1);
    add('size from sidebar', 2);
  }
  add('escape', 1);
  add('click empty', 1);
  add('marquee', 1);
  // A redo of a confirmed whole-deck delete can leave one slide to hop to.
  if (pre.slides > 1) add('rail hop', 2);
  add('undo', 2);
  add('redo', 1);
  add('undo round-trip', 1);
  if (pre.editing === null && pre.selection.length > 0) add('delete selection', 2);
  add('cmd+a', 1);
  if (pre.slides > 1) add('rail multi-delete', 1);
  add('stack key', 1);
  add('viewport gesture', 2);
  if (pre.elements.includes(LINE_A) || pre.elements.includes(LINE_B)) add('line ends', 2);
  add('slide numbers', 1);
  add('gridlines', 1);
  add('theme pick', 1);
  if (pre.elements.includes(IMAGE)) {
    add('set fit', 1);
    add('crop edge drag', 2);
    add('shift resize image', 1);
    add('reset crop', 1);
    add('geometry from sidebar', 1);
    add('crop pan', 2);
    add('crop toggle from panel', 2);
    add('escape during crop', 1);
    add('circle toggle', 2);
  }
  add('abandon gesture', 2);
  if (targets.some((id) => id !== IMAGE)) add('text fit', 2);
  add('slide colors light/dark', 1);
  add('theme draft', 1);
  return pick(next, ops);
}

/**
 * Perform one op and run its op-specific oracle (keystroke routing, deletion,
 * round-trip). Returns how the census should treat the step: 'same' (no
 * element change allowed), 'resync' (undo/redo/round-trip may restore any
 * known state), or the explicit id list expected after a delete.
 */
async function performOp(
  op: OpName,
  next: () => number,
  pre: CrossState,
  flag: (oracle: 'routing' | 'undoRoundTrip' | 'census', detail: string) => void,
): Promise<'same' | 'resync' | string[]> {
  const targets = targetsOn(pre);
  switch (op) {
    case 'click':
      await session.click(pick(next, targets));
      return 'same';
    case 'shift-click':
      await session.shiftClick(pick(next, targets));
      return 'same';
    case 'click with stray hover': {
      // A click is not a drag, whatever the window system reports in between:
      // nothing on the slide may have moved.
      const where = `(() => {
        const state = window.store.get();
        return Object.fromEntries(state.deck.slides[state.slideIndex].elements
          .map((element) => [element.id, element.x + ',' + element.y]));
      })()`;
      const before = await session.cdp.evaluate<Record<string, string>>(where);
      await session.clickWithStrayHover(pick(next, targets));
      const after = await session.cdp.evaluate<Record<string, string>>(where);
      for (const [id, at] of Object.entries(before)) {
        if (after[id] !== undefined && after[id] !== at) {
          flag('census', `${id} moved from ${at} to ${after[id]} on a click with a stray hover`);
        }
      }
      return 'same';
    }
    case 'double-click text':
      await session.doubleClick(pick(next, targets.filter((id) => id !== IMAGE)));
      return 'same';
    case 'double-click image then text': {
      await session.doubleClick(IMAGE);
      const boxes = targets.filter((id) => id === PARA || id === LIST);
      await session.doubleClick(pick(next, boxes));
      return 'same';
    }
    case 'type nonce': {
      const nonce = `q${uniqueToken()}z`;
      await session.type(nonce);
      await wait(120);
      await checkRouting(pre, nonce, flag);
      return 'same';
    }
    case 'bold mid-word': {
      const head = `w${uniqueToken()}`;
      const tail = `t${uniqueToken()}x`;
      await session.type(head);
      await session.chord('b', 'KeyB', 66, MOD);
      await session.type(tail);
      await wait(120);
      await checkRouting(pre, head, flag);
      await checkRouting(pre, tail, flag);
      return 'same';
    }
    case 'size from sidebar': {
      // Select a word, resize it from the sidebar's Font size field, and click
      // back into the text. While the field has focus the edit, the selection
      // and its paint survive (the browser's own selection moved into the
      // field, so the editor shows it); back in the text the paint is gone.
      const editing = pre.editing!;
      const probes = sidebarSelectionProbes(session.cdp);
      const length = (await session.textOf(editing)).length;
      if (length > 0) await probes.selectWord(editing, Math.min(6, length - 1));
      const selected = await probes.selectedText();
      await probes.setField('Font size', pick(next, ['36', '44']));
      const after = await session.state();
      if (after.editing !== editing) {
        flag('routing', `sizing from the sidebar ended the edit of ${editing}`
          + ` (now ${after.editing ?? 'nothing'})`);
        return 'same';
      }
      if (selected) {
        const still = await probes.selectedText();
        if (still !== selected) {
          flag('routing', `sizing from the sidebar changed the selection from`
            + ` ${JSON.stringify(selected)} to ${JSON.stringify(still)}`);
        }
        const painted = await probes.paintedSelection();
        if (painted.join('') !== selected) {
          flag('routing', `the selection ${JSON.stringify(selected)} shows as`
            + ` ${JSON.stringify(painted)} while the Font size field has focus`);
        }
      }
      if (length > 0) {
        await session.cdp.clickTextAtOffset(`${elementSelector(editing)} .text-content`, 0,
          `the start of ${editing}`);
        await wait(80);
      } else {
        await session.click(editing);
      }
      const back = await session.state();
      if (back.editing !== editing || back.focus !== `inside ${editing}`) {
        flag('routing', `clicking back into ${editing} from the sidebar left editing`
          + ` ${back.editing ?? 'nothing'} with focus ${back.focus}`);
      }
      const kept = await probes.keptHighlight();
      if (kept.length > 0) {
        flag('routing', `the kept selection ${JSON.stringify(kept)} survived the click back`
          + ` into ${editing}`);
      }
      return 'same';
    }
    case 'escape':
      await session.key('Escape', 27);
      return 'same';
    case 'click empty':
      await session.clickEmpty();
      return 'same';
    case 'marquee': {
      const layer = await session.boxOf('.slide-layer');
      const sweepTo = pre.slideIndex === 0
        ? pick(next, [PARA, LIST, IMAGE].filter((id) => pre.elements.includes(id)))
        : pre.elements.includes(FAR) ? FAR : null;
      const end = sweepTo
        ? await session.boxOf(elementSelector(sweepTo))
        : { left: layer.left, top: layer.top, width: 10, height: 10 };
      await session.dragPath([
        { x: layer.left + layer.width * 0.55, y: layer.top + layer.height * 0.94 },
        { x: layer.left + layer.width * 0.4, y: layer.top + layer.height * 0.6 },
        { x: end.left + end.width / 2, y: end.top + end.height / 2 },
      ]);
      return 'same';
    }
    case 'rail hop': {
      const other = pre.slideIndex === 0 ? 1 : 0;
      await session.clickRail(other);
      if (next() < 0.6) await session.clickRail(pre.slideIndex);
      return 'same';
    }
    case 'undo':
      await session.chord('z', 'KeyZ', 90, MOD);
      await wait(250);
      return 'resync';
    case 'redo':
      await session.chord('z', 'KeyZ', 90, MOD | 8);
      await wait(250);
      return 'resync';
    case 'undo round-trip': {
      // Oracle 4: undo then redo must return to the pre-undo committed state.
      // This is deliberately insensitive to undo granularity, so the known
      // formatting+typing coalescing bug cannot re-fire here.
      if (pre.editing !== null) {
        await session.key('Escape', 27);
      }
      await wait(900); // let any typing run seal
      const before = await session.deckSnapshot();
      await session.chord('z', 'KeyZ', 90, MOD);
      await wait(250);
      await session.chord('z', 'KeyZ', 90, MOD | 8);
      await wait(400);
      let after = await session.deckSnapshot();
      for (let poll = 0; poll < 10 && after !== before; poll++) {
        await wait(200);
        after = await session.deckSnapshot();
      }
      if (after !== before) {
        flag('undoRoundTrip', `undo+redo did not restore the committed deck;`
          + ` diff: ${firstDiff(before, after)}`);
      }
      return 'resync';
    }
    case 'delete selection': {
      const texts = await session.allTexts();
      const survivors = pre.elements.filter((id) => !pre.selection.includes(id));
      const useForwardDelete = next() < 0.4;
      if (useForwardDelete) await session.key('Delete', 46);
      else await session.key('Backspace', 8);
      await wait(150);
      // Element selection + Backspace/Delete must delete the elements, and
      // must never eat text out of a box that was not focused.
      const post = await session.state();
      const remaining = post.elements;
      for (const id of pre.selection) {
        if (remaining.includes(id)) {
          flag('census', `selected ${id} survived ${useForwardDelete ? 'Delete' : 'Backspace'}`);
        }
      }
      const afterTexts = await session.allTexts();
      for (const id of survivors) {
        if (afterTexts[id] !== undefined && texts[id] !== undefined
          && afterTexts[id] !== texts[id]) {
          flag('routing', `deleting the selection changed text in unselected ${id}: `
            + `"${texts[id]}" -> "${afterTexts[id]}"`);
        }
      }
      const expected = (await session.allElementIds());
      return expected;
    }
    case 'stack key': {
      // [ ] restack the selection, but inside a text edit they are text: the
      // character goes into the box and nothing moves in the stack.
      const stacking = () => session.cdp.evaluate<string>(`JSON.stringify(window.store.slide.elements.map((e) => [e.id, e.z]))`);
      const before = await stacking();
      await session.stackKey(next() < 0.5, next() < 0.5);
      if (pre.editing !== null) {
        const after = await stacking();
        if (after !== before) flag('routing', `a bracket typed into ${pre.editing} restacked the slide: ${before} -> ${after}`);
      }
      return 'same';
    }
    case 'cmd+a':
      await session.chord('a', 'KeyA', 65, MOD, pre.editing !== null ? ['selectAll'] : undefined);
      return 'same';
    case 'viewport gesture':
      await viewportGesture(next, pre, flag);
      return 'same';
    case 'line ends':
      await lineEnds(next, pre, flag);
      return 'same';
    case 'slide numbers':
      await slideNumbers(flag);
      return 'same';
    case 'gridlines':
      await gridlines(flag);
      return 'same';
    case 'theme pick':
      await themePick(next, flag);
      return 'same';
    case 'slide colors light/dark':
      await slideColors(next, flag);
      return 'same';
    case 'theme draft':
      await themeDraft(next, pre, flag);
      return 'same';
    case 'set fit':
      await setFit(next, flag);
      return 'same';
    case 'crop edge drag':
      await cropEdgeDrag(next, flag);
      return 'same';
    case 'shift resize image':
      await shiftResizeImage(next, flag);
      return 'same';
    case 'reset crop':
      await resetCrop(next, flag);
      return 'same';
    case 'geometry from sidebar':
      await geometryFromSidebar(next, flag);
      return 'same';
    case 'crop pan':
      await cropPan(next, flag);
      return 'same';
    case 'crop toggle from panel':
      await cropToggleFromPanel(flag);
      return 'same';
    case 'escape during crop':
      await escapeDuringCrop(next, flag);
      return 'same';
    case 'circle toggle':
      await circleToggle(flag);
      return 'same';
    case 'abandon gesture':
      return abandonGesture(next, pre, flag);
    case 'text fit':
      await textFit(next, pre, flag);
      return 'same';
    case 'rail multi-delete': {
      // Select both slides in the rail with real clicks, then a deletion key.
      // More than one slide must never go without a confirmation: Escape
      // keeps everything (and gives the rail its focus back); Return deletes,
      // and one undo restores exactly what was there.
      const snapshot = () => session.cdp.evaluate<string>(
        `JSON.stringify(window.store.get().deck.slides.map((slide) => [slide.id, slide.elements.map((el) => el.id)]))`);
      const dialogOpen = () => session.cdp.evaluate<boolean>(
        `Boolean(document.querySelector('.workflow-dialog[role="alertdialog"]'))`);
      await session.clickRail(pre.slideIndex);
      await session.cdp.clickModified(`.rail-item[data-index="${pre.slideIndex === 0 ? 1 : 0}"]`,
        SHIFT, 'shift-click the other rail slide');
      await wait(120);
      const before = await snapshot();
      const selected = await session.cdp.evaluate<number>('window.store.get().slideSelection.size');
      if (selected < 2) {
        flag('routing', `shift-clicking the other rail slide selected ${selected} slide(s)`);
        return 'same';
      }
      if (next() < 0.5) await session.key('Backspace', 8);
      else await session.key('Delete', 46);
      await wait(150);
      if (await snapshot() !== before) {
        flag('census', 'a deletion key on a multi-slide rail selection deleted without asking');
        return 'resync';
      }
      if (!await dialogOpen()) {
        flag('census', 'a deletion key on a multi-slide rail selection asked nothing');
        return 'same';
      }
      if (next() < 0.7) {
        await session.key('Escape', 27);
        await wait(120);
        if (await dialogOpen()) flag('routing', 'Escape left the slide-delete confirmation open');
        if (!await session.cdp.evaluate<boolean>(
          `document.getElementById('rail')?.contains(document.activeElement) === true`)) {
          flag('routing', 'cancelling the slide-delete confirmation did not return focus to the rail');
        }
        if (await snapshot() !== before) flag('census', 'cancelling the confirmation still deleted slides');
        return 'same';
      }
      await session.key('Enter', 13);
      await wait(250);
      const slides = await session.cdp.evaluate<number>('window.store.get().deck.slides.length');
      if (slides !== 1) flag('census', `confirming deletion of the whole deck left ${slides} slides, not one blank slide`);
      for (const id of await session.allElementIds()) producedIds.add(id);
      await session.chord('z', 'KeyZ', 90, MOD);
      await wait(300);
      if (await snapshot() !== before) {
        flag('undoRoundTrip', `undo after the confirmed slide deletion did not restore the deck: ${await snapshot()}`);
      }
      return 'same';
    }
    case 'spelling fix': {
      // Type a misspelling, wait for Harper's mark, and take the first
      // suggestion from the right-click menu: a programmatic edit inside the
      // live session that must land in the box being edited, as its own step.
      await session.type(' wrold ');
      let point: { x: number; y: number } | null = null;
      const deadline = Date.now() + 20_000;
      while (!point && Date.now() < deadline) {
        point = await session.cdp.evaluate<{ x: number; y: number } | null>(`(() => {
          const h = CSS.highlights.get('deckwerk-spelling');
          const r = h && [...h].find((range) => range.toString() === 'wrold');
          if (!r) return null;
          const box = r.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        })()`);
        if (!point) await wait(100);
      }
      if (!point) {
        flag('routing', 'typed "wrold" while editing but Harper never marked it');
        return 'same';
      }
      await session.cdp.rightClickAt(point.x, point.y);
      await session.cdp.clickByText('#ctx-menu button', 'world');
      await wait(120);
      const texts = await session.allTexts();
      if (pre.editing && !texts[pre.editing]?.includes('world')) {
        flag('routing', `the spelling fix did not land in ${pre.editing}: "${texts[pre.editing]}"`);
      }
      return 'same';
    }
  }
}

/**
 * Oracle 2: the typed marker must land in exactly the element the UI showed
 * as editing when the keystrokes were sent, and nowhere else.
 */
async function checkRouting(
  pre: CrossState,
  nonce: string,
  flag: (oracle: 'routing', detail: string) => void,
): Promise<void> {
  const texts = await session.allTexts();
  const landed = Object.entries(texts)
    .filter(([, text]) => text.includes(nonce))
    .map(([id]) => id);
  const editing = pre.editing;
  if (editing === null) return;
  if (!landed.includes(editing)) {
    flag('routing', `typed "${nonce}" while the UI showed editing ${editing}, `
      + `but it landed in [${landed.join(', ') || 'nowhere'}]`);
  }
  const strays = landed.filter((id) => id !== editing);
  if (strays.length > 0) {
    flag('routing', `typed "${nonce}" into ${editing} but it also appears in `
      + `[${strays.join(', ')}]`);
  }
}

/**
 * Pan or zoom the view the way a plain mouse and the keyboard do it — a
 * Ctrl/Cmd wheel notch, Shift and the wheel, a middle-button drag, Space and
 * a drag, Ctrl/Cmd + or - — over a random object or the empty slide, mid-edit
 * or not. None of it is an edit: every object stays where it was, and the
 * selection, the text edit and the slide are as they were. Nor may the page
 * itself zoom. Ctrl/Cmd+0 then fits the view again, so later ops aim at an
 * unpanned slide.
 */
async function viewportGesture(
  next: () => number,
  pre: CrossState,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  const snapshot = () => cdp.evaluate<string>(`(() => {
    const state = window.store.get();
    return JSON.stringify({
      geometry: state.deck.slides.map((slide) => slide.elements.map((element) =>
        [element.id, element.x, element.y, element.w, element.h, element.rot])),
      slide: state.slideIndex,
      selection: [...state.selection].sort(),
      editing: window.canvas.editingElementId(),
    });
  })()`);
  const before = await snapshot();
  const ratio = await cdp.evaluate<number>('window.devicePixelRatio');
  const targets = targetsOn(pre);
  const aim = targets.length > 0 && next() < 0.7
    ? await session.boxOf(elementSelector(pick(next, targets)))
    : await session.boxOf('.slide-layer');
  const x = aim.left + aim.width * (0.2 + 0.6 * next());
  const y = aim.top + aim.height * (0.2 + 0.6 * next());
  const mouse = (type: string, at: { x: number; y: number }, button: string, buttons: number) =>
    cdp.call('Input.dispatchMouseEvent', {
      type, x: at.x, y: at.y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  const drag = async (button: 'left' | 'middle', buttons: number) => {
    const dx = (next() - 0.5) * 300;
    const dy = (next() - 0.5) * 200;
    await mouse('mouseMoved', { x, y }, 'none', 0);
    await mouse('mousePressed', { x, y }, button, buttons);
    for (let i = 1; i <= 4; i++) {
      await mouse('mouseMoved', { x: x + (dx * i) / 4, y: y + (dy * i) / 4 }, button, buttons);
      await wait(16);
    }
    await mouse('mouseReleased', { x: x + dx, y: y + dy }, button, 0);
  };
  // Space pans only from the canvas or from nothing in particular; with the
  // rail or a field focused, it is theirs, and a Space drag would be a plain
  // drag. Mid-edit, Space is a typed space. A focused control inside the
  // canvas (the zoom bar's buttons, after a Gridlines click) keeps it too.
  const spaceIsFree = pre.editing === null && await cdp.evaluate<boolean>(`(() => {
    const focus = document.activeElement;
    if (focus && focus.closest('input, textarea, select, button')) return false;
    return !focus || focus === document.body || Boolean(focus.closest('#canvas'));
  })()`);
  const gestures = ['notch', 'shift wheel', 'middle drag', 'zoom keys', ...(spaceIsFree ? ['space drag'] : [])];
  const gesture = pick(next, gestures);
  switch (gesture) {
    case 'notch':
      await cdp.call('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x, y, deltaX: 0, deltaY: next() < 0.5 ? -120 : 100, modifiers: MOD,
      });
      break;
    case 'shift wheel':
      await cdp.call('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x, y, deltaX: 0, deltaY: (next() - 0.5) * 240, modifiers: SHIFT,
      });
      break;
    case 'middle drag':
      await drag('middle', 4);
      break;
    case 'zoom keys':
      if (next() < 0.5) await session.chord('=', 'Equal', 187, MOD);
      else await session.chord('-', 'Minus', 189, MOD);
      break;
    case 'space drag': {
      const space = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 };
      await cdp.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...space });
      await cdp.call('Input.dispatchKeyEvent', { type: 'char', text: ' ', unmodifiedText: ' ', ...space });
      await drag('left', 1);
      await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...space });
      break;
    }
  }
  await wait(120);
  const after = await snapshot();
  if (after !== before) {
    flag('census', `${gesture} changed the deck or the editing state; diff: ${firstDiff(before, after)}`);
  }
  await session.chord('0', 'Digit0', 48, MOD);
  const view = await cdp.evaluate<{ zoom: string; ratio: number }>(`({
    zoom: document.querySelector('#canvas .zoom-value').value,
    ratio: window.devicePixelRatio,
  })`);
  if (view.ratio !== ratio) flag('routing', `${gesture} zoomed the page itself: ${ratio} -> ${view.ratio}`);
  if (view.zoom !== '100%') flag('routing', `Ctrl/Cmd+0 after ${gesture} left the canvas at ${view.zoom}`);
}

/** A real click on the visible node a page-side finder returns, or false if there is none. */
async function clickFound(finder: string, label: string): Promise<boolean> {
  const handle = `xc-click-${uniqueToken()}`;
  const found = await session.cdp.evaluate<boolean>(`(() => {
    const node = (${finder})();
    if (!node) return false;
    node.id = ${JSON.stringify(handle)};
    return true;
  })()`);
  if (found) await session.cdp.click(`#${handle}`, label);
  return found;
}

/**
 * Select one line or both with real clicks and set their ends from the Props
 * tab's Ends control. Exactly the selected lines take the choice, their svg
 * draws it, the control shows it, and nothing else on the slide changes.
 */
async function lineEnds(
  next: () => number,
  pre: CrossState,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  const lines = [LINE_A, LINE_B].filter((id) => pre.elements.includes(id));
  const chosen = lines.length > 1 && next() < 0.5 ? lines : [pick(next, lines)];
  const value = pick(next, ['butt', 'round']);
  await session.clickEmpty();
  await session.click(chosen[0]);
  if (chosen.length > 1) await session.shiftClick(chosen[1]);
  const selected = (await session.state()).selection;
  if ([...selected].sort().join() !== [...chosen].sort().join()) {
    flag('routing', `clicking [${chosen.join(', ')}] selected [${selected.join(', ')}]`);
    return;
  }
  const others = () => cdp.evaluate<string>(`JSON.stringify(window.store.slide.elements
    .filter((e) => !${JSON.stringify(chosen)}.includes(e.id)))`);
  const before = await others();
  const clicked = await clickFound(`() => [...document.querySelectorAll('.editor-inspector .field-segmented')]
    .find((field) => field.querySelector('span')?.textContent === 'Ends' && field.getClientRects().length > 0)
    ?.querySelector('.segment-button[data-value="${value}"]')`, `Ends: ${value}`);
  if (!clicked) {
    flag('routing', `the Props tab shows no Ends control for [${chosen.join(', ')}]`);
    return;
  }
  await wait(120);
  if (TRACE) console.log(`  Ends: ${value} on [${chosen.join(', ')}], editing was ${pre.editing}`);
  const after = await cdp.evaluate<{
    selection: string[];
    caps: Record<string, { stored: string | null; drawn: string | null }>;
    pressed: string | null;
  }>(`(() => {
    const caps = {};
    for (const id of ${JSON.stringify(chosen)}) {
      const el = window.store.slide.elements.find((e) => e.id === id);
      const stroke = document.querySelector('.slide-layer [data-element-id="' + id + '"] svg :is(line, path):not(.arrowhead)');
      // Unset ends are the inspector's own default (round for a curve, flat
      // for a straight line), and an svg stroke without the attribute is flat:
      // choosing the value already shown is a no-op that writes nothing.
      caps[id] = {
        stored: el ? el.style['stroke-linecap'] ?? (el.control ? 'round' : 'butt') : null,
        drawn: stroke ? stroke.getAttribute('stroke-linecap') ?? 'butt' : null,
      };
    }
    const field = [...document.querySelectorAll('.editor-inspector .field-segmented')]
      .find((node) => node.querySelector('span')?.textContent === 'Ends' && node.getClientRects().length > 0);
    return {
      selection: [...window.store.get().selection],
      caps,
      pressed: field?.querySelector('.segment-button[aria-pressed="true"]')?.dataset.value ?? null,
    };
  })()`);
  for (const [id, cap] of Object.entries(after.caps)) {
    if (cap.stored !== value) flag('census', `Ends: ${value} stored ${cap.stored} on ${id}`);
    if (cap.drawn !== value) flag('census', `Ends: ${value} on ${id} draws stroke-linecap ${cap.drawn}`);
  }
  if (after.pressed !== value) flag('routing', `after Ends: ${value} the control shows ${after.pressed}`);
  if ([...after.selection].sort().join() !== [...chosen].sort().join()) {
    flag('routing', `Ends: ${value} changed the selection to [${after.selection.join(', ')}]`);
  }
  const othersAfter = await others();
  if (othersAfter !== before) {
    flag('census', `Ends: ${value} changed an unselected object; diff: ${firstDiff(before, othersAfter)}`);
  }
}

/**
 * Select one text box with a real click and choose its Text fit in the Props
 * tab by keyboard type-ahead. The box stores exactly the choice — never both
 * "grow the box" and "shrink the text", since a box sized to its text is
 * never fitted — the canvas fits exactly what the model says to, the control
 * shows the choice, and nothing else on the slide changes.
 */
const TEXT_FIT_FIELD = '#inspector .text-layout-options > .field:first-child select';

async function textFit(
  next: () => number,
  pre: CrossState,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  const id = pick(next, targetsOn(pre).filter((target) => target !== IMAGE));
  await session.clickEmpty();
  await session.click(id);
  const selected = (await session.state()).selection;
  if (selected.join() !== id) {
    flag('routing', `clicking ${id} selected [${selected.join(', ')}]`);
    return;
  }
  const shown = () => cdp.evaluate<string | null>(`(() => {
    const select = document.querySelector(${JSON.stringify(TEXT_FIT_FIELD)});
    return select && select.closest('.field').querySelector('span')?.textContent === 'Text fit'
      ? select.value : null;
  })()`);
  const was = await shown();
  if (was === null) {
    flag('routing', `the Props tab shows no Text fit control for ${id}`);
    return;
  }
  // Type-ahead moves to the next match, so asking for the option already
  // showing would walk away from it and back: choose another one.
  const value = pick(next, ['off', 'grow', 'shrink'].filter((choice) => choice !== was));
  const others = () => cdp.evaluate<string>(`JSON.stringify(window.store.slide.elements
    .filter((e) => e.id !== ${JSON.stringify(id)}))`);
  const before = await others();
  await cdp.chooseByKeys(TEXT_FIT_FIELD, value, `Text fit: ${value}`);
  await wait(150);
  if (TRACE) console.log(`  Text fit: ${was} -> ${value} on ${id}, editing was ${pre.editing}`);
  const after = await cdp.evaluate<{
    autoSize: boolean;
    autoFit: boolean;
    fits: boolean;
    expectedFits: boolean;
    selection: string[];
  }>(`(() => {
    const el = window.store.slide.elements.find((e) => e.id === ${JSON.stringify(id)});
    const node = document.querySelector(${JSON.stringify(elementSelector(id))});
    return {
      autoSize: el.autoSize === true,
      autoFit: el.autoFit === true,
      fits: node?.dataset.autoFit === 'true',
      expectedFits: Boolean((el.autoFit || el.noWrap) && !el.autoSize),
      selection: [...window.store.get().selection],
    };
  })()`);
  const stored = after.autoSize ? 'grow' : after.autoFit ? 'shrink' : 'off';
  if (after.autoSize && after.autoFit) flag('census', `Text fit: ${value} left ${id} both growing its box and shrinking its text`);
  if (stored !== value) flag('census', `Text fit: ${value} stored ${stored} on ${id}`);
  if (after.fits !== after.expectedFits) {
    flag('census', `Text fit: ${value} on ${id}: the canvas ${after.fits ? 'fits' : 'does not fit'} the text, the model says otherwise`);
  }
  const now = await shown();
  if (now !== value) flag('routing', `after Text fit: ${value} the control shows ${now}`);
  if (after.selection.join() !== id) {
    flag('routing', `Text fit: ${value} changed the selection to [${after.selection.join(', ')}]`);
  }
  const othersAfter = await others();
  if (othersAfter !== before) {
    flag('census', `Text fit: ${value} changed another object; diff: ${firstDiff(before, othersAfter)}`);
  }
  // The dropdown keeps the keyboard, where Backspace is not a slide command;
  // click back onto the slide, as `size from sidebar` clicks back into the text.
  await session.clickEmpty();
}

/**
 * Toggle Show slide numbers in the Props tab with nothing selected. The deck
 * flag flips, the box shows it, the slide on the canvas carries exactly the
 * number the deck gives it (none when off), and no object changes.
 */
async function slideNumbers(
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  await session.clickEmpty();
  const selected = (await session.state()).selection;
  if (selected.length > 0) {
    flag('routing', `clicking the empty canvas left [${selected.join(', ')}] selected`);
    return;
  }
  const box = `() => [...document.querySelectorAll('.editor-inspector .field-check')]
    .find((field) => field.querySelector('span')?.textContent === 'Show slide numbers (all slides)'
      && field.getClientRects().length > 0)?.querySelector('input')`;
  const read = () => cdp.evaluate<{ on: boolean; expected: string | null; shown: string | null; checked: boolean | null }>(`(() => {
    const state = window.store.get();
    const deck = state.deck;
    const current = deck.slides[state.slideIndex];
    let count = 0;
    let number = null;
    if (deck.showSlideNumbers) {
      for (const slide of deck.slides) {
        if (slide.layout === 'title' || slide.skipped) continue;
        count += 1;
        if (slide.id === current.id) number = String(count);
      }
    }
    const footer = document.querySelector('.slide-layer > .slide > .slide-number:not([data-element-id])');
    return {
      on: deck.showSlideNumbers === true,
      expected: number,
      shown: footer ? footer.textContent : null,
      checked: (${box})()?.checked ?? null,
    };
  })()`);
  const before = await read();
  const objects = await session.deckSnapshot();
  if (!await clickFound(box, 'Show slide numbers')) {
    flag('routing', 'the Props tab shows no Show slide numbers box with nothing selected');
    return;
  }
  await wait(150);
  const after = await read();
  if (after.on === before.on) flag('census', `Show slide numbers left the deck at ${after.on}`);
  if (after.checked !== after.on) flag('routing', `Show slide numbers is ${after.checked ? '' : 'un'}checked for a deck at ${after.on}`);
  if (after.shown !== after.expected) {
    flag('census', `the slide shows number ${after.shown} where the deck gives it ${after.expected}`);
  }
  const objectsAfter = await session.deckSnapshot();
  if (objectsAfter !== objects) {
    flag('census', `Show slide numbers changed an object; diff: ${firstDiff(objects, objectsAfter)}`);
  }
}

/**
 * The zoom bar's Gridlines toggle, mid-edit or not, is editor chrome: the
 * deck, the slide and the selection are exactly as they were, and the button
 * says what the canvas shows. Like every zoom-bar button (Zoom in, Re-center
 * slide), a click on it ends a text edit, so the edit itself is not compared.
 */
async function gridlines(flag: (oracle: 'routing' | 'census', detail: string) => void): Promise<void> {
  const { cdp } = session;
  const snapshot = () => cdp.evaluate<string>(`(() => {
    const state = window.store.get();
    return JSON.stringify({
      deck: state.deck,
      slide: state.slideIndex,
      selection: [...state.selection].sort(),
    });
  })()`);
  const view = () => cdp.evaluate<{ shown: boolean; pressed: string | null }>(`({
    shown: document.querySelector('.canvas-host')?.classList.contains('show-gridlines') === true,
    pressed: document.querySelector('#canvas .zoom-gridlines')?.getAttribute('aria-pressed') ?? null,
  })`);
  const before = await snapshot();
  const was = await view();
  await cdp.click('#canvas .zoom-gridlines', 'the Gridlines toggle');
  await wait(120);
  const now = await view();
  if (now.shown === was.shown) flag('routing', `the Gridlines toggle left the gridlines ${now.shown ? 'on' : 'off'}`);
  if (now.pressed !== String(now.shown)) flag('routing', `Gridlines shows aria-pressed=${now.pressed} with gridlines ${now.shown ? 'on' : 'off'}`);
  const after = await snapshot();
  if (after !== before) flag('census', `the Gridlines toggle changed the deck, the slide or the selection; diff: ${firstDiff(before, after)}`);
}

/**
 * Choose another theme in the Design tab, mid-edit or not. It lands on every
 * slide at once: the deck wears it, no box keeps a copy of type it did not
 * choose (only `overrides`, and an untagged box's size), no object comes or
 * goes, and the panel reports what happened. The Props tab comes back after,
 * as the other ops expect it.
 */
async function themePick(
  next: () => number,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  await cdp.click('#side-tabs button[data-panel="themePanel"]', 'the Design tab');
  await wait(80);
  try {
    await cdp.click('#themePanel .theme-active-card', 'the current theme card');
    await wait(80);
    const offered = await cdp.evaluate<string[]>(`[...document.querySelectorAll('#themePanel .theme-gallery .theme-card')]
      .filter((card) => !card.classList.contains('selected')).map((card) => card.dataset.themeId)`);
    if (offered.length === 0) {
      flag('routing', 'the theme chooser offered no other theme');
      return;
    }
    const id = pick(next, offered);
    await cdp.click(`#themePanel .theme-gallery .theme-card[data-theme-id="${id}"]`, `the ${id} theme card`);
    await wait(150);
    const after = await cdp.evaluate<{ preset: string | null; copies: string[]; reported: boolean }>(`(() => {
      const deck = window.store.get().deck;
      const TYPE = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color'];
      const copies = [];
      for (const slide of deck.slides) for (const el of slide.elements) {
        if (el.type !== 'text') continue;
        const own = new Set(el.overrides ?? []);
        const untagged = !el.class.some((name) => /^role-(title|heading|body|caption)$/.test(name));
        for (const property of TYPE) {
          if (own.has(property) || (untagged && (property === 'font-size' || property === 'line-height'))) continue;
          if (el.style[property] !== undefined || el.contentStyle?.[property] !== undefined) {
            copies.push(slide.id + '/' + el.id + ' ' + property);
          }
        }
      }
      return {
        preset: deck.themePreset,
        copies,
        reported: document.querySelector('#themePanel .theme-change-report')?.hidden === false,
      };
    })()`);
    if (after.preset !== id) flag('routing', `choosing ${id} left the deck wearing ${after.preset}`);
    if (after.copies.length > 0) flag('census', `after choosing ${id}, boxes still carry type: ${after.copies.join(', ')}`);
    if (!after.reported) flag('routing', `choosing ${id} reported nothing in the Design tab`);
  } finally {
    await cdp.click('#side-tabs button[data-panel="inspector"]', 'the Props tab');
    await wait(80);
  }
}

/**
 * Flip the Design tab's Slide colors switch, with the theme chooser open or
 * not. It is the only Light/Dark switch there, and it puts the other half of
 * the same theme on every slide at once: the deck wears that variant, the
 * pressed button follows, and no object comes or goes. The chooser is closed
 * and the Props tab comes back after, as the other ops expect.
 */
async function slideColors(
  next: () => number,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  const base = (id: string | null) => (id ?? '').replace(/-(dark|light)$/, '');
  await cdp.click('#side-tabs button[data-panel="themePanel"]', 'the Design tab');
  await wait(80);
  const withChooser = next() < 0.5;
  try {
    if (withChooser) {
      await cdp.click('#themePanel .theme-active-card', 'the current theme card');
      await wait(80);
    }
    const before = await cdp.evaluate<{ theme: string | null; pressed: string | null; switches: number }>(`({
      theme: document.querySelector('#themePanel .theme-active-card')?.dataset.themeId ?? null,
      pressed: document.querySelector('#themePanel .theme-default-mode [aria-pressed="true"]')?.textContent ?? null,
      switches: document.querySelectorAll('#themePanel .theme-mode-toggle').length,
    })`);
    if (before.switches !== 1) {
      flag('routing', `the Design tab shows ${before.switches} Light/Dark switches${withChooser ? ' with the chooser open' : ''}`);
    }
    const target = before.pressed === 'Dark' ? 'Light' : 'Dark';
    await cdp.clickByText('#themePanel .theme-default-mode .theme-mode-option', target, `Slide colors: ${target}`);
    await wait(150);
    const after = await cdp.evaluate<{ preset: string | null; pressed: string | null }>(`({
      preset: window.store.get().deck.themePreset ?? null,
      pressed: document.querySelector('#themePanel .theme-default-mode [aria-pressed="true"]')?.textContent ?? null,
    })`);
    if (after.pressed !== target) flag('routing', `Slide colors ${target} left ${after.pressed} pressed`);
    if (after.preset === before.theme || base(after.preset) !== base(before.theme)) {
      flag('routing', `Slide colors ${target} on ${before.theme} left the deck wearing ${after.preset}`);
    }
  } finally {
    if (withChooser) {
      await cdp.clickByText('#themePanel .theme-chooser-header button', 'Close', 'close the theme chooser');
      await wait(80);
    }
    await cdp.click('#side-tabs button[data-panel="inspector"]', 'the Props tab');
    await wait(80);
  }
}

/**
 * Edit the theme in the Design tab, maybe change the title size, then leave
 * by another door: the Props tab, Escape, or a rail click. An edit that
 * changed nothing ends quietly; a changed one asks "Discard theme changes?",
 * and is kept (Escape) with its preview, or discarded (Return). Nothing
 * reaches the deck without Done, and once the edit ends no preview is left
 * over the slide. The Props tab comes back after, as the other ops expect it.
 */
async function themeDraft(
  next: () => number,
  pre: CrossState,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  const look = () => cdp.evaluate<{ editing: boolean; overlay: boolean; asking: boolean; style: string }>(`(() => ({
    editing: document.querySelector('#themePanel .theme-inline-editor')?.hidden === false,
    overlay: Boolean(document.querySelector('#canvas .design-slide-preview, #canvas .design-slide-preview-banner')),
    asking: Boolean(document.querySelector('.confirm-dialog')),
    style: JSON.stringify(window.store.get().deck.themeStyle ?? null),
  }))()`);
  const before = (await look()).style;
  await cdp.click('#side-tabs button[data-panel="themePanel"]', 'the Design tab');
  await wait(80);
  try {
    await cdp.click('#themePanel .theme-edit-button', 'Edit theme…');
    const change = next() < 0.7;
    if (change) {
      const size = 60 + Math.floor(next() * 80);
      const current = await cdp.evaluate<number>(`Number(document.querySelector('#themePanel .theme-role-size input').value)`);
      await cdp.typeInto('#themePanel .theme-role-size input', String(size === current ? size + 1 : size), 'Title size');
    }
    await wait(80);
    const door = pick(next, ['the Props tab', 'Escape', 'a rail click']);
    if (door === 'the Props tab') await cdp.click('#side-tabs button[data-panel="inspector"]', 'the Props tab');
    else if (door === 'Escape') await session.key('Escape', 27);
    else await session.clickRail(pre.slides > 1 && next() < 0.5 ? (pre.slideIndex === 0 ? 1 : 0) : pre.slideIndex);
    await wait(150);
    let now = await look();
    if (!change && now.asking) flag('routing', `${door} asked about a theme edit that changed nothing`);
    if (change) {
      if (!now.asking) {
        flag('census', `${door} ended a changed theme edit without asking`);
        return;
      }
      const keep = next() < 0.5;
      await session.key(keep ? 'Escape' : 'Enter', keep ? 27 : 13);
      await wait(150);
      now = await look();
      if (now.asking) flag('routing', `${keep ? 'Escape' : 'Return'} left "Discard theme changes?" open`);
      if (keep) {
        if (!now.editing || !now.overlay) flag('routing', `keeping the theme edit after ${door} ended it or dropped its preview`);
        await cdp.clickByText('#themePanel .theme-inline-editor button', 'Cancel');
        await wait(80);
        now = await look();
      }
    }
    if (now.editing) flag('routing', `the theme edit is still open after ${door}`);
    if (now.overlay) flag('routing', `the theme edit ended by ${door} left its preview over the slide`);
    if (now.style !== before) flag('census', `a theme edit ended by ${door} without Done changed the deck's theme`);
  } finally {
    await cdp.click('#side-tabs button[data-panel="inspector"]', 'the Props tab');
    await wait(80);
  }
}

/**
 * Crop the image by dragging one edge strip of its crop window — away from
 * the corner and midpoint handles — in or out. The window stays whole pixels
 * and inside the picture, the picture stays where it was on the slide, and
 * the three edges not dragged do not move. Crop mode is entered by a real
 * double-click when it is not already on.
 */
async function cropEdgeDrag(
  next: () => number,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  if (!await enterCrop(flag)) return;
  const read = () => cdp.evaluate<{ box: Rect; sourceBox: Rect | null; frame: Rect | null; round: boolean } | null>(`(() => {
    const el = window.store.slide.elements.find((e) => e.id === ${JSON.stringify(IMAGE)});
    const outline = document.querySelector('.overlay-layer .sel-box.masking');
    if (!el) return null;
    return {
      box: { x: el.x, y: el.y, w: el.w, h: el.h },
      sourceBox: el.sourceBox ?? null,
      round: el.maskShape === 'circle',
      frame: outline ? {
        x: parseFloat(outline.style.left), y: parseFloat(outline.style.top),
        w: parseFloat(outline.style.width), h: parseFloat(outline.style.height),
      } : null,
    };
  })()`);
  const picture = (state: { box: Rect; sourceBox: Rect | null; frame: Rect }): Rect => (state.sourceBox
    ? { x: state.box.x + state.sourceBox.x, y: state.box.y + state.sourceBox.y, w: state.sourceBox.w, h: state.sourceBox.h }
    : state.frame);
  const before = await read();
  if (!before?.frame) {
    flag('routing', `crop mode on ${IMAGE} draws no crop window`);
    return;
  }
  const edge = pick(next, ['n', 'e', 's', 'w'] as const);
  const along = pick(next, [0.2, 0.3, 0.7, 0.8]);
  const strip = await cdp.evaluate<{ x: number; y: number; hit: string } | null>(`(() => {
    const node = document.querySelector('.overlay-layer .mask-edge-${edge}');
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const horizontal = ${edge === 'n' || edge === 's'};
    const x = horizontal ? r.left + r.width * ${along} : r.left + r.width / 2;
    const y = horizontal ? r.top + r.height / 2 : r.top + r.height * ${along};
    const hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit === node ? '' : String(hit?.className || hit?.tagName) };
  })()`);
  if (!strip) {
    flag('routing', `the crop window has no ${edge} edge strip`);
    return;
  }
  if (strip.hit) {
    flag('routing', `the crop window's ${edge} edge strip is covered at ${along} by ${strip.hit}`);
    return;
  }
  // Slide pixels, positive outward. Inward stops short of a window too small
  // for the other ops to click.
  const size = edge === 'n' || edge === 's' ? before.frame.h : before.frame.w;
  const room = size - 160;
  const outward = room <= 0 || next() < 0.4;
  const amount = outward ? 10 + next() * 110 : -Math.min(room, size * (0.1 + 0.35 * next()));
  const layer = await session.boxOf('.slide-layer');
  const perSlidePixel = layer.width / await cdp.evaluate<number>('window.store.get().deck.canvas.w');
  const sign = edge === 'n' || edge === 'w' ? -1 : 1;
  const dx = edge === 'e' || edge === 'w' ? sign * amount * perSlidePixel : 0;
  const dy = edge === 'n' || edge === 's' ? sign * amount * perSlidePixel : 0;
  const mouse = (type: string, x: number, y: number, buttons: number) => cdp.call('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' && buttons === 0 ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
  });
  await mouse('mouseMoved', strip.x, strip.y, 0);
  await mouse('mousePressed', strip.x, strip.y, 1);
  for (let i = 1; i <= 4; i++) {
    await mouse('mouseMoved', strip.x + (dx * i) / 4, strip.y + (dy * i) / 4, 1);
    await wait(16);
  }
  await mouse('mouseReleased', strip.x + dx, strip.y + dy, 0);
  await wait(120);

  const after = await read();
  const label = `dragging the ${edge} edge strip ${outward ? 'out' : 'in'} by ${Math.round(amount)}`;
  if (TRACE) console.log(`  ${label}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  if (!after?.frame) {
    flag('census', `${label} lost the image or its crop window`);
    return;
  }
  const whole = [after.box.x, after.box.y, after.box.w, after.box.h,
    ...(after.sourceBox ? [after.sourceBox.x, after.sourceBox.y] : [])];
  if (!whole.every(Number.isInteger)) {
    flag('census', `${label} left fractional pixels: box ${JSON.stringify(after.box)} sourceBox ${JSON.stringify(after.sourceBox)}`);
  }
  const was = picture({ ...before, frame: before.frame });
  const is = picture({ ...after, frame: after.frame });
  if (!near(was.x, is.x) || !near(was.y, is.y) || !near(was.w, is.w) || !near(was.h, is.h)) {
    flag('census', `${label} moved the picture from ${JSON.stringify(was)} to ${JSON.stringify(is)}`);
  }
  const win = after.frame;
  if (win.x < is.x - 1 || win.y < is.y - 1 || win.x + win.w > is.x + is.w + 1 || win.y + win.h > is.y + is.h + 1) {
    flag('census', `${label} left the crop window ${JSON.stringify(win)} outside the picture ${JSON.stringify(is)}`);
  }
  const edges = (r: Rect) => ({ n: r.y, s: r.y + r.h, w: r.x, e: r.x + r.w });
  const from = edges(before.frame);
  const to = edges(win);
  // A circular window stays square, so the two edges beside the dragged one
  // follow it; only the opposite edge stays put.
  const opposite = { n: 's', s: 'n', e: 'w', w: 'e' }[edge];
  if (after.round && !near(win.w, win.h)) flag('census', `${label} left the circular window ${win.w}x${win.h}`);
  for (const side of ['n', 'e', 's', 'w'] as const) {
    if (side === edge) {
      const moved = (to[side] - from[side]) * (side === 'n' || side === 'w' ? -1 : 1);
      if (outward ? moved < -1 : moved > 1) {
        flag('census', `${label} moved that edge ${outward ? 'in' : 'out'} by ${Math.abs(moved)}`);
      }
    } else if ((!after.round || side === opposite) && !near(to[side], from[side])) {
      flag('census', `${label} also moved the ${side} edge from ${from[side]} to ${to[side]}`);
    }
  }
  if (await masking() !== IMAGE) flag('routing', `${label} ended crop mode`);
}

/**
 * Shift-drag the image's south-east handle, in crop mode or out of it, as the
 * walk left it. Shift locks proportions on a resize and on a crop alike, and
 * no drag writes the image's fit ("Keep aspect ratio"): a Shift-resize used
 * to free the box and save the picture stretched for good.
 */
async function shiftResizeImage(
  next: () => number,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  if ((await session.state()).selection.join() !== IMAGE) await session.click(IMAGE);
  // The outline is the frame the drag starts from: for an uncropped picture
  // that is the picture it paints, not the box saved for it.
  const read = () => cdp.evaluate<{ w: number; h: number; fit: string; x: number; y: number } | null>(`(() => {
    const el = window.store.slide.elements.find((e) => e.id === ${JSON.stringify(IMAGE)});
    const handle = document.querySelector('.overlay-layer .handle-se[data-element-id=${JSON.stringify(IMAGE)}]');
    const box = handle?.parentElement;
    if (!el || !box) return null;
    const r = handle.getBoundingClientRect();
    return {
      w: parseFloat(box.style.width), h: parseFloat(box.style.height), fit: el.fit,
      x: r.left + r.width / 2, y: r.top + r.height / 2,
    };
  })()`);
  const before = await read();
  if (!before) {
    flag('routing', `clicking ${IMAGE} left it without a south-east handle`);
    return;
  }
  const cropping = await cdp.evaluate<string | null>('window.canvas.maskingElement()') === IMAGE;
  // Grow while there is room, shrink once it is large, and never along the
  // box's own diagonal, so a free drag would have reshaped it.
  const grow = before.w < 600 && before.h < 400;
  const amount = (grow ? 1 : -1) * (20 + next() * 100);
  const layer = await session.boxOf('.slide-layer');
  const perSlidePixel = layer.width / await cdp.evaluate<number>('window.store.get().deck.canvas.w');
  const dx = amount * perSlidePixel;
  const dy = amount * (0.3 + next()) * perSlidePixel;
  const mouse = (type: string, x: number, y: number, buttons: number) => cdp.call('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' && buttons === 0 ? 'none' : 'left', buttons,
    clickCount: type === 'mouseMoved' ? 0 : 1, modifiers: SHIFT,
  });
  await mouse('mouseMoved', before.x, before.y, 0);
  await mouse('mousePressed', before.x, before.y, 1);
  for (let i = 1; i <= 4; i++) {
    await mouse('mouseMoved', before.x + (dx * i) / 4, before.y + (dy * i) / 4, 1);
    await wait(16);
  }
  await mouse('mouseReleased', before.x + dx, before.y + dy, 0);
  await wait(120);

  const after = await read();
  const label = `Shift-${cropping ? 'cropping' : 'resizing'} ${IMAGE} by ${Math.round(amount)}`;
  if (TRACE) console.log(`  ${label}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  if (!after) {
    flag('census', `${label} lost the image or its handles`);
    return;
  }
  if (after.fit !== before.fit) flag('census', `${label} changed its fit from ${before.fit} to ${after.fit}`);
  // Whole pixels: each side may round by one.
  if (Math.abs(after.w * before.h - after.h * before.w) > before.w + before.h) {
    flag('census', `${label} reshaped it from ${before.w}x${before.h} to ${after.w}x${after.h}`);
  }
}

/**
 * Reset the image's crop with the × beside Crop… in the Props tab,
 * cropping it first by an edge drag when it is not cropped. The frame becomes
 * the whole picture where the crop showed it: the picture neither moves nor
 * changes size, as it did when the reset squeezed it into the cropped window.
 */
async function resetCrop(
  next: () => number,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  type Media = Extract<SlideElement, { type: 'image' | 'video' }>;
  const read = () => cdp.evaluate<{ el: Media; natural: { w: number; h: number } | null } | null>(`(() => {
    const el = window.store.slide.elements.find((e) => e.id === ${JSON.stringify(IMAGE)});
    const img = document.querySelector('${elementSelector(IMAGE)} img');
    if (!el) return null;
    return { el, natural: img && img.naturalWidth > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null };
  })()`);
  const onSlide = (state: { el: Media; natural: { w: number; h: number } | null }) => {
    const painted = paintedMediaBox(state.el, state.natural);
    if (!painted) throw new Error('The picture size is not known yet');
    return { x: state.el.x + painted.x, y: state.el.y + painted.y, w: painted.w, h: painted.h };
  };
  let before = await read();
  if (!before?.el.sourceBox) {
    await cropEdgeDrag(next, flag);
    before = await read();
    if (!before?.el.sourceBox) return;
  }
  const masking = () => cdp.evaluate<string | null>('window.canvas.maskingElement()');
  if (await masking() === IMAGE) {
    await clickFound(`() => [...document.querySelectorAll('.editor-inspector .mask-action-row .panel-action')]
      .find((node) => node.textContent === 'Done cropping' && node.getClientRects().length > 0)`, 'Done cropping');
    await wait(120);
  } else if ((await session.state()).selection.join() !== IMAGE) {
    await session.click(IMAGE);
  }
  const reset = `() => [...document.querySelectorAll('.editor-inspector .mask-action-row button')]
    .find((node) => node.textContent === 'Reset crop' && node.getClientRects().length > 0)`;
  if (!await clickFound(reset, 'Reset crop')) {
    flag('routing', `the Props tab offers no Reset crop for the cropped ${IMAGE}`
      + ` (cropping ${await masking()}, selection [${(await session.state()).selection.join(', ')}])`);
    return;
  }
  await wait(150);
  const after = await read();
  if (!after) {
    flag('census', `Reset crop lost ${IMAGE}`);
    return;
  }
  const was = onSlide(before);
  const is = onSlide(after);
  if (editableCircularMask(before.el)) {
    if (!after.el.sourceBox || !nearRect(after.el, before.el) || !covers(is, after.el)
      || !near(is.x + is.w / 2, after.el.x + after.el.w / 2)
      || !near(is.y + is.h / 2, after.el.y + after.el.h / 2)) {
      flag('census', `Reset crop did not re-centre the circle in its window: ${JSON.stringify(after.el)}`);
    }
  } else {
    if (after.el.sourceBox) flag('census', `Reset crop left the crop ${JSON.stringify(after.el.sourceBox)}`);
    if (!nearRect(was, is)) {
      flag('census', `Reset crop moved the picture from ${JSON.stringify(was)} to ${JSON.stringify(is)}`);
    }
  }
  if ((await session.state()).selection.join() !== IMAGE) {
    flag('routing', `Reset crop changed the selection to [${(await session.state()).selection.join(', ')}]`);
  }
}

/**
 * Select the image with a real click and type a width or height into the
 * Props geometry fields, as a person sizes a picture exactly. It takes that
 * size the way a handle drag gives it: Props shows the box the canvas
 * outlines (for the letterboxed fixture, the picture rather than its empty
 * frame), a crop scales with its window instead of showing a different part
 * of the picture, the proportions hold while "Keep aspect ratio" is on, and
 * nothing else on the slide changes.
 */
async function geometryFromSidebar(
  next: () => number,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  await session.clickEmpty();
  await session.click(IMAGE);
  const selected = (await session.state()).selection;
  if (selected.join() !== IMAGE) {
    flag('routing', `clicking ${IMAGE} selected [${selected.join(', ')}]`);
    return;
  }
  type Rect = { x: number; y: number; w: number; h: number };
  const read = () => cdp.evaluate<{
    box: Rect; sourceBox: Rect | null; fit: string; outline: Rect | null; props: Rect; others: string;
  } | null>(`(() => {
    const elements = window.store.slide.elements;
    const el = elements.find((e) => e.id === ${JSON.stringify(IMAGE)});
    if (!el) return null;
    const outline = document.querySelector('.overlay-layer .sel-box');
    const field = (label) => Number([...document.querySelectorAll('.editor-inspector .geometry-section .field-number')]
      .find((node) => node.querySelector('span')?.textContent === label)?.querySelector('input')?.value);
    return {
      box: { x: el.x, y: el.y, w: el.w, h: el.h },
      sourceBox: el.sourceBox ?? null,
      fit: el.fit,
      outline: outline ? {
        x: parseFloat(outline.style.left), y: parseFloat(outline.style.top),
        w: parseFloat(outline.style.width), h: parseFloat(outline.style.height),
      } : null,
      props: { x: field('X'), y: field('Y'), w: field('W'), h: field('H') },
      others: JSON.stringify(elements.filter((e) => e.id !== ${JSON.stringify(IMAGE)})),
    };
  })()`);
  const before = await read();
  if (!before?.outline) {
    flag('routing', `selecting ${IMAGE} draws no outline`);
    return;
  }
  const key = pick(next, ['w', 'h'] as const);
  const value = pick(next, [160, 200, 240]);
  const label = `typing ${key.toUpperCase()} ${value} for ${IMAGE}`;
  await sidebarSelectionProbes(cdp).setField(key.toUpperCase(), String(value));
  const after = await read();
  if (TRACE) console.log(`  ${label}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  if (!after?.outline) {
    flag('census', `${label} lost the image or its outline`);
    return;
  }
  const near = (a: number, b: number, tolerance = 1) => Math.abs(a - b) <= tolerance;
  for (const side of ['x', 'y', 'w', 'h'] as const) {
    if (!near(after.props[side], after.outline[side])) {
      flag('census', `after ${label} Props shows ${JSON.stringify(after.props)} for the outline ${JSON.stringify(after.outline)}`);
      break;
    }
  }
  if (!near(after.outline[key], value)) {
    flag('census', `${label} outlined a box of ${key} ${after.outline[key]}`);
  }
  if (after.fit !== 'fill'
    && !near(after.outline.w / after.outline.h, before.outline.w / before.outline.h, 0.02 * before.outline.w / before.outline.h)) {
    flag('census', `${label} changed the proportions from ${JSON.stringify(before.outline)} to ${JSON.stringify(after.outline)}`);
  }
  if (before.sourceBox) {
    // The crop scales with its window, so the same part of the picture shows.
    const fx = after.box.w / before.box.w;
    const fy = after.box.h / before.box.h;
    const crop = before.sourceBox;
    const expected = { x: crop.x * fx, y: crop.y * fy, w: crop.w * fx, h: crop.h * fy };
    const got = after.sourceBox;
    if (!got || !(['x', 'y', 'w', 'h'] as const).every((side) => near(got[side], expected[side], 1.5))) {
      flag('census', `${label} re-cropped the picture: crop ${JSON.stringify(crop)} in ${JSON.stringify(before.box)}`
        + ` became ${JSON.stringify(got)} in ${JSON.stringify(after.box)}`);
    }
  }
  if (after.others !== before.others) {
    flag('census', `${label} changed another object; diff: ${firstDiff(before.others, after.others)}`);
  }
}

type Rect = { x: number; y: number; w: number; h: number };
type Media = Extract<SlideElement, { type: 'image' | 'video' }>;
interface ImageView { el: Media; natural: { w: number; h: number } | null; frame: Rect | null; radius: string }

const masking = () => session.cdp.evaluate<string | null>('window.canvas.maskingElement()');

/** Screen pixels per slide pixel at the current zoom. */
async function slideScale(): Promise<number> {
  const layer = await session.boxOf('.slide-layer');
  return layer.width / await session.cdp.evaluate<number>('window.store.get().deck.canvas.w');
}

/**
 * Crop mode on the image, entered by a real double-click when it is not
 * already on. False, flagged, when the double-click does not enter it.
 */
async function enterCrop(flag: (oracle: 'routing', detail: string) => void): Promise<boolean> {
  const cropping = async () => await masking() === IMAGE
    && (await session.state()).selection.join() === IMAGE;
  if (await cropping()) return true;
  await session.doubleClick(IMAGE);
  if (await cropping()) return true;
  flag('routing', `double-clicking ${IMAGE} did not enter crop mode`
    + ` (cropping ${await masking()}, selection [${(await session.state()).selection.join(', ')}])`);
  return false;
}

/** The image as the only selection, by real clicks, leaving crop mode as it was. */
async function selectImage(flag: (oracle: 'routing', detail: string) => void): Promise<boolean> {
  if ((await session.state()).selection.join() !== IMAGE) {
    await session.clickEmpty();
    await session.click(IMAGE);
  }
  const selection = (await session.state()).selection;
  if (selection.join() === IMAGE) return true;
  flag('routing', `clicking ${IMAGE} selected [${selection.join(', ')}]`);
  return false;
}

/** The image as the deck has it, its outline on the canvas, and its drawn corner radius. */
function readImage(): Promise<ImageView | null> {
  return session.cdp.evaluate<ImageView | null>(`(() => {
    const el = window.store.slide.elements.find((e) => e.id === ${JSON.stringify(IMAGE)});
    const node = document.querySelector('${elementSelector(IMAGE)}');
    const img = node && node.querySelector('img');
    const outline = document.querySelector('.overlay-layer .handle[data-element-id="${IMAGE}"]')
      ?.closest('.sel-box');
    if (!el) return null;
    return {
      el,
      natural: img && img.naturalWidth > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null,
      frame: outline ? {
        x: parseFloat(outline.style.left), y: parseFloat(outline.style.top),
        w: parseFloat(outline.style.width), h: parseFloat(outline.style.height),
      } : null,
      radius: node ? node.style.borderRadius : '',
    };
  })()`);
}

/**
 * Give the keyboard back to the canvas as an author does, by a click on the
 * picture that changes nothing: past the double-click interval of any click
 * before it, so it cannot toggle crop mode, and inside the crop window when
 * cropping, so it does not end it.
 */
async function clickPicture(): Promise<void> {
  await wait(600);
  await session.click(IMAGE);
}

/** Where the whole picture sits on the slide, cropped or not. */
function pictureOf(view: ImageView): Rect {
  const painted = paintedMediaBox(view.el, view.natural);
  if (!painted) throw new Error('The picture size is not known yet');
  return { x: view.el.x + painted.x, y: view.el.y + painted.y, w: painted.w, h: painted.h };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1;
const nearRect = (a: Rect, b: Rect) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);
const covers = (outer: Rect, inner: Rect) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1
  && inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1;

/**
 * In crop mode, drag the picture from inside its window. The window stays
 * where it is, the picture keeps its size and follows the pointer until one
 * of its edges meets the window's, the crop is whole pixels, and crop mode
 * stays on.
 */
async function cropPan(
  next: () => number,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  if (!await enterCrop(flag)) return;
  const before = await readImage();
  if (!before?.frame) {
    flag('routing', `crop mode on ${IMAGE} draws no crop window`);
    return;
  }
  const fx = 0.3 + 0.4 * next();
  const fy = 0.3 + 0.4 * next();
  const start = await cdp.evaluate<{ x: number; y: number; covered: string }>(`(() => {
    const r = document.querySelector('.overlay-layer .sel-box.masking').getBoundingClientRect();
    const x = r.left + r.width * ${fx};
    const y = r.top + r.height * ${fy};
    const handle = document.elementFromPoint(x, y)?.closest('.handle');
    return { x, y, covered: handle ? String(handle.className) : '' };
  })()`);
  if (start.covered) {
    flag('routing', `the inside of the crop window is covered by ${start.covered}`);
    return;
  }
  // Slide pixels, each axis well past the drag threshold.
  const dx = (next() < 0.5 ? -1 : 1) * (20 + next() * 140);
  const dy = (next() < 0.5 ? -1 : 1) * (20 + next() * 140);
  const scale = await slideScale();
  const gesture = await cdp.beginDrag(start.x, start.y);
  for (let i = 1; i <= 4; i++) {
    await gesture.moveTo(start.x + (dx * scale * i) / 4, start.y + (dy * scale * i) / 4);
    await wait(16);
  }
  await gesture.drop();
  await wait(120);

  const after = await readImage();
  const label = `panning the picture by ${Math.round(dx)},${Math.round(dy)}`;
  if (TRACE) console.log(`  ${label}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  if (!after?.frame) {
    flag('census', `${label} lost the image or its crop window`);
    return;
  }
  const win = before.frame;
  if (!nearRect(after.frame, win)) {
    flag('census', `${label} moved the crop window from ${JSON.stringify(win)} to ${JSON.stringify(after.frame)}`);
  }
  const was = pictureOf(before);
  const is = pictureOf(after);
  if (!near(was.w, is.w) || !near(was.h, is.h)) {
    flag('census', `${label} resized the picture from ${was.w}x${was.h} to ${is.w}x${is.h}`);
  }
  // Offsets inside the window: the picture moves with the pointer, clamped
  // where its edge meets the window's (or where it already was past it).
  const follow = (from: number, delta: number, room: number) =>
    Math.min(Math.max(from + delta, Math.min(0, room, from)), Math.max(0, room, from));
  const want = {
    x: win.x + follow(was.x - win.x, dx, win.w - was.w),
    y: win.y + follow(was.y - win.y, dy, win.h - was.h),
  };
  if (Math.abs(is.x - want.x) > 1.5 || Math.abs(is.y - want.y) > 1.5) {
    flag('census', `${label} put the picture at ${is.x},${is.y}, not ${want.x},${want.y}`
      + ` (window ${JSON.stringify(win)}, picture was ${JSON.stringify(was)})`);
  }
  if (covers(was, win) && !covers(is, after.frame)) {
    flag('census', `${label} left the crop window ${JSON.stringify(after.frame)} outside the picture ${JSON.stringify(is)}`);
  }
  const whole = [after.el.x, after.el.y, after.el.w, after.el.h,
    ...(after.el.sourceBox ? [after.el.sourceBox.x, after.el.sourceBox.y] : [])];
  if (!whole.every(Number.isInteger)) {
    flag('census', `${label} left fractional pixels: ${JSON.stringify(after.el)}`);
  }
  if (await masking() !== IMAGE) flag('routing', `${label} ended crop mode`);
  const selection = (await session.state()).selection;
  if (selection.join() !== IMAGE) flag('routing', `${label} changed the selection to [${selection.join(', ')}]`);
}

/**
 * The Props tab's crop button, with the image selected: it turns crop mode on
 * or off, the canvas draws the crop window exactly while it is on, the button
 * reads differently after, and neither way is an edit.
 */
async function cropToggleFromPanel(
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  if (!await selectImage(flag)) return;
  const button = `() => [...document.querySelectorAll('.editor-inspector .mask-action-row .panel-action')]
    .find((node) => node.getClientRects().length > 0)`;
  const label = () => cdp.evaluate<string | null>(`(${button})()?.textContent ?? null`);
  const was = await masking();
  const wasLabel = await label();
  const deck = await session.deckSnapshot();
  if (!await clickFound(button, `the crop button (${wasLabel})`)) {
    flag('routing', `the Props tab shows no crop button for ${IMAGE}`);
    return;
  }
  await wait(120);
  const want = was === IMAGE ? null : IMAGE;
  const is = await masking();
  if (is !== want) flag('routing', `"${wasLabel}" left crop mode on ${is ?? 'nothing'}`);
  const edges = await cdp.evaluate<number>(
    `document.querySelectorAll('.overlay-layer .sel-box.masking .mask-edge').length`);
  if (edges !== (want ? 4 : 0)) flag('routing', `with crop mode on ${want ?? 'nothing'} the canvas draws ${edges} crop edges`);
  const nowLabel = await label();
  if (nowLabel === wasLabel) flag('routing', `the crop button still reads "${wasLabel}" after it was clicked`);
  const selection = (await session.state()).selection;
  if (selection.join() !== IMAGE) flag('routing', `"${wasLabel}" changed the selection to [${selection.join(', ')}]`);
  const deckAfter = await session.deckSnapshot();
  if (deckAfter !== deck) flag('census', `"${wasLabel}" edited the deck; diff: ${firstDiff(deck, deckAfter)}`);
}

/**
 * Enter crop mode (by double-click or the Props button) and press Escape.
 * Escape deselects and is not an edit.
 */
async function escapeDuringCrop(
  next: () => number,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  if (next() < 0.5) {
    if (!await enterCrop(flag)) return;
    await clickPicture();
  } else {
    if (!await selectImage(flag)) return;
    if (await masking() !== IMAGE) await cropToggleFromPanel(flag);
    if (await masking() !== IMAGE) return;
  }
  const deck = await session.deckSnapshot();
  await session.key('Escape', 27);
  await wait(120);
  const selection = (await session.state()).selection;
  if (selection.length > 0) flag('routing', `Escape in crop mode left [${selection.join(', ')}] selected`);
  const deckAfter = await session.deckSnapshot();
  if (deckAfter !== deck) flag('census', `Escape in crop mode edited the deck; diff: ${firstDiff(deck, deckAfter)}`);
  if (await masking() !== null) flag('routing', 'Escape left crop mode on');
}

/**
 * The Props tab's Crop to circle box, with the image selected. On: the window
 * squares about its centre, the picture fills it at its own size or larger,
 * in its own proportions, centred where it was, and the canvas draws it round. Off: the geometry
 * stays exactly as it was and the corners come back. Crop mode, the
 * selection and every other object are untouched.
 */
async function circleToggle(
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  if (!await selectImage(flag)) return;
  const box = `() => [...document.querySelectorAll('.editor-inspector .media-mask-settings .field-check input')]
    .find((node) => node.getClientRects().length > 0)`;
  const before = await readImage();
  const cropping = await masking();
  const others = () => cdp.evaluate<string>(`JSON.stringify(window.store.slide.elements
    .filter((e) => e.id !== ${JSON.stringify(IMAGE)}))`);
  const othersBefore = await others();
  if (!before) return;
  if (!await clickFound(box, 'Crop to circle')) {
    flag('routing', `the Props tab shows no Crop to circle box for ${IMAGE}`);
    return;
  }
  await wait(150);
  const after = await readImage();
  const checked = await cdp.evaluate<boolean | null>(`(${box})()?.checked ?? null`);
  if (!after) {
    flag('census', `Crop to circle lost ${IMAGE}`);
    return;
  }
  const on = after.el.maskShape === 'circle';
  const label = `Crop to circle ${on ? 'on' : 'off'}`;
  if (TRACE) console.log(`  ${label}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  if (on === (before.el.maskShape === 'circle')) flag('census', `the Crop to circle box left maskShape at ${after.el.maskShape}`);
  if (checked !== on) flag('routing', `the Crop to circle box is ${checked ? '' : 'un'}checked with maskShape ${after.el.maskShape}`);
  if (after.radius !== (on ? '50%' : '')) flag('census', `${label} draws border-radius "${after.radius}"`);
  const geometry = (view: ImageView) => JSON.stringify([view.el.x, view.el.y, view.el.w, view.el.h, view.el.sourceBox ?? null]);
  if (on) {
    const win = { x: after.el.x, y: after.el.y, w: after.el.w, h: after.el.h };
    if (win.w !== win.h) flag('census', `${label} left a ${win.w}x${win.h} window`);
    if (!near(win.x + win.w / 2, before.el.x + before.el.w / 2)
      || !near(win.y + win.h / 2, before.el.y + before.el.h / 2)) {
      flag('census', `${label} moved the window's centre: ${geometry(before)} -> ${geometry(after)}`);
    }
    const was = pictureOf(before);
    const is = pictureOf(after);
    if (!near(was.x + was.w / 2, is.x + is.w / 2) || !near(was.y + was.h / 2, is.y + is.h / 2)) {
      flag('census', `${label} moved the picture's centre from ${JSON.stringify(was)} to ${JSON.stringify(is)}`);
    }
    if (is.w < was.w - 1 || is.h < was.h - 1) {
      flag('census', `${label} shrank the picture from ${JSON.stringify(was)} to ${JSON.stringify(is)}`);
    }
    // Rounding moves each side by at most half a pixel.
    const natural = after.natural ?? before.natural;
    if (natural && Math.abs(is.w - (is.h * natural.w) / natural.h) > 1 + natural.w / natural.h) {
      flag('census', `${label} drew the ${natural.w}x${natural.h} picture at ${is.w}x${is.h}`);
    }
    if (!covers(is, win)) {
      flag('census', `${label} left the window ${JSON.stringify(win)} outside the picture ${JSON.stringify(is)}`);
    }
  } else if (geometry(after) !== geometry(before)) {
    flag('census', `${label} changed the geometry: ${geometry(before)} -> ${geometry(after)}`);
  }
  if (await masking() !== cropping) flag('routing', `${label} turned crop mode from ${cropping} to ${await masking()}`);
  const selection = (await session.state()).selection;
  if (selection.join() !== IMAGE) flag('routing', `${label} changed the selection to [${selection.join(', ')}]`);
  const othersAfter = await others();
  if (othersAfter !== othersBefore) {
    flag('census', `${label} changed another object; diff: ${firstDiff(othersBefore, othersAfter)}`);
  }
  // The box keeps the keyboard, and with it Backspace and Delete.
  await clickPicture();
}

/**
 * Begin a drag, a resize, a crop or a marquee with real input and abandon it
 * part-way: the pointer is cancelled, Escape is pressed, or the window loses
 * focus, and the button comes up after. Whether an abandoned gesture keeps
 * what it did so far is not decided here. Either way it must end, leaving
 * nothing of it on the canvas, and be at most one undo step: one Cmd/Ctrl+Z
 * puts the deck back exactly. A cancelled pointer ends it at once: the
 * motion after the cancel edits nothing. The walk goes on from there, undone.
 *
 * Chromium cancels a mouse pointer only when a native drag takes it over,
 * which CDP cannot start. So that cancel is dispatched as the browser sends
 * it: pointercancel at the canvas holding the capture, and no pointerup,
 * mouseup or click for the release after it.
 */
async function abandonGesture(
  next: () => number,
  pre: CrossState,
  flag: (oracle: 'routing' | 'undoRoundTrip' | 'census', detail: string) => void,
): Promise<'same' | 'resync'> {
  const { cdp } = session;
  const targets = targetsOn(pre);
  const gestures: Array<'drag' | 'resize' | 'crop' | 'marquee'> = ['marquee'];
  if (targets.length > 0) gestures.push('drag', 'resize');
  if (pre.elements.includes(IMAGE)) gestures.push('crop');
  const gesture = pick(next, gestures);
  const how = pick<'pointer-cancel' | 'Escape' | 'blur'>(next, ['pointer-cancel', 'Escape', 'blur']);
  const centre = (selector: string) => cdp.evaluate<{ x: number; y: number } | null>(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);

  let what: string = gesture;
  let from: { x: number; y: number } | null;
  if (gesture === 'crop') {
    if (!await enterCrop(flag)) return 'same';
    // An edge strip (a third of the way along, clear of the handles) or the
    // inside of the window, which pans.
    const edge = pick(next, ['n', 'e', 's', 'w', 'inside']);
    what = edge === 'inside' ? 'crop pan' : `crop of the ${edge} edge`;
    from = await cdp.evaluate<{ x: number; y: number } | null>(`(() => {
      const node = document.querySelector('.overlay-layer ${edge === 'inside' ? '.sel-box.masking' : `.mask-edge-${edge}`}');
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return {
        x: r.left + r.width * ${edge === 'e' || edge === 'w' ? 0.5 : 0.3},
        y: r.top + r.height * ${edge === 'n' || edge === 's' ? 0.5 : 0.3},
      };
    })()`);
  } else {
    await session.clickEmpty();
    if (gesture === 'marquee') {
      const layer = await session.boxOf('.slide-layer');
      from = { x: layer.left + layer.width * 0.55, y: layer.top + layer.height * 0.94 };
    } else {
      const target = pick(next, targets);
      what = `${gesture} of ${target}`;
      if (gesture === 'resize') {
        await session.click(target);
        const corner = pick(next, ['nw', 'ne', 'sw', 'se']);
        what += ` by its ${corner} handle`;
        from = await centre(`.overlay-layer .handle-${corner}[data-element-id="${target}"]`);
      } else {
        from = await centre(elementSelector(target));
      }
    }
  }
  if (!from) {
    flag('routing', `there is nothing to press for a ${what}`);
    return 'same';
  }
  const start = from;

  const before = await session.deckSnapshot();
  const scale = await slideScale();
  // Slide pixels, each axis well past the drag threshold by the second move.
  const offset = () => (next() < 0.5 ? -1 : 1) * (30 + next() * 60) * scale;
  const dx = offset();
  const dy = offset();
  const label = `${how} part-way through a ${what}`;
  if (TRACE) console.log(`  ${label}`);
  const pointer = await cdp.beginDrag(start.x, start.y);
  const move = async (i: number) => {
    await pointer.moveTo(start.x + (dx * i) / 4, start.y + (dy * i) / 4);
    await wait(16);
  };
  await move(1);
  await move(2);
  /** The deck once the pointer was cancelled: the motion after it is no gesture. */
  let cancelled: string | null = null;
  if (how === 'Escape') {
    await session.key('Escape', 27);
  } else if (how === 'blur') {
    await cdp.evaluate(`window.dispatchEvent(new FocusEvent('blur'))`);
  } else {
    await cdp.evaluate(`(() => {
      document.querySelector('.canvas-host').dispatchEvent(new PointerEvent('pointercancel', {
        pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true,
      }));
      window.__xcSwallow = (event) => event.stopImmediatePropagation();
      for (const type of ['pointerup', 'mouseup', 'click']) {
        window.addEventListener(type, window.__xcSwallow, true);
      }
      return true;
    })()`);
    await wait(100);
    cancelled = await session.deckSnapshot();
  }
  try {
    await move(3);
    await move(4);
    await pointer.drop();
  } finally {
    if (how === 'pointer-cancel') {
      await cdp.evaluate(`(() => {
        for (const type of ['pointerup', 'mouseup', 'click']) {
          window.removeEventListener(type, window.__xcSwallow, true);
        }
        return true;
      })()`);
    }
  }
  await wait(150);

  if (cancelled !== null) {
    const now = await session.deckSnapshot();
    if (now !== cancelled) {
      flag('routing', `${label}: the pointer kept editing after it was cancelled; diff: ${firstDiff(cancelled, now)}`);
    }
  }
  const leftovers = await cdp.evaluate<string[]>(`[...document.querySelectorAll(
    '.overlay-layer .marquee, .overlay-layer .guide, .overlay-layer .measure')].map((node) => node.className)`);
  if (leftovers.length > 0) flag('routing', `${label} left ${leftovers.join(', ')} on the canvas`);
  if (await session.deckSnapshot() === before) return 'same';
  await session.chord('z', 'KeyZ', 90, MOD);
  let undone = await session.deckSnapshot();
  for (let poll = 0; poll < 10 && undone !== before; poll++) {
    await wait(200);
    undone = await session.deckSnapshot();
  }
  if (undone !== before) {
    flag('undoRoundTrip', `one undo after ${label} did not put the deck back; diff: ${firstDiff(before, undone)}`);
  }
  return 'resync';
}

/**
 * Select the image with real clicks and choose a fit from the Props tab's Fit
 * strip. An uncropped image takes the choice, draws it, and the strip shows
 * it; a cropped one has the strip off and keeps its fit. Either way the
 * selection and every other object stay as they were.
 */
async function setFit(
  next: () => number,
  flag: (oracle: 'routing' | 'census', detail: string) => void,
): Promise<void> {
  const { cdp } = session;
  const value = pick(next, ['contain', 'cover', 'fill']);
  await session.clickEmpty();
  await session.click(IMAGE);
  const selected = (await session.state()).selection;
  if (selected.join() !== IMAGE) {
    flag('routing', `clicking ${IMAGE} selected [${selected.join(', ')}]`);
    return;
  }
  const read = () => cdp.evaluate<{ fit: string | null; cropped: boolean; drawn: string | null; others: string }>(`(() => {
    const elements = window.store.slide.elements;
    const el = elements.find((e) => e.id === ${JSON.stringify(IMAGE)});
    const img = document.querySelector('.slide-layer [data-element-id="${IMAGE}"] img');
    return {
      fit: el ? el.fit : null,
      cropped: Boolean(el && el.sourceBox),
      drawn: img ? img.style.objectFit : null,
      others: JSON.stringify(elements.filter((e) => e.id !== ${JSON.stringify(IMAGE)})),
    };
  })()`);
  const field = `[...document.querySelectorAll('.editor-inspector select[aria-label="Fit"]')]
    .map((select) => select.closest('.field-segmented'))
    .find((node) => node && node.getClientRects().length > 0)`;
  const before = await read();
  const clicked = await clickFound(`() => (${field})?.querySelector('.segment-button[data-value="${value}"]')`, `Fit: ${value}`);
  if (!clicked) {
    flag('routing', `the Props tab shows no Fit control for ${IMAGE}`);
    return;
  }
  await wait(120);
  if (TRACE) console.log(`  Fit: ${value} on ${IMAGE}, ${before.cropped ? 'cropped' : 'uncropped'} at ${before.fit}`);
  const after = await read();
  const control = await cdp.evaluate<{ pressed: string | null; disabled: boolean }>(`(() => {
    const field = ${field};
    return {
      pressed: field?.querySelector('.segment-button[aria-pressed="true"]')?.dataset.value ?? null,
      disabled: field?.querySelector('select')?.disabled === true,
    };
  })()`);
  if (before.cropped) {
    if (!control.disabled) flag('routing', `the Fit control is on for cropped ${IMAGE}`);
    if (after.fit !== before.fit) flag('census', `Fit: ${value} rewrote cropped ${IMAGE} from ${before.fit} to ${after.fit}`);
  } else {
    if (after.fit !== value) flag('census', `Fit: ${value} stored ${after.fit} on ${IMAGE}`);
    if (after.drawn !== value) flag('census', `Fit: ${value} on ${IMAGE} draws object-fit ${after.drawn}`);
    if (control.pressed !== value) flag('routing', `after Fit: ${value} the control shows ${control.pressed}`);
  }
  const selection = (await session.state()).selection;
  if (selection.join() !== IMAGE) flag('routing', `Fit: ${value} changed the selection to [${selection.join(', ')}]`);
  if (after.others !== before.others) {
    flag('census', `Fit: ${value} changed another object; diff: ${firstDiff(before.others, after.others)}`);
  }
}

function firstDiff(a: string, b: string): string {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index++;
  const from = Math.max(0, index - 60);
  return `…${a.slice(from, index + 120)}… vs …${b.slice(from, index + 120)}…`;
}
