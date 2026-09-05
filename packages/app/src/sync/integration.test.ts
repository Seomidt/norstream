import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { listChannels } from '../storage/channels.js';
import { getNowNext } from '../storage/programmes.js';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { ensureEpg } from './epgCache.js';
import { syncChannels } from './syncChannels.js';

/**
 * Sammenkoblingen mellem kanal- og EPG-synkroniseringen er det eneste sted hvor
 * guiden kan gaa i stykker uden at en enkelt-modul-test opdager det.
 *
 * I v1 var faelden `epg_channel_id` mod XMLTV-dokumentets `channel=`-attribut.
 * I v2 er den flyttet: kanaler gemmes med Xtreams `stream_id` som `id`, og
 * programmer gemmes under praecis den samme streng, fordi `get_short_epg` slaar
 * op paa den. Skrider de fra hinanden — fordi kanalen gemmes som tal og
 * programmet som streng, for eksempel — viser hver eneste raekke
 * "Ingen programdata" med en helt groen testsuite.
 *
 * Denne test koerer begge synkroniseringer mod det samme panel og kraever at
 * opslaget paa kanalens eget id rent faktisk finder programmet.
 */

const creds: XtreamCredentials = {
  baseUrl: 'http://panel.example:8080',
  username: 'USER',
  password: 'PASS',
};

const NOW = new Date(Date.UTC(2026, 8, 4, 20, 30));
const NOW_SECONDS = NOW.getTime() / 1000;

/**
 * Panelet sender stream_id som **tal** i get_live_streams og som **streng** i
 * URL'ens query. Det er den skridning testen bevogter.
 */
const STREAM_ID_NUMBER = 10;

/** "TV Avisen" og "Sporten". */
const TITLE_NOW = 'VFYgQXZpc2Vu';
const TITLE_NEXT = 'U3BvcnRlbg==';

function panel(): FetchLike {
  return vi.fn(async (url: string) => {
    const params = new URL(url).searchParams;
    const action = params.get('action') ?? 'auth';

    if (action === 'get_live_categories') {
      return {
        ok: true,
        status: 200,
        json: async () => [{ category_id: '1', category_name: 'DENMARK HD & HEVC' }],
      };
    }

    if (action === 'get_live_streams') {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            stream_id: STREAM_ID_NUMBER,
            name: 'DNK| DR1 HD',
            category_id: '1',
            // Tom med vilje: 87 % af panelets kanaler har intet EPG-id, og
            // v2 maa ikke laene sig op ad det.
            epg_channel_id: '',
            tv_archive: 1,
            tv_archive_duration: 3,
          },
        ],
      };
    }

    if (action === 'get_short_epg') {
      // Panelet svarer kun for det stream_id der faktisk blev spurgt om.
      if (params.get('stream_id') !== String(STREAM_ID_NUMBER)) {
        return { ok: true, status: 200, json: async () => ({ epg_listings: [] }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          epg_listings: [
            {
              title: TITLE_NOW,
              description: 'TnloZWRlcg==',
              start_timestamp: String(NOW_SECONDS - 1800),
              stop_timestamp: String(NOW_SECONDS + 1800),
            },
            {
              title: TITLE_NEXT,
              start_timestamp: String(NOW_SECONDS + 1800),
              stop_timestamp: String(NOW_SECONDS + 5400),
            },
          ],
        }),
      };
    }

    return { ok: true, status: 200, json: async () => ({ user_info: { auth: 1 } }) };
  });
}

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('kanal- og EPG-synkronisering sammen', () => {
  it('finder programdata paa kanalens eget id, uden et epg_channel_id', async () => {
    const fetchImpl = panel();
    await syncChannels(db, creds, fetchImpl, NOW);

    const channel = (await listChannels(db))[0];
    expect(channel?.name).toBe('DNK| DR1 HD');
    // Kanalen har intet EPG-id. I v1 var det nok til at gøre den blind.
    expect(channel?.epgChannelId).toBeNull();

    await ensureEpg(db, creds, fetchImpl, [channel?.id ?? ''], NOW);

    const result = await getNowNext(db, channel?.id ?? '', NOW);
    expect(result.now?.title).toBe('TV Avisen');
    expect(result.next?.title).toBe('Sporten');
    // Selve sammenkoblingen: programmets kanal-id er kanalens id.
    expect(result.now?.channelId).toBe(channel?.id);
  });

  it('finder ingen programdata under et andet id end kanalens', async () => {
    // Kontrolgruppen: uden den ville testen ovenfor ogsaa bestaa hvis
    // opslaget matchede alt.
    const fetchImpl = panel();
    await syncChannels(db, creds, fetchImpl, NOW);
    const channel = (await listChannels(db))[0];
    await ensureEpg(db, creds, fetchImpl, [channel?.id ?? ''], NOW);

    const result = await getNowNext(db, 'et-andet-id', NOW);
    expect(result.now).toBeNull();
    expect(result.next).toBeNull();
  });
});
