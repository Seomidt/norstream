import { channelKey } from '@norstream/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { XtreamAuthError, XtreamNetworkError } from '@norstream/core';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { listCategories, listChannels } from '../storage/channels.js';
import { getLastSyncMs } from '../storage/settings.js';
import { syncChannels } from './syncChannels.js';

/** Alt her kommer fra én kilde. */
const SOURCE = 'src1';
const key = (streamId: string): string => channelKey(SOURCE, streamId);

const creds: XtreamCredentials = {
  baseUrl: 'http://panel.example:8080',
  username: 'USER',
  password: 'PASS',
};

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

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('syncChannels', () => {
  it('skriver kategorier og kanaler til databasen', async () => {
    const fetchImpl = panel({
      get_live_categories: [{ category_id: '1', category_name: 'Danmark' }],
      get_live_streams: [
        {
          stream_id: 10,
          name: 'DR1',
          category_id: '1',
          tv_archive: 1,
          tv_archive_duration: 7,
        },
        { stream_id: 11, name: 'TV 2', category_id: '1' },
      ],
    });

    const result = await syncChannels(db, SOURCE, creds, fetchImpl);

    expect(result).toEqual({ categories: 1, channels: 2 });
    expect(await listCategories(db)).toEqual([{ id: key('1'), name: 'Danmark' }]);
    const channels = await listChannels(db);
    expect(channels.map((c) => c.name)).toEqual(['DR1', 'TV 2']);
    expect(channels[0]?.hasArchive).toBe(true);
    expect(channels[0]?.archiveDays).toBe(7);
  });

  it('noterer tidspunktet for synkroniseringen', async () => {
    const fetchImpl = panel({ get_live_categories: [], get_live_streams: [] });
    const now = new Date(Date.UTC(2026, 8, 4, 12, 0, 0));
    await syncChannels(db, SOURCE, creds, fetchImpl, now);
    expect(await getLastSyncMs(db, SOURCE)).toBe(now.getTime());
  });

  it('lader XtreamAuthError boble op', async () => {
    const failing: FetchLike = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));
    await expect(syncChannels(db, SOURCE, creds, failing)).rejects.toBeInstanceOf(
      XtreamAuthError,
    );
  });

  it('lader XtreamNetworkError boble op', async () => {
    const failing: FetchLike = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(syncChannels(db, SOURCE, creds, failing)).rejects.toBeInstanceOf(
      XtreamNetworkError,
    );
  });

  it('roerer ikke cachen naar panelet er helt nede paa foerste kald', async () => {
    const ok = panel({
      get_live_categories: [{ category_id: '1', category_name: 'Danmark' }],
      get_live_streams: [{ stream_id: 10, name: 'DR1' }],
    });
    await syncChannels(db, SOURCE, creds, ok);

    const fullyUnreachable: FetchLike = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(syncChannels(db, SOURCE, creds, fullyUnreachable)).rejects.toThrow();

    // Spec sec.2 kraever drift paa cached data naar panelet er nede.
    expect(await listChannels(db)).toHaveLength(1);
  });

  it('roerer ikke cachen naar anden foresporgsel fejler efter foerste lukkedes', async () => {
    // Først synkroniser succesfuldt for at have cache med data
    const ok = panel({
      get_live_categories: [{ category_id: '1', category_name: 'Danmark' }],
      get_live_streams: [{ stream_id: 10, name: 'DR1' }],
    });
    await syncChannels(db, SOURCE, creds, ok);

    // Derefter, når anden forespørgsel fejler (efter at første lukkedes),
    // skal cachen stadig være intakt. Vi returner en ANDEN kategori for
    // at bevise at hvis vi skrev den med det samme, ville testen fejle.
    const failsOnStreams: FetchLike = vi.fn(async (url: string) => {
      const action = new URL(url).searchParams.get('action');
      if (action === 'get_live_streams') throw new Error('ECONNREFUSED');
      return {
        ok: true,
        status: 200,
        json: async () => [{ category_id: '2', category_name: 'Sverige' }],
      };
    });

    await expect(syncChannels(db, SOURCE, creds, failsOnStreams)).rejects.toThrow();

    // Spec sec.2 kraever drift paa cached data naar panelet fejler.
    // Hvis vi havde skrevet kategorier før anden forespørgsel fejlede, ville
    // cachen nu indeholde den nye kategori. Vi verificerer det ikke skete.
    expect(await listChannels(db)).toHaveLength(1);
    expect(await listCategories(db)).toEqual([{ id: key('1'), name: 'Danmark' }]);
  });
});
