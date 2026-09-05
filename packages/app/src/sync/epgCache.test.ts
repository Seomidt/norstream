import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { XtreamAuthError } from '@norstream/core';
import { getEpgFreshness, markEpgFetched } from '../storage/epgFetch.js';
import { listProgrammes } from '../storage/programmes.js';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { ensureEpg } from './epgCache.js';

const creds: XtreamCredentials = {
  baseUrl: 'http://panel.example:8080',
  username: 'USER',
  password: 'PASS',
};

const NOW = new Date('2026-09-05T18:00:00.000Z');
const NOW_SECONDS = NOW.getTime() / 1000;

/** "TV Avisen" */
const TITLE = 'VFYgQXZpc2Vu';

function listing(offsetMinutes: number, lengthMinutes = 30): Record<string, unknown> {
  const start = NOW_SECONDS + offsetMinutes * 60;
  return {
    title: TITLE,
    start_timestamp: String(start),
    stop_timestamp: String(start + lengthMinutes * 60),
  };
}

interface PanelOptions {
  /** Programmer per stream_id. Mangler et id, svarer panelet tomt. */
  listings?: Record<string, unknown[]>;
  /** Stream-id'er panelet fejler paa, og med hvilken HTTP-status. */
  failWith?: Record<string, number>;
  /** Kaldes med det aktuelle antal samtidige kald. */
  onConcurrency?: (inFlight: number) => void;
}

