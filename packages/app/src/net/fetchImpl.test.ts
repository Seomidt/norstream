import { describe, expect, it, vi } from 'vitest';
import { createFetchImpl } from './fetchImpl.js';

describe('createFetchImpl', () => {
  it('videregiver svaret fra det underliggende fetch', async () => {
    const underlying = vi.fn(async () => new Response('[]', { status: 200 }));
    const fetchImpl = createFetchImpl(1000, underlying as unknown as typeof fetch);
    const res = await fetchImpl('http://panel.example:8080/player_api.php');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
  });

  it('videregiver en fejlstatus uden at kaste', async () => {
    const underlying = vi.fn(async () => new Response('', { status: 401 }));
    const fetchImpl = createFetchImpl(1000, underlying as unknown as typeof fetch);
    const res = await fetchImpl('http://panel.example:8080/');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });

  it('sender et abort-signal med', async () => {
    const underlying = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      return new Response('{}', { status: 200 });
    });
    const fetchImpl = createFetchImpl(1000, underlying as unknown as typeof fetch);
    await fetchImpl('http://panel.example:8080/');
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it('afbryder naar timeout udloeber', async () => {
    const underlying = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('AbortError')),
        );
      });
    const fetchImpl = createFetchImpl(20, underlying as unknown as typeof fetch);
    await expect(fetchImpl('http://panel.example:8080/')).rejects.toThrow(
      /abort/i,
    );
  });
});
