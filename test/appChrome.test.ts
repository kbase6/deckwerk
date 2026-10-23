import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

/** The custom properties declared in the block that `selector {` opens. */
function tokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('shared application chrome', () => {
  it('is loaded by every interactive renderer', () => {
    for (const entry of [
      'src/renderer/editor/main.ts',
      'src/renderer/collab/main.ts',
      'src/renderer/presenter/main.ts',
      'src/renderer/raster/main.ts',
      'src/renderer/trim/main.ts',
    ]) {
      expect(source(entry)).toContain("import '../appChrome.css';");
    }
  });

  it('keeps auxiliary windows from redefining the shared palette or buttons', () => {
    for (const stylesheet of [
      'src/renderer/presenter/presenter.css',
      'src/renderer/raster/raster.css',
      'src/renderer/trim/trim.css',
    ]) {
      const css = source(stylesheet);
      expect(css).not.toMatch(/:root\s*\{/);
      expect(css).not.toMatch(/(?:^|\n)button\s*\{/);
    }
    // The editor's sheets load after appChrome.css, so a palette token declared
    // again there wins in the editor alone and a palette change misses it.
    for (const stylesheet of [
      'src/renderer/editor/editor.css',
      'src/renderer/collab/collab.css',
      'src/renderer/collab/mobile.css',
    ]) {
      expect(source(stylesheet)).not.toMatch(/--(?:bg|panel|panel-2|line|text|muted|accent|accent-soft|green|yellow|danger)\s*:/);
    }
  });

  it('keeps chrome text and muted text legible on every surface in both themes', () => {
    const dark = tokens(source('src/renderer/appChrome.css'), ':root');
    const light = { ...dark, ...tokens(source('src/renderer/lightTheme.css'), ':root[data-ui-theme="light"]') };
    for (const [theme, palette] of Object.entries({ dark, light })) {
      for (const text of ['--text', '--muted']) {
        for (const surface of ['--bg', '--panel', '--panel-2']) {
          expect(contrast(palette[text], palette[surface]), `${theme} ${text} on ${surface}`)
            .toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('uses the same semantic action variants in Speaker View', () => {
    // The markup moved into the component the desktop window and the browser
    // collaboration client now share, so both get the same button variants.
    const view = source('src/renderer/presenter/speakerView.ts');
    expect(view).toContain('class="speaker-next-button primary"');
    expect(view).toContain('class="speaker-end danger"');
  });

  it('reserves the macOS traffic-light gutter only in the inset desktop window', () => {
    const css = source('src/renderer/editor/editor.css');
    const shell = source('src/renderer/editor/main.ts');
    expect(css).toContain('body.mac-titlebar #toolbar { padding-left: 84px; }');
    expect(shell).toContain("document.body.classList.add('mac-titlebar')");
    expect(css.match(/padding-left:\s*84px/g)).toHaveLength(1);
  });
});
