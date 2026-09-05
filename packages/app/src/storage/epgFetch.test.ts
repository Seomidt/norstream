import { beforeEach, describe, expect, it } from 'vitest';
import {
  EPG_MAX_AGE_MS,
  getEpgFreshness,
  markEpgFetched,
  needsEpgFetch,
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