function panel(options: PanelOptions = {}): FetchLike {
  let inFlight = 0;
  return vi.fn(async (url: string) => {
    const streamId = new URL(url).searchParams.get('stream_id') ?? '';
    inFlight += 1;
    options.onConcurrency?.(inFlight);
    // Et mikrotask-ophold, saa flere kald reelt kan overlappe.
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;

    const status = options.failWith?.[streamId];
    if (status !== undefined) {
      return { ok: false, status, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ epg_listings: options.listings?.[streamId] ?? [] }),
    };
  });
}

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('ensureEpg', () => {
  it('henter og gemmer programmer noeglet paa stream_id', async () => {
    const fetchImpl = panel({ listings: { '247634': [listing(0), listing(30)] } });

    const result = await ensureEpg(db, creds, fetchImpl, ['247634'], NOW);

    expect(result).toEqual({ fetched: 1, programmes: 2 });
    const stored = await listProgrammes(
      db,
      '247634',
      NOW,
      new Date(NOW.getTime() + 3600_000),
    );
    expect(stored.map((p) => p.title)).toEqual(['TV Avisen', 'TV Avisen']);
  });

  it('rammer cachen og henter ikke igen for en frisk kanal', async () => {
    const fetchImpl = panel({ listings: { '247634': [listing(0, 120)] } });
    await ensureEpg(db, creds, fetchImpl, ['247634'], NOW);
    const callsAfterFirst = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length;

    // Fem minutter senere, midt i et program der varer to timer.
    await ensureEpg(db, creds, fetchImpl, ['247634'], new Date(NOW.getTime() + 300_000));

    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
  });

  it('henter igen naar hentningen er over 30 minutter gammel', async () => {
    const fetchImpl = panel({ listings: { '247634': [listing(0, 240)] } });
    await ensureEpg(db, creds, fetchImpl, ['247634'], NOW);

    const later = new Date(NOW.getTime() + 31 * 60_000);
    const result = await ensureEpg(db, creds, fetchImpl, ['247634'], later);

    expect(result.fetched).toBe(1);
  });

  it('henter igen naar det nyeste gemte program er slut', async () => {
    const fetchImpl = panel({ listings: { '247634': [listing(0, 20)] } });
    await ensureEpg(db, creds, fetchImpl, ['247634'], NOW);

    // Ti minutter senere er programmet slut, selv om hentningen er frisk.
    const later = new Date(NOW.getTime() + 25 * 60_000);
    const result = await ensureEpg(db, creds, fetchImpl, ['247634'], later);

    expect(result.fetched).toBe(1);
  });

  it('henter ikke igen for en kanal panelet ikke har programdata for', async () => {
    // Regel 1 er "ikke hentet", ikke "ingen programmer". Ellers ville de
    // 87 % uden EPG give et kald ved hver rendering.
    const fetchImpl = panel({});
    await ensureEpg(db, creds, fetchImpl, ['247634'], NOW);
    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length;

    await ensureEpg(db, creds, fetchImpl, ['247634'], new Date(NOW.getTime() + 60_000));

    expect(calls).toBe(1);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('holder sig til fire samtidige kald', async () => {
    let peak = 0;
    const ids = Array.from({ length: 20 }, (_, i) => `chan-${i}`);
    const fetchImpl = panel({
      onConcurrency: (inFlight) => {
        peak = Math.max(peak, inFlight);
      },
    });

    await ensureEpg(db, creds, fetchImpl, ids, NOW);

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('afduplikerer stream-id og springer tomme over', async () => {
    const fetchImpl = panel({ listings: { '247634': [listing(0)] } });
    const result = await ensureEpg(db, creds, fetchImpl, ['247634', '247634', ''], NOW);
    expect(result.fetched).toBe(1);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('lader én doed kanal staa alene og henter resten', async () => {
    const fetchImpl = panel({
      listings: { '1': [listing(0)], '3': [listing(0)] },
      failWith: { '2': 500 },
    });

    const result = await ensureEpg(db, creds, fetchImpl, ['1', '2', '3'], NOW);

    expect(result.fetched).toBe(2);
    // Den fejlende kanal faar ingen hentetid og proeves igen naeste gang.
    await expect(getEpgFreshness(db, '2')).resolves.toMatchObject({ fetchedAt: null });
  });

  it('kaster XtreamAuthError videre, saa appen kan logge brugeren ud', async () => {
    const fetchImpl = panel({ failWith: { '1': 401 } });
    await expect(ensureEpg(db, creds, fetchImpl, ['1'], NOW)).rejects.toBeInstanceOf(
      XtreamAuthError,
    );
  });

  it('rydder programmer der sluttede for over 12 timer siden', async () => {
    const longAgo = NOW.getTime() - 20 * 60 * 60_000;
    await db.runAsync(
      'INSERT INTO programmes (channel_id, start_ms, stop_ms, title) VALUES (?, ?, ?, ?)',
      ['247634', longAgo, longAgo + 1800_000, 'Forrige doegn'],
    );
    const fetchImpl = panel({ listings: { '247634': [listing(0)] } });

    await ensureEpg(db, creds, fetchImpl, ['247634'], NOW);

    const old = await listProgrammes(
      db,
      '247634',
      new Date(longAgo - 1000),
      new Date(longAgo + 1000),
    );
    expect(old).toEqual([]);
  });

  it('rydder ikke naar panelet ikke gav noget', async () => {
    // Ellers ville en tur med panelet nede slette den EPG appen allerede har.
    const longAgo = NOW.getTime() - 20 * 60 * 60_000;
    await db.runAsync(
      'INSERT INTO programmes (channel_id, start_ms, stop_ms, title) VALUES (?, ?, ?, ?)',
      ['247634', longAgo, longAgo + 1800_000, 'Forrige doegn'],
    );
    const fetchImpl = panel({ failWith: { '247634': 500 } });

    await ensureEpg(db, creds, fetchImpl, ['247634'], NOW);

    const old = await listProgrammes(
      db,
      '247634',
      new Date(longAgo - 1000),
      new Date(longAgo + 1000),
    );
    expect(old).toHaveLength(1);
  });

  it('henter intet naar alle kanaler er friske', async () => {
    await markEpgFetched(db, '247634', NOW);
    const fetchImpl = panel({});

    const result = await ensureEpg(db, creds, fetchImpl, ['247634'], NOW);

    expect(result).toEqual({ fetched: 0, programmes: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
