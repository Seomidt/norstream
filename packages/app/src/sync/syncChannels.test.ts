import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike, XtreamCredentials } from '@uhf-play/core';
import { XtreamAuthError, XtreamNetworkError } from '@uhf-play/core';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { listCategories, listChannels } from '../storage/channels.js';
import { getLastSyncMs } from '../storage/settings.js';
import { syncChannels } from './syncChannels.js';

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

    const result = await syncChannels(db, creds, fetchImpl);

    expect(result).toEqual({ categories: 1, channels: 2 });
    expect(await listCategories(db)).toEqual([{ id: '1', name: 'Danmark' }]);
    const channels = await listChannels(db);
    expect(channels.map((c) => c.name)).toEqual(['DR1', 'TV 2']);
    expect(channels[0]?.hasArchive).toBe(true);
    expect(channels[0]?.archiveDays).toBe(7);
  });

  it('noterer tidspunktet for synkroniseringen', async () => {
    const fetchImpl = panel({ get_live_categories: [], get_live_streams: [] });
    const now = new Date(Date.UTC(2026, 8, 4, 12, 0, 0));
    await syncChannels(db, creds, fetchImpl, now);
    expect(await getLastSyncMs(db)).toBe(now.getTime());
  });

  it('lader XtreamAuthError boble op', async () => {
    const failing: FetchLike = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));
    await expect(syncChannels(db, creds, failing)).rejects.toBeInstanceOf(
      XtreamAuthError,
    );
  });

  it('lader XtreamNetworkError boble op', async () => {
    const failing: FetchLike = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(syncChannels(db, creds, failing)).rejects.toBeInstanceOf(
      XtreamNetworkError,
    );
  });

  it('roerer ikke cachen naar panelet fejler', async () => {
    const ok = panel({
      get_live_categories: [{ category_id: '1', category_name: 'Danmark' }],
      get_live_streams: [{ stream_id: 10, name: 'DR1' }],
    });
    await syncChannels(db, creds, ok);

    const failing: FetchLike = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(syncChannels(db, creds, failing)).rejects.toThrow();

    // Spec sec.2 kraever drift paa cached data naar panelet er nede.
    expect(await listChannels(db)).toHaveLength(1);
  });
});
