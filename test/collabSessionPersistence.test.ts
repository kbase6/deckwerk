import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as deckStore from '../src/main/deckStore.js';
import * as serializer from '../src/main/deckSerializer.js';
import { emptyDeck } from '../src/shared/deck.js';
import { CollabSession } from '../src/server/collabSession.js';

let dir: string;
let session: CollabSession;
const releases: Array<() => void> = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'collab-persist-'));
  await deckStore.saveDeck(dir, emptyDeck('Original'));
  await writeFile(join(dir, 'theme.css'), '/* original */');
  session = await CollabSession.open(dir);
});
afterEach(async () => {
  releases.splice(0).forEach(release => release());
  vi.restoreAllMocks();
  await session.close();
  await rm(dir, { recursive: true, force: true });
});

describe('collaboration persistence', () => {
  it('waits for document and theme writes already in flight', async () => {
    const originalDeck = serializer.writeDeckChunks;
    const originalTheme = deckStore.saveTheme;
    vi.spyOn(serializer, 'writeDeckChunks').mockImplementation(async (...args) => {
      await new Promise<void>(resolve => releases.push(resolve));
      return originalDeck(...args);
    });
    vi.spyOn(deckStore, 'saveTheme').mockImplementation(async (...args) => {
      await new Promise<void>(resolve => releases.push(resolve));
      return originalTheme(...args);
    });
    session.applyOps([{ op: 'updateDeck', title: 'Saved' }]);
    session.saveThemeCss('/* saved */');
    const first = session.flush();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    let finished = false;
    const second = session.flush().then(() => { finished = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(finished).toBe(false);
    releases.splice(0).forEach(release => release());
    await Promise.all([first, second]);
    expect(JSON.parse(await readFile(join(dir, 'deck.json'), 'utf8')).title).toBe('Saved');
    expect(await readFile(join(dir, 'theme.css'), 'utf8')).toBe('/* saved */');
  });

  it('serializes older and newer deck writes so the newest edit stays on disk', async () => {
    const original = serializer.writeDeckChunks;
    let calls = 0;
    vi.spyOn(serializer, 'writeDeckChunks').mockImplementation(async (...args) => {
      calls++;
      if (calls === 1) await new Promise<void>(resolve => releases.push(resolve));
      return original(...args);
    });
    session.applyOps([{ op: 'updateDeck', title: 'Older' }]);
    const first = session.flush();
    await vi.waitFor(() => expect(calls).toBe(1));
    session.applyOps([{ op: 'updateDeck', title: 'Newer' }]);
    const second = session.flush();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(calls).toBe(1);
    releases.splice(0).forEach(release => release());
    await Promise.all([first, second]);
    expect(JSON.parse(await readFile(join(dir, 'deck.json'), 'utf8')).title).toBe('Newer');
  });

  it('reports a failed deck write and retries it on the next flush', async () => {
    const write = vi.spyOn(serializer, 'writeDeckChunks').mockRejectedValueOnce(new Error('disk full'));
    session.applyOps([{ op: 'updateDeck', title: 'Retried' }]);
    await expect(session.flush()).rejects.toThrow('disk full');
    write.mockRestore();
    await session.flush();
    expect(JSON.parse(await readFile(join(dir, 'deck.json'), 'utf8')).title).toBe('Retried');
  });

  it('serializes theme writes so an older save cannot replace the latest CSS', async () => {
    const original = deckStore.saveTheme;
    let calls = 0;
    vi.spyOn(deckStore, 'saveTheme').mockImplementation(async (...args) => {
      calls++;
      if (calls === 1) await new Promise<void>(resolve => releases.push(resolve));
      return original(...args);
    });
    session.saveThemeCss('/* older */');
    await vi.waitFor(() => expect(calls).toBe(1));
    session.saveThemeCss('/* newer */');
    const saving = session.flush();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(calls).toBe(1);
    releases.splice(0).forEach(release => release());
    await saving;
    expect(await readFile(join(dir, 'theme.css'), 'utf8')).toBe('/* newer */');
  });

  it('reports a failed theme write and retries it on the next flush', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const write = vi.spyOn(deckStore, 'saveTheme').mockRejectedValue(new Error('disk full'));
    session.saveThemeCss('/* retried */');
    await expect(session.flush()).rejects.toThrow('disk full');
    write.mockRestore();
    await session.flush();
    expect(await readFile(join(dir, 'theme.css'), 'utf8')).toBe('/* retried */');
  });
});
