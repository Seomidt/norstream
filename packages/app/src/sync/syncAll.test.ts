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
    expect(result).toEqual({ synced: 0, rejected: ['Hovedpanel'], failed: [] });
  });
});
