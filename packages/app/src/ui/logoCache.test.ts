import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import {
  MAX_PARALLEL,
  MISS_TTL_MS,
  cachedLogoUri,
  clearLogoCache,
  ensureLogo,
  fileNameFor,
  forgetLogoMisses,
  initLogoCache,
  logoCacheStats,
  logoFailedToRender,
  looksLikeImage,
  replaceLogo,
  resetLogo,
  resetLogoCacheForTests,
  subscribeLogo,
  whenLogoQueueIdle,
} from './logoCache.js';
import type { LogoFileStore } from './logoCache.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HTML = new TextEncoder().encode('<!doctype html><html>');

/**
 * Et filsystem i hukommelsen. `answers` siger hvad hver adresse svarer:
 * bytes for et svar, `null` for en fejl (404, ingen forbindelse).
 */
function fakeStore(answers: Record<string, Uint8Array | null>) {
  const files = new Map<string, Uint8Array>();
  const downloads: string[] = [];
  let open = 0;
  let peakOpen = 0;
  let release: (() => void) | null = null;
  const store: LogoFileStore = {
    async download(url, fileName) {
      downloads.push(url);
      open += 1;
      peakOpen = Math.max(peakOpen, open);
      if (release !== null) await new Promise<void>((resolve) => waiters.push(resolve));
      open -= 1;
      const body = answers[url];
      if (body === null || body === undefined) throw new Error(`404 ${url}`);
      const uri = `file:///logoer/${fileName}`;
      files.set(uri, body);
      return { uri, bytes: body.length, head: body.slice(0, 16) };
    },
    uriFor(fileName) {
      return `file:///logoer/${fileName}`;
    },
    async remove(uri) {
      files.delete(uri);
    },
    async removeAll() {
      files.clear();
    },
  };
  const waiters: Array<() => void> = [];
  return {
    store,
    files,
    downloads,
    peak: () => peakOpen,
    hold() {
      release = () => {
        for (const resolve of waiters.splice(0)) resolve();
      };
    },
    releaseAll() {
      release?.();
      release = null;
    },
  };
}

let db: SqlDatabase;

beforeEach(async () => {
  resetLogoCacheForTests();
  db = createTestDatabase();
  await migrate(db);
});

describe('hentning én gang', () => {
  it('henter den foerste adresse der svarer med et billede, og gemmer filen', async () => {
    const fake = fakeStore({ 'http://dead/dr1.png': null, 'https://logo/dr1.png': PNG });
    await initLogoCache(db, fake.store);

    ensureLogo('k1', ['http://dead/dr1.png', 'https://logo/dr1.png']);
    await whenLogoQueueIdle();

    expect(cachedLogoUri('k1')).toBe('file:///logoer/k1.png');
    expect(fake.downloads).toEqual(['http://dead/dr1.png', 'https://logo/dr1.png']);
    const rows = await db.getAllAsync<{ channel_key: string; url: string }>(
      'SELECT channel_key, url FROM logo_files',
    );
    expect(rows).toEqual([{ channel_key: 'k1', url: 'https://logo/dr1.png' }]);
  });

  it('roerer ikke netvaerket for en kanal der allerede har en fil', async () => {
    const fake = fakeStore({ 'https://logo/dr1.png': PNG });
    await initLogoCache(db, fake.store);
    ensureLogo('k1', ['https://logo/dr1.png']);
    await whenLogoQueueIdle();

    ensureLogo('k1', ['https://logo/dr1.png']);
    ensureLogo('k1', ['https://somewhere/else.png']);
    await whenLogoQueueIdle();

    expect(fake.downloads).toHaveLength(1);
  });

  it('kender filerne igen efter en genstart, fra databasen', async () => {
    const fake = fakeStore({ 'https://logo/dr1.png': PNG });
    await initLogoCache(db, fake.store);
    ensureLogo('k1', ['https://logo/dr1.png']);
    await whenLogoQueueIdle();

    resetLogoCacheForTests();
    const again = fakeStore({ 'https://logo/dr1.png': PNG });
    // Paa iPhone flytter appens mappe ved hver opdatering; stien bygges derfor
    // af filnavnet og mappen som den er nu, ikke af en gemt sti.
    again.store.uriFor = (fileName) => `file:///ny-mappe/logoer/${fileName}`;
    await initLogoCache(db, again.store);

    expect(cachedLogoUri('k1')).toBe('file:///ny-mappe/logoer/k1.png');
    ensureLogo('k1', ['https://logo/dr1.png']);
    await whenLogoQueueIdle();
    expect(again.downloads).toEqual([]);
  });

  it('afviser et svar der ikke er et billede, og gaar videre til naeste adresse', async () => {
    const fake = fakeStore({ 'http://panel/x.png': HTML, 'https://logo/x.png': PNG });
    await initLogoCache(db, fake.store);
    ensureLogo('k1', ['http://panel/x.png', 'https://logo/x.png']);
    await whenLogoQueueIdle();

    expect(cachedLogoUri('k1')).toBe('file:///logoer/k1.png');
    expect(fake.files.size).toBe(1);
  });

  it('fortaeller dem der lytter, naar filen er der', async () => {
    const fake = fakeStore({ 'https://logo/dr1.png': PNG });
    await initLogoCache(db, fake.store);
    let calls = 0;
    const stop = subscribeLogo('k1', () => {
      calls += 1;
    });
    ensureLogo('k1', ['https://logo/dr1.png']);
    await whenLogoQueueIdle();
    expect(calls).toBe(1);
    stop();
  });

  it('henter hoejst nogle faa ad gangen', async () => {
    const answers: Record<string, Uint8Array> = {};
    for (let index = 0; index < 10; index += 1) answers[`https://logo/${index}.png`] = PNG;
    const fake = fakeStore(answers);
    await initLogoCache(db, fake.store);
    fake.hold();
    for (let index = 0; index < 10; index += 1) ensureLogo(`k${index}`, [`https://logo/${index}.png`]);
    await Promise.resolve();
    expect(fake.downloads).toHaveLength(MAX_PARALLEL);
    fake.releaseAll();
    await whenLogoQueueIdle();
    expect(fake.peak()).toBe(MAX_PARALLEL);
    expect(logoCacheStats().count).toBe(10);
  });
});

