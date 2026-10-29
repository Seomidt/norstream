import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cachedQuery, invalidateQueryCache } from './queryCache.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); invalidateQueryCache(); });
afterEach(() => { invalidateQueryCache(); vi.useRealTimers(); });

it('en tidsbegraenset cache deler opslag og erstatter samme noegle efter udloeb', async () => {
  const load = vi.fn(async () => load.mock.calls.length);
  expect(await Promise.all([cachedQuery('key', load, 300_000), cachedQuery('key', load, 300_000)])).toEqual([1, 1]);
  vi.advanceTimersByTime(299_999);
  expect(await cachedQuery('key', load, 300_000)).toBe(1);
  vi.advanceTimersByTime(1);
  expect(await cachedQuery('key', load, 300_000)).toBe(2);
  expect(load).toHaveBeenCalledTimes(2);
});

it('eksisterende kald uden tidsfrist bevares til kataloget invalideres', async () => {
  const load = vi.fn(async () => 'value');
  await cachedQuery('key', load);
  vi.advanceTimersByTime(24 * 60 * 60_000);
  await cachedQuery('key', load);
  expect(load).toHaveBeenCalledTimes(1);
  invalidateQueryCache(); await cachedQuery('key', load);
  expect(load).toHaveBeenCalledTimes(2);
});

it('fejl gemmes ikke som et gyldigt cachehit', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('database')).mockResolvedValue('ok');
  await expect(cachedQuery('key', load, 300_000)).rejects.toThrow('database');
  expect(await cachedQuery('key', load, 300_000)).toBe('ok');
});
