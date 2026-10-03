import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '@norstream/core';
import { listChannels } from '../storage/channels.js';
import { migrate } from '../storage/schema.js';
import { listSources } from '../storage/sources.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { connectM3u, describeFailure, hostOf } from './connect.js';

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

const LIST = '#EXTM3U\n#EXTINF:-1 tvg-id="dr1.dk" tvg-logo="http://l/dr1.png",DR1\nhttp://x/dr1.m3u8\n';

function serving(body: string, ok = true): FetchLike {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({}),
    text: async () => body,
  })) as unknown as FetchLike;
}

describe('connectM3u', () => {
  // Den her vej var kun tilgaengelig inde i appen, som man skulle logge ind
  // for at komme ind i. Den der kun har en M3U-liste, kunne ikke komme i gang.
  it('opretter kilden og henter listen med det samme', async () => {
    const result = await connectM3u(db, serving(LIST), { url: 'http://liste.example/l.m3u' });

    expect(result.ok).toBe(true);
    expect(await listSources(db)).toHaveLength(1);
    expect(await listChannels(db)).toHaveLength(1);
  });

  it('tager navnet af adressen naar der ikke er givet et', async () => {
    await connectM3u(db, serving(LIST), { url: 'http://liste.example/l.m3u' });
    expect((await listSources(db))[0]?.name).toBe('liste.example');
  });

  it('gemmer XMLTV-adressen naar den er udfyldt', async () => {
    await connectM3u(db, serving(LIST), {
      url: 'http://liste.example/l.m3u',
      xmltvUrl: '  http://liste.example/epg.xml  ',
    });
    expect((await listSources(db))[0]?.xmltvUrl).toBe('http://liste.example/epg.xml');
  });

  it('lader en tom XMLTV-adresse blive til ingenting', async () => {
    await connectM3u(db, serving(LIST), { url: 'http://liste.example/l.m3u', xmltvUrl: '   ' });
    expect((await listSources(db))[0]?.xmltvUrl).toBeNull();
  });

  // En kilde uden kanaler ser i listen ud som en kilde der er holdt op med at
  // virke. Fejlen hoerer til her, hvor adressen stadig staar i feltet.
  it('fjerner kilden igen naar listen er tom', async () => {
    const result = await connectM3u(db, serving('#EXTM3U\n'), { url: 'http://liste.example/l.m3u' });

    expect(result).toEqual({
      ok: false,
      message: 'Listen kunne hentes, men indeholdt ingen kanaler.',
    });
    expect(await listSources(db)).toHaveLength(0);
  });

  it('fjerner kilden igen naar adressen ikke svarer', async () => {
    const result = await connectM3u(db, serving('', false), { url: 'http://liste.example/l.m3u' });

    expect(result.ok).toBe(false);
    expect(await listSources(db)).toHaveLength(0);
  });
});

describe('hostOf', () => {
  it('tager vaerten af en adresse med port', () => {
    expect(hostOf('http://panel.example:8080/x')).toBe('panel.example');
  });

  it('giver et brugbart navn paa noget der ikke er en adresse', () => {
    expect(hostOf('vroevl')).toBe('Kilde');
  });
});

describe('describeFailure', () => {
  // Stream- og API-adresser baerer adgangskoden som et sti-segment, og fejl
  // fra netvaerkslaget citerer rutinemaessigt hele adressen. Uden det her
  // ville en fejlbesked paa skaermen vaere et kodeord.
  it('fjerner brugernavn og adgangskode fra teksten', () => {
    const text = describeFailure(new Error('failed http://p/live/BRUGER/KODE/1.ts'), {
      baseUrl: 'http://p',
      username: 'BRUGER',
      password: 'KODE',
    });
    expect(text).not.toContain('KODE');
    expect(text).not.toContain('BRUGER');
    expect(text).toContain('***');
  });

  it('klipper meget lange fejl af', () => {
    const text = describeFailure(new Error('x'.repeat(1000)), {
      baseUrl: 'http://p',
      username: 'u',
      password: 'p',
    });
    expect(text.length).toBeLessThanOrEqual(300);
  });
});