describe('kanaler uden logo', () => {
  it('proeves ikke igen foer der er gaaet et doegn', async () => {
    const fake = fakeStore({ 'http://dead/a.png': null });
    await initLogoCache(db, fake.store);
    const start = 1_000_000;
    ensureLogo('k1', ['http://dead/a.png'], start);
    await whenLogoQueueIdle();
    expect(cachedLogoUri('k1')).toBeNull();
    expect(fake.downloads).toHaveLength(1);

    ensureLogo('k1', ['http://dead/a.png'], start + 60_000);
    await whenLogoQueueIdle();
    expect(fake.downloads).toHaveLength(1);

    ensureLogo('k1', ['http://dead/a.png'], Date.now() + MISS_TTL_MS + 1);
    await whenLogoQueueIdle();
    expect(fake.downloads).toHaveLength(2);
  });

  it('proeves med det samme naar adresserne er nye', async () => {
    const fake = fakeStore({ 'http://dead/a.png': null, 'https://logo/a.png': PNG });
    await initLogoCache(db, fake.store);
    ensureLogo('k1', ['http://dead/a.png']);
    await whenLogoQueueIdle();
    expect(cachedLogoUri('k1')).toBeNull();

    ensureLogo('k1', ['http://dead/a.png', 'https://logo/a.png']);
    await whenLogoQueueIdle();
    expect(cachedLogoUri('k1')).toBe('file:///logoer/k1.png');
  });

  it('proeves igen naar forsoegene glemmes', async () => {
    const fake = fakeStore({ 'http://dead/a.png': null });
    await initLogoCache(db, fake.store);
    ensureLogo('k1', ['http://dead/a.png']);
    await whenLogoQueueIdle();

    await forgetLogoMisses();
    ensureLogo('k1', ['http://dead/a.png']);
    await whenLogoQueueIdle();
    expect(fake.downloads).toHaveLength(2);
    expect(await db.getAllAsync('SELECT * FROM logo_misses')).toHaveLength(1);
  });

  it('husker forsoegene over en genstart', async () => {
    const fake = fakeStore({ 'http://dead/a.png': null });
    await initLogoCache(db, fake.store);
    ensureLogo('k1', ['http://dead/a.png']);
    await whenLogoQueueIdle();

    resetLogoCacheForTests();
    const again = fakeStore({ 'http://dead/a.png': null });
    await initLogoCache(db, again.store);
    ensureLogo('k1', ['http://dead/a.png']);
    await whenLogoQueueIdle();
    expect(again.downloads).toEqual([]);
  });
});

