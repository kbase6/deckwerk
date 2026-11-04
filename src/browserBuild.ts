import { transformWithEsbuild, type Plugin } from 'vite';

/** Remove Node-only loading and redundant data encoding from browser dependencies. */
export function browserDependencies(): Plugin {
  return {
    name: 'deckwerk-browser-dependencies',
    enforce: 'pre',
    async transform(code, id) {
      if (id.includes('/harper.js/dist/BinaryModule-')) {
        const transformed = await transformWithEsbuild(code, id, {
          loader: 'js', define: { process: 'undefined' }, minifySyntax: true,
        });
        return { code: transformed.code, map: JSON.stringify(transformed.map) };
      }
      if (/\/@shikijs\/langs\/dist\/cpp(?:-macro)?\.mjs$/.test(id)) {
        // Shiki's JSON strings have an extra layer of escaping that objects do not need.
        return code.replace(/JSON\.parse\(("(?:\\.|[^"\\])*")\)/g, (expression, literal: string) => {
          const json = JSON.parse(literal) as string;
          // An object literal treats this key differently from JSON.parse.
          return json.includes('"__proto__"') ? expression : `(${JSON.stringify(JSON.parse(json))})`;
        });
      }
    },
  };
}

/** Separate large features while keeping optional grammars loaded on demand. */
export function browserChunk(id: string): string | undefined {
  if (id.includes('/node_modules/@codemirror/')) return 'code-editor';
  if (id.includes('/node_modules/katex/')) return 'math-renderer';
  if (id.endsWith('/shared/katexInlineCss.ts')) return 'authoring-math-fonts';
  if (id.endsWith('/shared/katexInline.ts')) return 'authoring-math-runtime';
  if (id.endsWith('/@shikijs/langs/dist/cpp-macro.mjs')) return 'cpp-macro';
  if (id.endsWith('/renderer/editor/canvas.ts')) return 'canvas';
  if (id.endsWith('/renderer/editor/inspector.ts')) return 'inspector';
}
