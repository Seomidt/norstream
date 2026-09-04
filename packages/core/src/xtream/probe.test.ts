import { describe, expect, it, vi } from 'vitest';
import { detectTimeshiftDialect } from './probe.js';
import type { FetchLike } from './client.js';
import type { XtreamCredentials } from '../models.js';

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
      json: async () => ({}),
    }));
    await expect(detectTimeshiftDialect(creds, '1', fetchImpl)).resolves.toBe('php');
  });

  it('vælger path når kun path svarer', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url: string) => ({
      ok: url.includes('/timeshift/'),
      status: url.includes('/timeshift/') ? 200 : 404,
      json: async () => ({}),
    }));
    await expect(detectTimeshiftDialect(creds, '1', fetchImpl)).resolves.toBe('path');
  });

  it('returnerer null når ingen dialekt svarer', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
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
      return { ok: false, status: 404, json: async () => ({}) };
    });
    await detectTimeshiftDialect(creds, '1', fetchImpl);
    expect(seen[0]).toContain('timeshift.php');
    expect(seen[1]).toContain('/timeshift/');
  });
});
