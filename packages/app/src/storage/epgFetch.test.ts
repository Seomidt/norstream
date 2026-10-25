import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EPG_MAX_AGE_MS,
  getEpgFreshness,
  markEpgFetched,
  needsEpgFetch,
  needsArchiveFetch,
  needsShortEpg,
} from './epgFetch.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

const NOW = new Date('2026-09-05T18:00:00.000Z');

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('needsEpgFetch', () => {
  it('regel 1: der er aldrig hentet for kanalen', () => {
    expect(needsEpgFetch({ fetchedAt: null, latestStopMs: null }, NOW)).toBe(true);
  });

  it('regel 1 gaelder "ikke hentet", ikke "ingen programmer"', () => {
    // En kanal panelet ikke har EPG for er hentet for nyligt og skal derfor
    // ikke hentes igen. Den anden laesning ville give et kald per rendering.
    const justFetched = { fetchedAt: NOW.getTime() - 60_000, latestStopMs: null };
    expect(needsEpgFetch(justFetched, NOW)).toBe(false);
  });

  it('regel 2: hentningen er 30 minutter gammel', () => {
    const fresh = { fetchedAt: NOW.getTime() - EPG_MAX_AGE_MS + 1, latestStopMs: null };
    const stale = { fetchedAt: NOW.getTime() - EPG_MAX_AGE_MS, latestStopMs: null };
    expect(needsEpgFetch(fresh, NOW)).toBe(false);
    expect(needsEpgFetch(stale, NOW)).toBe(true);
  });

  it('regel 3: det nyeste gemte program er allerede slut', () => {
    const ended = { fetchedAt: NOW.getTime() - 60_000, latestStopMs: NOW.getTime() };
    const running = { fetchedAt: NOW.getTime() - 60_000, latestStopMs: NOW.getTime() + 1 };
    expect(needsEpgFetch(ended, NOW)).toBe(true);
    expect(needsEpgFetch(running, NOW)).toBe(false);
  });

  it('ingen af reglerne: DR1 aabnet tre gange paa en aften henter én gang', () => {
    const cached = {
      fetchedAt: NOW.getTime() - 5 * 60_000,
      latestStopMs: NOW.getTime() + 45 * 60_000,
    };
    expect(needsEpgFetch(cached, NOW)).toBe(false);
  });
});

describe('getEpgFreshness', () => {
  it('giver null paa begge felter for en ukendt kanal', async () => {
    await expect(getEpgFreshness(db, '247634')).resolves.toEqual({
      fetchedAt: null,
      latestStopMs: null,
    });
  });

  it('laeser hentetid og seneste sluttidspunkt i ét opslag', async () => {
    await markEpgFetched(db, '247634', NOW);
    for (const [start, stop] of [
      [NOW.getTime(), NOW.getTime() + 1800_000],
      [NOW.getTime() + 1800_000, NOW.getTime() + 5400_000],
    ]) {
      await db.runAsync(
        'INSERT INTO programmes (channel_id, start_ms, stop_ms, title) VALUES (?, ?, ?, ?)',
        ['247634', start as number, stop as number, 'Program'],
      );
    }

    await expect(getEpgFreshness(db, '247634')).resolves.toEqual({
      fetchedAt: NOW.getTime(),
      latestStopMs: NOW.getTime() + 5400_000,
    });
  });

  it('holder kanalerne adskilt', async () => {
    await markEpgFetched(db, '247634', NOW);
    await expect(getEpgFreshness(db, '247635')).resolves.toEqual({
      fetchedAt: null,
      latestStopMs: null,
    });
  });
});

describe('markEpgFetched', () => {
  it('overskriver en tidligere hentetid', async () => {
    await markEpgFetched(db, '247634', new Date(NOW.getTime() - 3600_000));
    await markEpgFetched(db, '247634', NOW);
    const { fetchedAt } = await getEpgFreshness(db, '247634');
    expect(fetchedAt).toBe(NOW.getTime());
  });
});

describe('needsShortEpg', () => {
  const NOW = new Date('2026-09-06T20:00:00.000Z');
  const HOUR = 60 * 60_000;

  const gammel = { fetchedAt: null, latestStopMs: null };

  it('springer den korte over naar den fulde tabel er hentet for ti minutter siden', () => {
    expect(needsShortEpg(gammel, NOW.getTime() - 10 * 60_000, NOW)).toBe(false);
  });

  it('henter nu/naeste efter 30 minutter selv om hele tabellens seks timer ikke er gaaet', () => {
    expect(needsShortEpg(gammel, NOW.getTime() - EPG_MAX_AGE_MS + 1, NOW)).toBe(false);
    expect(needsShortEpg(gammel, NOW.getTime() - EPG_MAX_AGE_MS, NOW)).toBe(true);
    expect(needsShortEpg(gammel, NOW.getTime() - HOUR, NOW)).toBe(true);
  });

  it('henter den korte naar den fulde tabel er blevet gammel', () => {
    expect(needsShortEpg(gammel, NOW.getTime() - 7 * HOUR, NOW)).toBe(true);
  });

  it('henter den korte naar den fulde tabel aldrig er hentet', () => {
    expect(needsShortEpg(gammel, null, NOW)).toBe(true);
  });

  it('foelger stadig den korte oversigts egen friskhed', () => {
    const frisk = { fetchedAt: NOW.getTime() - 60_000, latestStopMs: NOW.getTime() + HOUR };
    // Fuld tabel gammel, kort oversigt frisk: der er intet at hente.
    expect(needsShortEpg(frisk, NOW.getTime() - 7 * HOUR, NOW)).toBe(false);
  });

  it('bruger den nyeste gyldige hentning og fornyer udloebet daekning straks', () => {
    const oldShort = { fetchedAt: NOW.getTime() - HOUR, latestStopMs: NOW.getTime() + HOUR };
    expect(needsShortEpg(oldShort, NOW.getTime() - 60_000, NOW)).toBe(false);
    expect(needsShortEpg({ ...oldShort, latestStopMs: NOW.getTime() }, NOW.getTime() - 60_000, NOW)).toBe(true);
  });

  it('fremtidige eller ugyldige hentetider maa ikke fastholde en gammel oversigt', () => {
    const future = NOW.getTime() + HOUR;
    expect(needsShortEpg({ fetchedAt: future, latestStopMs: null }, future, NOW)).toBe(true);
    expect(needsShortEpg({ fetchedAt: NaN, latestStopMs: null }, Infinity, NOW)).toBe(true);
    expect(needsShortEpg({ fetchedAt: future, latestStopMs: null }, NOW.getTime() - 60_000, NOW)).toBe(false);
    expect(needsArchiveFetch(future, NOW)).toBe(true);
  });

  it('fornyer kort og fuld cache én gang efter vintertid uden at flytte epoch-tider', () => {
    const transition = Date.parse('2026-10-25T01:00:00Z');
    const before = transition - 5 * 60_000;
    const after = new Date(transition + 5 * 60_000);
    const offset = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(function (this: Date) {
      return this.getTime() < transition ? -120 : -60;
    });
    try {
      expect(needsShortEpg({ fetchedAt: before, latestStopMs: after.getTime() + HOUR }, before, after)).toBe(true);
      expect(needsArchiveFetch(before, after)).toBe(true);
      expect(needsShortEpg({ fetchedAt: after.getTime(), latestStopMs: null }, before, after)).toBe(false);
      expect(needsArchiveFetch(after.getTime(), after)).toBe(false);
    } finally { offset.mockRestore(); }
  });
});
