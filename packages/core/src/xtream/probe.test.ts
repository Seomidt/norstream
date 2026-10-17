import { describe, expect, it, vi } from 'vitest';
import { detectTimeshiftDialect } from './probe.js';
import type { FetchLike } from './client.js';
import type { XtreamCredentials } from '../models.js';
import { formatTimeshiftStart } from '../urls.js';

const creds: XtreamCredentials = {
  baseUrl: 'http://panel.example:8080',
  username: 'USER',
  password: 'PASS',
};

describe('detectTimeshiftDialect', () => {
  it('vælger php når kun php svarer', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url: string) => ({
      ok: url.includes('timeshift.php'),
      status: url.includes('timeshift.php') ? 200 : 404,
      text: async () => '', json: async () => ({}),
    }));
    await expect(detectTimeshiftDialect(creds, '1', fetchImpl)).resolves.toBe('php');
  });

  it('vælger path når kun path svarer', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url: string) => ({
      ok: url.includes('/timeshift/'),
      status: url.includes('/timeshift/') ? 200 : 404,
      text: async () => '', json: async () => ({}),
    }));
    await expect(detectTimeshiftDialect(creds, '1', fetchImpl)).resolves.toBe('path');
  });

  it('returnerer null når ingen dialekt svarer', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => '', json: async () => ({}),
    }));
    await expect(detectTimeshiftDialect(creds, '1', fetchImpl)).resolves.toBeNull();
  });

  it('returnerer null når panelet er utilgængeligt', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(detectTimeshiftDialect(creds, '1', fetchImpl)).resolves.toBeNull();
  });

  it('prøver php før path', async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      seen.push(url);
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    });
    await detectTimeshiftDialect(creds, '1', fetchImpl);
    expect(seen[0]).toContain('timeshift.php');
    expect(seen[1]).toContain('/timeshift/');
  });

  it('prøver 13 timer tilbage hvis ingen dialekt svarer én time tilbage', async () => {
    const now = new Date('2026-09-04T20:00:00Z');
    const deepStart = formatTimeshiftStart(new Date(now.getTime() - 13 * 60 * 60_000));
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      const isPath = url.includes('/timeshift/');
      const isDeep = url.includes(deepStart);
      const ok = isPath && isDeep;
      return { ok, status: ok ? 200 : 404, text: async () => '', json: async () => ({}) };
    });
    await expect(detectTimeshiftDialect(creds, '1', fetchImpl, now)).resolves.toBe('path');
    // 4 forsøg: php og path én time tilbage (begge fejler), så php og path
    // 13 timer tilbage (path svarer).
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('giver op og returnerer null hvis ingen dialekt svarer på noget af de to tidspunkter', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => '', json: async () => ({}),
    }));
    await expect(detectTimeshiftDialect(creds, '1', fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('videresender panelOffsetMinutes til buildTimeshiftUrl', async () => {
    const now = new Date('2026-09-04T20:00:00Z');
    const expectedStart = formatTimeshiftStart(new Date(now.getTime() - 60 * 60_000), 120);
    const seen: string[] = [];
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      seen.push(url);
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    });
    await detectTimeshiftDialect(creds, '1', fetchImpl, now, 120);
    expect(seen[0]).toContain(encodeURIComponent(expectedStart));
  });
});
