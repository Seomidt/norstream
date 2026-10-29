import { beforeEach, describe, expect, it } from 'vitest';
import {
  EPG_MAX_AGE_MS,
  getEpgFreshness,
  markEpgFetched,
  crossedTimeChange,
  nearTimeChange,
  needsArchiveFetch,
  needsEpgFetch,
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

  it('springer den korte over naar den fulde tabel er frisk', () => {
    // Den fulde tabel daekker dage frem og tilbage. De tolv naeste programmer
    // tilfoejer intet, og et kald per kanal hver halve time er spild af
    // panelets ene forbindelse.
    expect(needsShortEpg(gammel, NOW.getTime() - HOUR, NOW)).toBe(false);
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
});

/** Danmarks zone uafhaengigt af maskinen testen koerer paa. */
const copenhagen = (ms: number): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms));
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'));
  return Math.round((wall - Math.floor(ms / 60_000) * 60_000) / 60_000);
};

describe('sommer- og vintertid', () => {
  // Vintertid 25. oktober 2026 kl. 03 (01:00 UTC); sommertid 28. marts 2027 kl. 02 (01:00 UTC).
  const WINTER_SWITCH = Date.parse('2026-10-25T01:00:00.000Z');
  const SUMMER_SWITCH = Date.parse('2027-03-28T01:00:00.000Z');
  const MIN = 60_000;

  it('zonen i testen er rigtig: 120 om sommeren, 60 om vinteren', () => {
    expect(copenhagen(WINTER_SWITCH - MIN)).toBe(120);
    expect(copenhagen(WINTER_SWITCH + MIN)).toBe(60);
    expect(copenhagen(SUMMER_SWITCH - MIN)).toBe(60);
    expect(copenhagen(SUMMER_SWITCH + MIN)).toBe(120);
  });

  for (const [name, at] of [['vintertid', WINTER_SWITCH], ['sommertid', SUMMER_SWITCH]] as const) {
    it(`${name}: en nu/naeste-hentning fra foer skiftet er gammel lige efter`, () => {
      const freshness = { fetchedAt: at - 5 * MIN, latestStopMs: at + 4 * 60 * MIN };
      expect(needsEpgFetch(freshness, new Date(at + 5 * MIN), copenhagen)).toBe(true);
      expect(needsEpgFetch(freshness, new Date(at - MIN), copenhagen)).toBe(false);
    });

    it(`${name}: den fulde tabel fra foer skiftet er gammel lige efter`, () => {
      expect(needsArchiveFetch(at - 10 * MIN, new Date(at + MIN), copenhagen)).toBe(true);
      expect(needsArchiveFetch(at - 10 * MIN, new Date(at - MIN), copenhagen)).toBe(false);
    });

    it(`${name}: de foerste tre doegn fornyes tabellen hver time, derefter hver sjette`, () => {
      const day2 = at + 2 * 24 * 60 * MIN;
      expect(needsArchiveFetch(day2 - 59 * MIN, new Date(day2), copenhagen)).toBe(false);
      expect(needsArchiveFetch(day2 - 61 * MIN, new Date(day2), copenhagen)).toBe(true);
      const day4 = at + 4 * 24 * 60 * MIN;
      expect(needsArchiveFetch(day4 - 2 * 60 * MIN, new Date(day4), copenhagen)).toBe(false);
      expect(needsArchiveFetch(day4 - 6 * 60 * MIN, new Date(day4), copenhagen)).toBe(true);
    });

    it(`${name}: en frisk fuld tabel fra efter skiftet springer nu/naeste over`, () => {
      const now = new Date(at + 3 * 60 * MIN);
      const shortFreshness = { fetchedAt: at - 10 * MIN, latestStopMs: null };
      expect(needsShortEpg(shortFreshness, now.getTime() - 10 * MIN, now, copenhagen)).toBe(false);
      expect(needsShortEpg(shortFreshness, at - 20 * MIN, now, copenhagen)).toBe(true);
    });
  }

  it('crossedTimeChange og nearTimeChange med fast UTC-ur: aldrig', () => {
    const utc = (): number => 0;
    expect(crossedTimeChange(WINTER_SWITCH - MIN, WINTER_SWITCH + MIN, utc)).toBe(false);
    expect(nearTimeChange(WINTER_SWITCH + MIN, utc)).toBe(false);
    expect(nearTimeChange(WINTER_SWITCH + MIN, copenhagen)).toBe(true);
    expect(nearTimeChange(WINTER_SWITCH + 4 * 24 * 60 * MIN, copenhagen)).toBe(false);
  });
});
