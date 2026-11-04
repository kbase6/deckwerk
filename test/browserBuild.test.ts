import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { build, createLogger } from 'vite';
import cpp from 'shiki/langs/cpp.mjs';
import { browserDependencies } from '../src/browserBuild.js';

let output = '';
beforeEach(async () => { output = await mkdtemp(join(tmpdir(), 'deckwerk-browser-build-')); });
afterEach(async () => { await rm(output, { recursive: true, force: true }); });

it('ships one local grammar binary without Node imports or oversized JavaScript files', async () => {
  const warnings: string[] = [];
  const logger = createLogger('silent');
  logger.warn = (message) => { warnings.push(message); };
  await build({
    configFile: resolve('vite.collab.config.ts'),
    customLogger: logger,
    build: { outDir: output, emptyOutDir: true, reportCompressedSize: false },
  });
  expect(warnings.filter((message) => /externalized for browser|chunks are larger/.test(message))).toEqual([]);
  const files = await readdir(join(output, 'app'));
  const binaries = files.filter((file) => file.endsWith('.wasm'));
  expect(binaries).toHaveLength(1);
  expect(binaries[0]).toMatch(/^harper_wasm_bg-.*\.wasm$/);
  const oversized: string[] = [];
  for (const file of files.filter((file) => file.endsWith('.js'))) {
    const code = await readFile(join(output, 'app', file), 'utf8');
    if (Buffer.byteLength(code) > 500_000) oversized.push(file);
    expect(code.includes('data:application/wasm;base64,'), file).toBe(false);
  }
  expect(oversized).toEqual([]);
  const worker = files.find((file) => /^spellcheckWorker-.*\.js$/.test(file));
  expect(worker).toBeDefined();
  const workerCode = await readFile(join(output, 'app', worker!), 'utf8');
  expect(workerCode.includes(binaries[0])).toBe(true);
}, 60_000);

it('preserves the complete C++ grammar when removing redundant JSON escaping', async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [browserDependencies()],
    build: {
      outDir: output,
      write: false,
      lib: { entry: createRequire(import.meta.url).resolve('shiki/langs/cpp.mjs'), formats: ['es'] },
    },
  });
  const bundle = Array.isArray(result) ? result[0] : result;
  if (!('output' in bundle)) throw new Error('Expected a completed build');
  const chunk = bundle.output.find((file) => file.type === 'chunk');
  expect(chunk?.type).toBe('chunk');
  const url = `data:text/javascript;base64,${Buffer.from(chunk!.code).toString('base64')}`;
  const compiled = await import(/* @vite-ignore */ url);
  expect(compiled.default).toStrictEqual(cpp);
}, 60_000);
