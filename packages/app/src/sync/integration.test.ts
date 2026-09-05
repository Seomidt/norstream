import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { listChannels } from '../storage/channels.js';
import { getNowNext } from '../storage/programmes.js';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { syncChannels } from './syncChannels.js';
import { syncEpg } from './syncEpg.js';
import type { TextChunkSource } from './syncEpg.js';

/**
 * Sammenkoblingen mellem de to synkroniseringer er det eneste sted hvor
 * guiden kan gaa i stykker uden at en enkelt-modul-test opdager det:
 * kanaler gemmer `epg_channel_id` fra Xtream, mens programmer noegles paa
 * XMLTV-dokumentets `channel=`-attribut. Er de to ikke den samme streng,
 * viser hver eneste raekke "Ingen programdata" — med en helt groen testsuite.
 * Denne test koerer begge synkroniseringer fra fikstures der deler eet
 * kanal-id og kraever at opslaget rent faktisk finder programmet.
 */

const creds: XtreamCredentials = {
  baseUrl: 'http://panel.example:8080',
  username: 'USER',
  password: 'PASS',
};

/** Samme streng i begge fikstures — det er praecis det testen bevogter. */
const EPG_CHANNEL_ID = 'dr1.dk';

const NOW = new Date(Date.UTC(2026, 8, 4, 20, 30));

const XMLTV = `<?xml version="1.0"?>
<tv>
  <programme start="20260904200000 +0000" stop="20260904210000 +0000"
    channel="${EPG_CHANNEL_ID}">
    <title>TV Avisen</title><desc>Nyheder</desc>
  </programme>
  <programme start="20260904210000 +0000" stop="20260904220000 +0000"
    channel="${EPG_CHANNEL_ID}">
    <title>Sporten</title>
  </programme>
</tv>`;

function panel(responses: Record<string, unknown>): FetchLike {
  return vi.fn(async (url: string) => {
    const action = new URL(url).searchParams.get('action') ?? 'auth';
    return {
      ok: true,
      status: 200,
      json: async () => responses[action] ?? { user_info: { auth: 1 } },
    };
  });
}

function chunkSource(chunks: string[]): TextChunkSource {
  return vi.fn(async () => ({
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  }));
}

const xtreamPanel = panel({
  get_live_categories: [{ category_id: '1', category_name: 'Danmark' }],
  get_live_streams: [
    {
      stream_id: 10,
      name: 'DR1',
      category_id: '1',
      epg_channel_id: EPG_CHANNEL_ID,
      tv_archive: 1,
      tv_archive_duration: 7,
    },
  ],
});

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('kanal- og EPG-synkronisering sammen', () => {
  it('finder programdata for den synkroniserede kanal', async () => {
    await syncChannels(db, creds, xtreamPanel, NOW);
    await syncEpg(db, creds, chunkSource([XMLTV]), NOW);

    const channels = await listChannels(db);
    const channel = channels[0];
    expect(channel?.name).toBe('DR1');
    // Kanalen skal have baaret sit epg-id med sig fra panelet; er det null,
    // slaar skaermene aldrig op i programme-tabellen.
    expect(channel?.epgChannelId).not.toBeNull();

    const result = await getNowNext(db, channel?.epgChannelId ?? '', NOW);
    expect(result.now?.title).toBe('TV Avisen');
    expect(result.next?.title).toBe('Sporten');
    // Selve sammenkoblingen: programmets kanal-id er kanalens epg-id.
    expect(result.now?.channelId).toBe(channel?.epgChannelId);
  });

  it('finder ingen programdata naar panelets epg-id ikke matcher XMLTV', async () => {
    // Kontrolgruppen: uden den ville testen ovenfor ogsaa bestaa hvis
    // opslaget matchede alt.
    const mismatched = panel({
      get_live_categories: [],
      get_live_streams: [
        { stream_id: 10, name: 'DR1', epg_channel_id: 'et-andet-id' },
      ],
    });
    await syncChannels(db, creds, mismatched, NOW);
    await syncEpg(db, creds, chunkSource([XMLTV]), NOW);

    const channel = (await listChannels(db))[0];
    const result = await getNowNext(db, channel?.epgChannelId ?? '', NOW);
    expect(result.now).toBeNull();
    expect(result.next).toBeNull();
  });
});
