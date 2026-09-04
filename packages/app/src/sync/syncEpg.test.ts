import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCredentials } from '@uhf-play/core';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { listProgrammes, upsertProgrammes } from '../storage/programmes.js';
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

  it('batches store chunks saa batch bliver flushed flere gange', async () => {
    // Generér 1200 programmer i ét stort chunk. Testen verificerer at batch
    // bliver flushed flere gange ved at tælle hvor mange gange upsertProgrammes kalles.
    //
    // DISCRIMINATION: uden slicing => 1 call, med slicing => 3 calls
    let xml = '<?xml version="1.0"?>\n<tv>\n';
    for (let i = 0; i < 1200; i++) {
      xml += `  <programme start="20260904200000 +0000" stop="20260904210000 +0000" channel="dr1">
    <title>Program ${i}</title>
  </programme>\n`;
    }
    xml += '</tv>';

    // Spy on upsertProgrammes to count flushes
    const programmesModule = await import('../storage/programmes.js');
    const upsertSpy = vi.spyOn(programmesModule, 'upsertProgrammes');

    // Pass a far future date so retention doesn't interfere
    const futureDate = new Date(Date.UTC(2027, 0, 1, 0));
    const result = await syncEpg(db, creds, source([xml]), futureDate);

    // Verify all 1200 were parsed
    expect(result.programmes).toBe(1200);

    // Verify batching happened: > 1 call means multiple flushes
    expect(upsertSpy).toHaveBeenCalledTimes(3);

    upsertSpy.mockRestore();
  });

  it('sletter ikke gamle programmer naar sync parsede nul', async () => {
    // Seed et gammelt program som ville blive slettet hvis vi parsede noget
    const { upsertProgrammes } = await import('../storage/programmes.js');
    const oldProgram = {
      channelId: 'dr1',
      title: 'Gammelt',
      description: null,
      start: new Date(Date.UTC(2026, 8, 1, 20)),
      stop: new Date(Date.UTC(2026, 8, 1, 21)),
    };
    await upsertProgrammes(db, [oldProgram]);

    // Synk malformet input (0 programmer parsed) med cutoff tidlig nok til at gammelt
    // program ville blive slettet hvis total > 0
    await syncEpg(db, creds, source(['dette er ikke XML']), new Date(Date.UTC(2026, 8, 4, 12)));

    // Gammelt program skal stadig være der fordi vi parsede 0 programmer
    const list = await listProgrammes(
      db,
      'dr1',
      new Date(Date.UTC(2026, 8, 1)),
      new Date(Date.UTC(2026, 8, 5)),
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe('Gammelt');
  });

});
