import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCredentials } from '@uhf-play/core';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { listProgrammes } from '../storage/programmes.js';
import { syncEpg } from './syncEpg.js';
import type { TextChunkSource } from './syncEpg.js';

const creds: XtreamCredentials = {
  baseUrl: 'http://panel.example:8080',
  username: 'USER',
  password: 'PASS',
};

const XML = `<?xml version="1.0"?>
<tv>
  <programme start="20260904200000 +0000" stop="20260904210000 +0000" channel="dr1">
    <title>TV Avisen</title><desc>Nyheder</desc>
  </programme>
  <programme start="20260904210000 +0000" stop="20260904220000 +0000" channel="dr1">
    <title>Sporten</title>
  </programme>
</tv>`;

function source(chunks: string[]): TextChunkSource {
  return vi.fn(async () => ({
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  }));
}

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('syncEpg', () => {
  it('skriver programmer fra et samlet dokument', async () => {
    const result = await syncEpg(db, creds, source([XML]));
    expect(result.programmes).toBe(2);
    const list = await listProgrammes(
      db,
      'dr1',
      new Date(Date.UTC(2026, 8, 4, 19)),
      new Date(Date.UTC(2026, 8, 4, 23)),
    );
    expect(list.map((p) => p.title)).toEqual(['TV Avisen', 'Sporten']);
    expect(list[0]?.description).toBe('Nyheder');
  });

  it('giver samme resultat naar dokumentet kommer i bidder', async () => {
    const cut = Math.floor(XML.length / 2);
    const result = await syncEpg(db, creds, source([XML.slice(0, cut), XML.slice(cut)]));
    expect(result.programmes).toBe(2);
  });

  it('henter fra den xmltv-URL core bygger', async () => {
    const src = source([XML]);
    await syncEpg(db, creds, src);
    expect(src).toHaveBeenCalledWith(
      'http://panel.example:8080/xmltv.php?username=USER&password=PASS',
    );
  });

  it('rydder programmer der er sluttet foer skaeringstidspunktet', async () => {
    const old = `<tv><programme start="20260901200000 +0000" stop="20260901210000 +0000"
      channel="dr1"><title>Gammelt</title></programme></tv>`;
    await syncEpg(db, creds, source([old]), new Date(Date.UTC(2026, 8, 4, 12)));
    const list = await listProgrammes(
      db,
      'dr1',
      new Date(Date.UTC(2026, 8, 1)),
      new Date(Date.UTC(2026, 8, 5)),
    );
    expect(list).toHaveLength(0);
  });

  it('taeller nul og kaster ikke paa vroevl', async () => {
    const result = await syncEpg(db, creds, source(['dette er ikke XML']));
    expect(result.programmes).toBe(0);
  });

  it('lader en netvaerksfejl boble op', async () => {
    const failing: TextChunkSource = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(syncEpg(db, creds, failing)).rejects.toThrow('ECONNREFUSED');
  });
});
