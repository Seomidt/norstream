import { describe, expect, it, vi } from 'vitest';
import { loadFromCloud, saveToCloud } from './cloudSync.js';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

describe('saveToCloud', () => {
  it('sender action=save med kode og data, og lykkes paa ok', async () => {
    const fetchImpl = fakeFetch(200, { ok: true });
    await expect(saveToCloud('min-kode', '{"a":1}', fetchImpl)).resolves.toBeUndefined();
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent).toEqual({ action: 'save', code: 'min-kode', data: '{"a":1}' });
  });

  it('kaster naar skyen svarer med fejl', async () => {
    await expect(saveToCloud('min-kode', '{}', fakeFetch(500, { ok: false, error: 'store' }))).rejects.toThrow('save');
  });

  it('kaster network naar der ingen forbindelse er', async () => {
    const down = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(saveToCloud('min-kode', '{}', down)).rejects.toThrow('network');
  });

  it('trimmer kodeordet', async () => {
    const fetchImpl = fakeFetch(200, { ok: true });
    await saveToCloud('  kode  ', '{}', fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).code).toBe('kode');
  });
});

describe('loadFromCloud', () => {
  it('giver dataen tilbage paa ok', async () => {
    await expect(loadFromCloud('min-kode', fakeFetch(200, { ok: true, data: '{"g":["Sport"]}' }))).resolves.toBe(
      '{"g":["Sport"]}',
    );
  });

  it('kaster notfound paa 404 (ogsaa forkert kodeord)', async () => {
    await expect(loadFromCloud('forkert', fakeFetch(404, { ok: false, error: 'notfound' }))).rejects.toThrow(
      'notfound',
    );
  });

  it('kaster load naar svaret mangler data', async () => {
    await expect(loadFromCloud('kode', fakeFetch(200, { ok: true }))).rejects.toThrow('load');
  });

  it('kaster network uden forbindelse', async () => {
    const down = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(loadFromCloud('kode', down)).rejects.toThrow('network');
  });
});