describe('eget valg og fejl', () => {
  it('erstatter filen med brugerens valg og fjerner den gamle', async () => {
    const fake = fakeStore({ 'https://logo/a.png': PNG, 'https://mit/a.png': PNG });
    await initLogoCache(db, fake.store);
    ensureLogo('k1', ['https://logo/a.png']);
    await whenLogoQueueIdle();

    expect(await replaceLogo('k1', 'https://mit/a.png')).toBe(true);
    expect(cachedLogoUri('k1')).toBe('file:///logoer/k1.png');
    const rows = await db.getAllAsync<{ url: string }>('SELECT url FROM logo_files');
    expect(rows).toEqual([{ url: 'https://mit/a.png' }]);
    expect(fake.files.size).toBe(1);
  });

  it('siger fra naar valget ikke kan hentes, og lader kanalen staa uden', async () => {
    const fake = fakeStore({ 'https://logo/a.png': PNG, 'https://mit/a.png': null });
    await initLogoCache(db, fake.store);
    ensureLogo('k1', ['https://logo/a.png']);
    await whenLogoQueueIdle();

    expect(await replaceLogo('k1', 'https://mit/a.png')).toBe(false);
    expect(cachedLogoUri('k1')).toBeNull();
    // Naeste tegning proever raekken igen — med valget foerst, som kalderen saetter den.
    ensureLogo('k1', ['https://mit/a.png', 'https://logo/a.png']);
    await whenLogoQueueIdle();
    expect(cachedLogoUri('k1')).toBe('file:///logoer/k1.png');
  });

  it('glemmer fil og forsoeg naar valget fjernes', async () => {
    const fake = fakeStore({ 'https://mit/a.png': PNG });
    await initLogoCache(db, fake.store);
    await replaceLogo('k1', 'https://mit/a.png');
    await resetLogo('k1');
    expect(cachedLogoUri('k1')).toBeNull();
    expect(fake.files.size).toBe(0);
    expect(await db.getAllAsync('SELECT * FROM logo_files')).toHaveLength(0);
  });

  it('en fil der ikke kan tegnes, fjernes og taelles som proevet', async () => {
    const fake = fakeStore({ 'https://logo/a.png': PNG });
    await initLogoCache(db, fake.store);
    ensureLogo('k1', ['https://logo/a.png']);
    await whenLogoQueueIdle();

    await logoFailedToRender('k1', ['https://logo/a.png']);
    expect(cachedLogoUri('k1')).toBeNull();
    ensureLogo('k1', ['https://logo/a.png']);
    await whenLogoQueueIdle();
    expect(fake.downloads).toHaveLength(1);
  });

  it('rydning sletter alt og taeller forfra', async () => {
    const fake = fakeStore({ 'https://logo/a.png': PNG, 'http://dead/b.png': null });
    await initLogoCache(db, fake.store);
    ensureLogo('k1', ['https://logo/a.png']);
    ensureLogo('k2', ['http://dead/b.png']);
    await whenLogoQueueIdle();
    expect(logoCacheStats()).toEqual({ count: 1, bytes: PNG.length, missing: 1 });

    await clearLogoCache();
    expect(logoCacheStats()).toEqual({ count: 0, bytes: 0, missing: 0 });
    expect(fake.files.size).toBe(0);
    expect(await db.getAllAsync('SELECT * FROM logo_files')).toHaveLength(0);
    expect(await db.getAllAsync('SELECT * FROM logo_misses')).toHaveLength(0);
  });
});

describe('filnavne og billedformater', () => {
  it('bygger et filnavn af noeglen og adressens endelse', () => {
    expect(fileNameFor('src-1:42', 'https://logo/dr1.png?x=1')).toBe('src-1_42.png');
    expect(fileNameFor('src-1:42', 'https://logo/dr1.JPG')).toBe('src-1_42.jpg');
    expect(fileNameFor('src-1:42', 'https://logo/dr1')).toBe('src-1_42.png');
  });

  it('kender billedformaterne telefonen kan tegne', () => {
    expect(looksLikeImage(PNG)).toBe(true);
    expect(looksLikeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLikeImage(new TextEncoder().encode('GIF89a'))).toBe(true);
    expect(looksLikeImage(new TextEncoder().encode('RIFF....WEBPVP8 '))).toBe(true);
    expect(looksLikeImage(HTML)).toBe(false);
    expect(looksLikeImage(new TextEncoder().encode('<svg xmlns='))).toBe(false);
    expect(looksLikeImage(new Uint8Array())).toBe(false);
  });
});
