import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@norstream/core';
import { probeLogo } from './logoProbe.js';

function panel(
  overrides: Partial<{ ok: boolean; status: number; headers: Record<string, string> }> = {},
): FetchLike {
  const { ok = true, status = 200, headers = { 'content-type': 'image/png', 'content-length': '4211' } } =
    overrides;
  return async () =>
    ({
      ok,
      status,
      text: async () => '', json: async () => ({}),
      headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    }) as unknown as Awaited<ReturnType<FetchLike>>;
}

describe('probeLogo', () => {
  it('melder god naar der kommer et billede', async () => {
    const result = await probeLogo('http://x/logo.png', panel());
    expect(result.ok).toBe(true);
    expect(result.text).toContain('image/png');
    expect(result.text).toContain('4211');
  });

  it('melder statuskoden naar adressen afviser', async () => {
    const result = await probeLogo('http://x/logo.png', panel({ ok: false, status: 404 }));
    expect(result).toEqual({ text: 'Adressen svarede HTTP 404.', ok: false });
  });

  it('afsloerer en fejlside der svarer 200', async () => {
    // Det er den fjendtlige variant: hentningen lykkes, og der er alligevel
    // ikke noget billede. Et Image ville bare staa tomt.
    const result = await probeLogo(
      'http://x/logo.png',
      panel({ headers: { 'content-type': 'text/html' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain('text/html');
    expect(result.text).toContain('ikke et billede');
  });

  it('videregiver netvaerksfejlen ordret nok til at kunne handle paa den', async () => {
    const failing: FetchLike = async () => {
      throw new Error('Network request failed');
    };
    const result = await probeLogo('http://x/logo.png', failing);
    expect(result.ok).toBe(false);
    expect(result.text).toContain('Network request failed');
  });

  it('klarer et svar helt uden headers', async () => {
    const bare: FetchLike = async () =>
      ({ ok: true, status: 200, text: async () => '', json: async () => ({}) }) as Awaited<ReturnType<FetchLike>>;
    const result = await probeLogo('http://x/logo.png', bare);
    expect(result.ok).toBe(false);
    expect(result.text).toContain('ukendt indholdstype');
  });
});
