import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { XtreamAuthError } from '@norstream/core';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { createTestDatabase } from '../storage/testDb.js';
import { migrate } from '../storage/schema.js';
import { getPanelOffsetMinutes, setPanelOffsetMinutes } from '../storage/settings.js';
import type { SqlDatabase } from '../storage/types.js';
import { panelQueue, pauseBackgroundPanel, resetPanelGate } from './panelGate.js';
import { refreshPanelClock } from './panelClock.js';

const creds: XtreamCredentials = { baseUrl: 'https://example.invalid', username: 'test-user', password: 'test-password' };
const observed = Date.parse('2026-10-25T17:04:00Z') / 1000;
const metadata = (time = '2026-10-25 18:04:00', timezone = 'Europe/Amsterdam') => ({
  server_info: { timestamp_now: observed, time_now: time, timezone },
});
const transport = (raw: unknown) => vi.fn(async (_url: string) => ({
  ok: true, status: 200, json: async () => raw, text: async () => '',
}));
let db: SqlDatabase;

beforeEach(async () => {
  resetPanelGate();
  db = createTestDatabase();
  await migrate(db);
  await setPanelOffsetMinutes(db, 120, 'source-a');
  await setPanelOffsetMinutes(db, -300, 'source-b');
});
afterEach(() => {
  expect(panelQueue()).toEqual({ foreground: 0, background: 0, busy: false });
  resetPanelGate();
});

it('fornyer sommertidens gemte offset fra panelets vinterur uden at aendre andre kilder', async () => {
  const fetch = transport(metadata());
  expect(await refreshPanelClock(db, 'source-a', creds, fetch)).toEqual({ offsetMinutes: 60, timeZone: 'Europe/Amsterdam' });
  expect(await getPanelOffsetMinutes(db, 'source-a')).toBe(60);
  expect(await getPanelOffsetMinutes(db, 'source-b')).toBe(-300);
  expect(fetch).toHaveBeenCalledTimes(1);
  const endpoint = new URL(fetch.mock.calls[0]![0]);
  expect(endpoint.pathname).toBe('/player_api.php');
  expect(endpoint.searchParams.has('action')).toBe(false);
});

it('bevarer et fast paneloffset naar panelets tidszone ikke svarer til det maalte ur', async () => {
  const fetch = transport(metadata('2026-10-25 19:04:00'));
  expect(await refreshPanelClock(db, 'source-a', creds, fetch)).toEqual({ offsetMinutes: 120 });
  expect(await getPanelOffsetMinutes(db, 'source-a')).toBe(120);
});

it('genbruger kun den aktuelle kildes gemte offset naar servermetadata mangler', async () => {
  expect(await refreshPanelClock(db, 'source-b', creds, transport({ user_info: { auth: 1 } }))).toEqual({ offsetMinutes: -300 });
  expect(await getPanelOffsetMinutes(db, 'source-a')).toBe(120);
  expect(await getPanelOffsetMinutes(db, 'source-b')).toBe(-300);
});

it('bevarer cache ved netfejl og bruger nul for en kilde uden tidligere maaling', async () => {
  const fetch: FetchLike = vi.fn(async () => { throw new Error('network unavailable'); });
  expect(await refreshPanelClock(db, 'source-a', creds, fetch)).toEqual({ offsetMinutes: 120 });
  expect(await refreshPanelClock(db, 'new-source', creds, fetch)).toEqual({ offsetMinutes: 0 });
  expect(await getPanelOffsetMinutes(db, 'source-a')).toBe(120);
});

it.each(['serverfejl', 'ugyldig JSON'])('bevarer cache ved %s uden at laase panelkoeen', async (failure) => {
  const fetch: FetchLike = async () => ({
    ok: failure !== 'serverfejl', status: failure === 'serverfejl' ? 503 : 200,
    json: async () => { throw new SyntaxError('invalid json'); }, text: async () => '',
  });
  expect(await refreshPanelClock(db, 'source-b', creds, fetch)).toEqual({ offsetMinutes: -300 });
});

it('sender en afvist konto videre frem for at skjule den som manglende serverur', async () => {
  const fetch: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => '' });
  await expect(refreshPanelClock(db, 'source-a', creds, fetch)).rejects.toBeInstanceOf(XtreamAuthError);
  expect(await getPanelOffsetMinutes(db, 'source-a')).toBe(120);
});

it('henter et nyt ur ved hvert eksplicit forsoeg uden at dele kilde- eller databasecache', async () => {
  const secondDb = createTestDatabase(); await migrate(secondDb);
  await setPanelOffsetMinutes(secondDb, 330, 'source-a');
  const fetch = transport(metadata('2026-10-25 19:04:00'));
  expect((await refreshPanelClock(db, 'source-a', creds, fetch)).offsetMinutes).toBe(120);
  fetch.mockImplementation(transport(metadata()));
  expect((await refreshPanelClock(db, 'source-a', creds, fetch)).offsetMinutes).toBe(60);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await getPanelOffsetMinutes(secondDb, 'source-a')).toBe(330);
});

it('bruger forgrundskoeen selv om afspilning har sat baggrundsopslag paa pause', async () => {
  const resume = pauseBackgroundPanel();
  try {
    const fetch = transport(metadata());
    expect((await refreshPanelClock(db, 'source-a', creds, fetch)).offsetMinutes).toBe(60);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { resume(); }
});
