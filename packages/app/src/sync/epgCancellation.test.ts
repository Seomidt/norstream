import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchLikeResponse, XtreamCredentials } from '@norstream/core';
import { channelKey } from '@norstream/core';
import { getArchiveFetchedAt, getEpgFreshness } from '../storage/epgFetch.js';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { ensureEpg, ensureFullEpg } from './epgCache.js';
import { acquirePanel, panelQueue, releasePanel, resetPanelGate } from './panelGate.js';

const creds: XtreamCredentials = { baseUrl: 'https://example.invalid', username: 'u', password: 'p' };
const sources = new Map([['source', creds]]);
const keys = ['1', '2', '3', '4'].map(id => channelKey('source', id));
const now = new Date('2026-10-25T18:00:00Z');
const emptyResponse = (): FetchLikeResponse => ({
  ok: true, status: 200, json: async () => ({ epg_listings: [] }), text: async () => '',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let db: SqlDatabase;
beforeEach(async () => {
  resetPanelGate();
  db = createTestDatabase();
  await migrate(db);
});
afterEach(() => {
  expect(panelQueue()).toEqual({ foreground: 0, background: 0, busy: false });
  resetPanelGate();
});

describe.each(['short', 'full'] as const)('annullering af %s EPG inde i batchen', kind => {
  function run(fetch: FetchLike, shouldContinue: () => boolean) {
    return kind === 'short'
      ? ensureEpg(db, sources, fetch, keys, now, 200, { shouldContinue })
      : ensureFullEpg(db, sources, fetch, keys.map(id => ({ id })), now, { shouldContinue });
  }
  async function marker(key: string): Promise<number | null> {
    return kind === 'short' ? (await getEpgFreshness(db, key)).fetchedAt : getArchiveFetchedAt(db, key);
  }

  it('afslutter det aktive kald og sender ingen af batchens tre resterende kanaler efter tildaekning', async () => {
    const started = deferred<void>();
    const first = deferred<FetchLikeResponse>();
    const fetch = vi.fn(async () => { started.resolve(); return first.promise; });
    let visible = true;
    const operation = run(fetch, () => visible);
    await started.promise;
    visible = false;
    first.resolve(emptyResponse());
    expect(await operation).toEqual({ fetched: 1, programmes: 0, failed: 0, reason: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await marker(keys[0]!)).toBe(now.getTime());
    for (const key of keys.slice(1)) expect(await marker(key)).toBeNull();
  });

  it('springer et annulleret koekald over uden HTTP, friskhedsmarkering eller fejlventetid', async () => {
    await acquirePanel(false);
    const fetch = vi.fn(async () => emptyResponse());
    let visible = true;
    const operation = run(fetch, () => visible);
    try {
      await vi.waitFor(() => expect(panelQueue().foreground).toBe(1));
      visible = false;
    } finally { releasePanel(); }
    expect(await operation).toEqual({ fetched: 0, programmes: 0, failed: 0, reason: null });
    expect(fetch).not.toHaveBeenCalled();
    for (const key of keys) expect(await marker(key)).toBeNull();
    // Samme tidspunkt maa hentes straks naar guiden kommer frem igen.
    const retry = await run(fetch, () => true);
    expect(retry).toEqual({ fetched: 4, programmes: 0, failed: 0, reason: null });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
