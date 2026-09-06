import { beforeEach, describe, expect, it, vi } from 'vitest';
import { XtreamAuthError } from '@norstream/core';
import type { FetchLike, Source, XtreamCredentials } from '@norstream/core';
import { listChannels } from '../storage/channels.js';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import type { SourceAccess } from '../sources/access.js';
import { syncAllSources } from './syncAll.js';

const creds: XtreamCredentials = {
  baseUrl: 'http://panel.example:8080',
  username: 'USER',
  password: 'PASS',
};

function source(id: string, kind: Source['kind'], name = id): Source {
  return {
    id,
    kind,
    name,
    url: kind === 'm3u' ? 'http://liste.example/liste.m3u' : 'http://panel.example:8080',
    username: kind === 'xtream' ? 'USER' : null,
    xmltvUrl: null,
    enabled: true,
    sortOrder: 0,
  };
}

/** Panel der svarer paa Xtream-kald og paa M3U-listen. */
function world(options: { authFails?: string[]; dead?: string[] } = {}): FetchLike {
  return vi.fn(async (url: string) => {
    if (url.endsWith('.m3u')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '#EXTM3U\n#EXTINF:-1 tvg-id="a",A\nhttp://x/a.m3u8\n',
      };
    }
    const host = new URL(url).host;
    if (options.authFails?.includes(host) === true) {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    if (options.dead?.includes(host) === true) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    const action = new URL(url).searchParams.get('action');
    if (action === 'get_live_categories') {
      return { ok: true, status: 200, json: async () => [{ category_id: '1', category_name: 'DK' }] };
    }
    return {
      ok: true,
      status: 200,
      json: async () => [{ stream_id: '1', name: 'DR1', category_id: '1' }],
    };
  }) as unknown as FetchLike;
}

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('syncAllSources', () => {
  it('henter baade paneler og lister', async () => {
    const accesses: SourceAccess[] = [
      { source: source('p1', 'xtream'), creds },
      { source: source('m1', 'm3u'), creds: null },
    ];

    const result = await syncAllSources(db, accesses, world());

    expect(result.synced).toBe(2);
    const channels = await listChannels(db);
    expect(channels.map((c) => c.id).sort()).toEqual(['m1:a', 'p1:1']);
  });

  it('lader de oevrige kilder virke naar én er nede', async () => {
    // Hele pointen med flere kilder: det ene panel nede maa ikke tage resten
    // af kanalerne med sig.
    const accesses: SourceAccess[] = [
      { source: { ...source('p1', 'xtream'), url: 'http://doed.example' }, creds: { ...creds, baseUrl: 'http://doed.example' } },
      { source: source('m1', 'm3u'), creds: null },
    ];

    const result = await syncAllSources(db, accesses, world({ dead: ['doed.example'] }));

    expect(result.synced).toBe(1);
    expect(result.failed).toEqual(['p1']);
    expect(await listChannels(db)).toHaveLength(1);
  });

  it('peger den kilde ud der afviste adgangsoplysningerne', async () => {
    const accesses: SourceAccess[] = [
      {
        source: { ...source('p1', 'xtream', 'Hovedpanel'), url: 'http://afvist.example' },
        creds: { ...creds, baseUrl: 'http://afvist.example' },
      },
      { source: source('m1', 'm3u'), creds: null },
    ];

    const result = await syncAllSources(db, accesses, world({ authFails: ['afvist.example'] }));

    // Navnet, ikke id'et: det er det brugeren kan genkende.
    expect(result.rejected).toEqual(['Hovedpanel']);
    expect(result.synced).toBe(1);
  });

  it('melder en kilde hvis adgangsoplysninger er forsvundet fra Keychain', async () => {
    const accesses: SourceAccess[] = [{ source: source('p1', 'xtream', 'Hovedpanel'), creds: null }];
    const result = await syncAllSources(db, accesses, world());
    expect(result).toEqual({ synced: 0, skipped: 0, rejected: ['Hovedpanel'], failed: [] });
  });
});

describe('doegnrytmen', () => {
  const NOW = new Date('2026-09-06T18:00:00.000Z');

  it('springer en kilde over der blev hentet for en time siden', async () => {
    const accesses: SourceAccess[] = [{ source: source('p1', 'xtream'), creds }];
    await syncAllSources(db, accesses, world(), { now: NOW });

    const later = new Date(NOW.getTime() + 60 * 60_000);
    const again = await syncAllSources(db, accesses, world(), { now: later });

    expect(again).toEqual({ synced: 0, skipped: 1, rejected: [], failed: [] });
  });

  it('henter igen efter et doegn', async () => {
    const accesses: SourceAccess[] = [{ source: source('p1', 'xtream'), creds }];
    await syncAllSources(db, accesses, world(), { now: NOW });

    const later = new Date(NOW.getTime() + 25 * 60 * 60_000);
    expect((await syncAllSources(db, accesses, world(), { now: later })).synced).toBe(1);
  });

  it('henter en nyligt tilfoejet kilde selv om en anden lige er hentet', async () => {
    // Med én faelles hentetid ville den nye arve den andens og staa tom i op
    // til et doegn. Det er praecis den fejl doegnrytmen per kilde findes for.
    const first: SourceAccess[] = [{ source: source('p1', 'xtream'), creds }];
    await syncAllSources(db, first, world(), { now: NOW });

    const both: SourceAccess[] = [
      ...first,
      { source: source('m1', 'm3u'), creds: null },
    ];
    const result = await syncAllSources(db, both, world(), {
      now: new Date(NOW.getTime() + 60_000),
    });

    expect(result).toEqual({ synced: 1, skipped: 1, rejected: [], failed: [] });
    expect((await listChannels(db)).some((c) => c.sourceId === 'm1')).toBe(true);
  });

  it('henter alligevel naar brugeren selv beder om det', async () => {
    const accesses: SourceAccess[] = [{ source: source('p1', 'xtream'), creds }];
    await syncAllSources(db, accesses, world(), { now: NOW });

    const result = await syncAllSources(db, accesses, world(), {
      now: new Date(NOW.getTime() + 60_000),
      force: true,
    });

    expect(result.synced).toBe(1);
  });
});
