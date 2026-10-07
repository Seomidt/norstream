import { describe, expect, it } from 'vitest';
import { logPreviousExits } from './processExit.js';
import type { ProcessExit } from './processExit.js';

const now = Date.UTC(2026, 9, 7, 6, 10);
const record = (extra: Partial<ProcessExit> = {}): ProcessExit => ({
  timestamp: now - 60_000, reason: 5, status: 11,
  pssKiB: 128 * 1024, rssKiB: 256 * 1024,
  lowMemoryReportSupported: true, ...extra,
});

async function lines(exits: ProcessExit[]) {
  const out: string[] = [];
  await logPreviousExits({ recentExits: async () => exits }, (tag, text) => out.push(`${tag}: ${text}`), now);
  return out;
}

describe('Androids afslutningshistorik', () => {
  it('viser native crash og sidste hukommelsesmaaling, men ingen raa spor', async () => {
    const exit = { ...record(), description: 'http://panel/live/user/password/1.ts', trace: 'secret' };
    const out = await lines([exit]);
    expect(out[0]).toContain('native nedbrud (kode 5, status 11)');
    expect(out[0]).toContain('sidste måling PSS/RSS 128/256 MiB');
    expect(out.join()).not.toMatch(/panel|password|secret/);
  });

  it('skelner systemets bekraeftede hukommelsesmangel fra et tvetydigt SIGKILL', async () => {
    const out = await lines([
      record({ reason: 3, status: 0 }),
      record({ reason: 2, status: 9, lowMemoryReportSupported: false }),
      record({ reason: 2, status: 9, lowMemoryReportSupported: true }),
    ]);
    expect(out[0]).toContain('på grund af hukommelsesmangel');
    expect(out[1]).toContain('mulig, ikke bekræftet');
    expect(out[2]).not.toContain('hukommelsesmangel');
  });

  it('kalder ikke en opdatering et nedbrud og gaetter ikke paa nye systemkoder', async () => {
    const out = await lines([record({ reason: 16 }), record({ reason: 99 })]);
    expect(out[0]).toContain('appen blev opdateret');
    expect(out[0]).not.toContain('nedbrud');
    expect(out[1]).toContain('ukendt årsag (kode 99');
  });

  it('udelader gamle, fremtidige og ugyldige maalinger samt begraenser historikken', async () => {
    const out = await lines([
      record({ timestamp: now - 8 * 24 * 60 * 60_000 }),
      record({ timestamp: now + 1 }), record({ pssKiB: NaN }),
      ...Array.from({ length: 20 }, () => record()),
    ]);
    expect(out).toHaveLength(5);
  });

  it('zero er ingen hukommelsesmaaling, ikke et bevis for lavt forbrug', async () => {
    expect((await lines([record({ pssKiB: 0, rssKiB: 0 })]))[0]).toContain('ingen hukommelsesmåling');
  });

  it('manglende modul eller afvist Android-kald kan ikke stoppe opstarten', async () => {
    await expect(logPreviousExits(null)).resolves.toBeUndefined();
    await expect(logPreviousExits({ recentExits: async () => { throw new Error('secret'); } })).resolves.toBeUndefined();
  });
});
