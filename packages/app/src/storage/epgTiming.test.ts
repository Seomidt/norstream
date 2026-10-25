import { beforeEach, describe, expect, it } from 'vitest';
import type { Programme } from '@norstream/core';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';
import {
  epgTimingRevision, getArchiveTimeShift, getEpgTimeShift, setEpgTimeShifts,
} from './epgTiming.js';
import {
  deleteProgrammesBefore, getNowNext, listProgrammes, listProgrammesFor,
  nowNextFor, nowProgrammesFor, nowTitlesFor, upsertProgrammes,
} from './programmes.js';
import { getEpgFreshness } from './epgFetch.js';
import { searchProgrammes } from './sport.js';

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 25, hour, minute));
const displayClock = (date: Date) => new Intl.DateTimeFormat('da-DK', {
  timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(date).replace('.', ':');
const programme = (channelId: string, from: Date, to: Date, title: string): Programme => ({
  channelId, start: from, stop: to, title, description: null,
});
let db: SqlDatabase;
async function source(database: SqlDatabase, id: string, kind = 'xtream') {
  await database.runAsync('INSERT INTO sources (id,kind,name,url,created_at) VALUES (?,?,?,?,?)', [id, kind, id, 'https://example.invalid', 1]);
  await database.runAsync('INSERT INTO channels (id,source_id,stream_id,name) VALUES (?,?,?,?)', [`${id}:tv2`, id, 'tv2', 'TV 2']);
}
beforeEach(async () => { db = createTestDatabase(); await migrate(db); });

describe('kildeopdelt EPG-tid over uforandrede raadata', () => {
  it('retter fotoets 18:00 News til 19:00 i alle laeseveje og vaelger det rigtige nu-program', async () => {
    await source(db, 'panel');
    await upsertProgrammes(db, [
      programme('panel:tv2', at(17), at(17, 30), '19 News'),
      programme('panel:tv2', at(17, 30), at(18), 'Regionalprogram'),
      programme('panel:tv2', at(18), at(18, 50), 'Rivalerne'),
    ]);
    await setEpgTimeShifts(db, 'panel', { epgMinutes: 60, archiveMinutes: 60 });
    const now = at(18, 15);
    const pair = await getNowNext(db, 'panel:tv2', now);
    expect(pair.now?.title).toBe('19 News');
    expect(displayClock(pair.now!.start)).toBe('19:00');
    expect(displayClock(pair.next!.start)).toBe('19:30');
    expect((await nowTitlesFor(db, ['panel:tv2'], now)).get('panel:tv2')).toBe('19 News');
    expect((await nowProgrammesFor(db, ['panel:tv2'], now)).get('panel:tv2')?.title).toBe('19 News');
    expect((await nowNextFor(db, ['panel:tv2'], now)).get('panel:tv2')?.now?.title).toBe('19 News');
    expect((await listProgrammesFor(db, ['panel:tv2'], at(18), at(18, 30))).map(p => p.title)).toEqual(['19 News']);
    expect((await searchProgrammes(db, ['News'], at(18).getTime(), at(18, 30).getTime()))[0]?.startMs).toBe(at(18).getTime());
    expect((await getEpgFreshness(db, 'panel:tv2')).latestStopMs).toBe(at(19, 50).getTime());
    expect(await db.getAllAsync('SELECT start_ms,stop_ms FROM programmes ORDER BY start_ms')).toEqual([
      { start_ms: at(17).getTime(), stop_ms: at(17, 30).getTime() },
      { start_ms: at(17, 30).getTime(), stop_ms: at(18).getTime() },
      { start_ms: at(18).getTime(), stop_ms: at(18, 50).getTime() },
    ]);
  });

  it('anvender rettelsen kun én gang ved ny hentning, genstart og indstillingsaendring', async () => {
    await source(db, 'panel');
    const raw = programme('panel:tv2', at(17), at(18), 'News');
    await upsertProgrammes(db, [raw]);
    await setEpgTimeShifts(db, 'panel', { epgMinutes: 60, archiveMinutes: 60 });
    await upsertProgrammes(db, [raw], { replaceWindow: true });
    await migrate(db);
    expect((await listProgrammes(db, raw.channelId, at(18), at(19)))[0]?.start).toEqual(at(18));
    await setEpgTimeShifts(db, 'panel', { epgMinutes: 120, archiveMinutes: 60 });
    expect((await listProgrammes(db, raw.channelId, at(19), at(20)))[0]?.start).toEqual(at(19));
    await setEpgTimeShifts(db, 'panel', { epgMinutes: 0, archiveMinutes: 0 });
    expect((await listProgrammes(db, raw.channelId, at(17), at(18)))[0]?.start).toEqual(at(17));
    expect((await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM programmes'))?.n).toBe(1);
  });

  it('holder andre kilder og databaser adskilt og flytter korrekt over midnat', async () => {
    await source(db, 'a'); await source(db, 'b');
    const other = createTestDatabase(); await migrate(other); await source(other, 'a');
    const raw = programme('a:tv2', at(23, 30), at(24, 30), 'Nat');
    await upsertProgrammes(db, [raw, { ...raw, channelId: 'b:tv2' }]);
    await upsertProgrammes(other, [raw]);
    await setEpgTimeShifts(db, 'a', { epgMinutes: 60, archiveMinutes: 0 });
    expect((await getNowNext(db, 'a:tv2', at(24, 45))).now?.title).toBe('Nat');
    expect((await getNowNext(db, 'b:tv2', at(24, 45))).now).toBeNull();
    expect((await getNowNext(other, 'a:tv2', at(24, 45))).now).toBeNull();
    expect(await getArchiveTimeShift(db, 'a')).toBe(0);
    expect(epgTimingRevision(db)).toBe(1);
    expect(epgTimingRevision(other)).toBe(0);
  });

  it('sletter efter effektiv sluttid uden at ramme en senere gentagelse af samme titel', async () => {
    await source(db, 'a'); await source(db, 'b');
    await upsertProgrammes(db, [
      programme('a:tv2', at(17), at(18), 'News'),
      programme('a:tv2', at(19), at(20), 'News'),
      programme('b:tv2', at(17), at(18), 'News'),
    ]);
    await setEpgTimeShifts(db, 'a', { epgMinutes: 60, archiveMinutes: 0 });
    await deleteProgrammesBefore(db, at(18));
    expect((await db.getAllAsync<{ channel_id: string; start_ms: number }>('SELECT channel_id,start_ms FROM programmes ORDER BY start_ms')).map(p => p.channel_id)).toEqual(['a:tv2', 'a:tv2']);
  });

  it('oprydning har korrekte inklusionsgraenser ved begge maksimale tidsrettelser', async () => {
    await source(db, 'plus'); await source(db, 'minus');
    await setEpgTimeShifts(db, 'plus', { epgMinutes: 720, archiveMinutes: 0 });
    await setEpgTimeShifts(db, 'minus', { epgMinutes: -720, archiveMinutes: 0 });
    const cutoff = at(18).getTime();
    for (const [id, shift] of [['plus', 12 * 3_600_000], ['minus', -12 * 3_600_000]] as const) {
      await upsertProgrammes(db, [
        programme(`${id}:tv2`, new Date(cutoff - shift - 60_000), new Date(cutoff - shift), 'Slut ved graensen'),
        programme(`${id}:tv2`, new Date(cutoff - shift - 30_000), new Date(cutoff - shift + 1), 'Stadig i gang'),
      ]);
    }
    await deleteProgrammesBefore(db, new Date(cutoff));
    expect(await db.getAllAsync('SELECT channel_id,title FROM programmes ORDER BY channel_id')).toEqual([
      { channel_id: 'minus:tv2', title: 'Stadig i gang' },
      { channel_id: 'plus:tv2', title: 'Stadig i gang' },
    ]);
  });

  it('sportens raa kandidatvindue mister ingen programmer ved +/-720 minutter', async () => {
    await source(db, 'plus'); await source(db, 'minus');
    await setEpgTimeShifts(db, 'plus', { epgMinutes: 720, archiveMinutes: 0 });
    await setEpgTimeShifts(db, 'minus', { epgMinutes: -720, archiveMinutes: 0 });
    const from = at(18).getTime(), to = at(19).getTime();
    for (const [id, shift] of [['plus', 12 * 3_600_000], ['minus', -12 * 3_600_000]] as const) {
      await upsertProgrammes(db, [
        programme(`${id}:tv2`, new Date(from - shift - 60_000), new Date(from - shift), 'Sport foer'),
        programme(`${id}:tv2`, new Date(from - shift), new Date(from - shift + 1), 'Sport foerste millisekund'),
        programme(`${id}:tv2`, new Date(to - shift - 1), new Date(to - shift + 60_000), 'Sport sidste millisekund'),
        programme(`${id}:tv2`, new Date(to - shift), new Date(to - shift + 120_000), 'Sport efter'),
      ]);
    }
    const results = await searchProgrammes(db, ['Sport'], from, to);
    expect(results).toHaveLength(4);
    expect(results.map(p => p.title).sort()).toEqual([
      'Sport foerste millisekund', 'Sport foerste millisekund',
      'Sport sidste millisekund', 'Sport sidste millisekund',
    ]);
  });

  it('afviser ugyldige indstillinger atomisk og holder SQL-/JS-validering ens', async () => {
    await source(db, 'a');
    await upsertProgrammes(db, [programme('a:tv2', at(17), at(18), 'News')]);
    await setEpgTimeShifts(db, 'a', { epgMinutes: 60, archiveMinutes: 0 });
    await expect(setEpgTimeShifts(db, 'a', { epgMinutes: 30, archiveMinutes: 721 })).rejects.toThrow();
    expect(await getEpgTimeShift(db, 'a')).toBe(60);
    for (const value of ['junk', '60.5', '721', '-721', '+60', '060', '60x', 'Infinity']) {
      await db.runAsync("UPDATE settings SET value=? WHERE key='epg_shift_minutes:a'", [value]);
      expect(await getEpgTimeShift(db, 'a')).toBe(0);
      expect((await listProgrammes(db, 'a:tv2', at(17), at(18)))[0]?.start).toEqual(at(17));
    }
  });

  it('finder kildekorrektionen fra en sammensat noegle foer en kanal er genhaegtet', async () => {
    await upsertProgrammes(db, [programme('orphan:tv2', at(17), at(18), 'News')]);
    await setEpgTimeShifts(db, 'orphan', { epgMinutes: 60, archiveMinutes: 60 });
    expect((await listProgrammes(db, 'orphan:tv2', at(18), at(19)))[0]?.start).toEqual(at(18));
  });
});

describe('v30 til v31: autoriseret korrektion paa allerede tilsluttede paneler', () => {
  it.each([28, 29, 30])('opgraderer v%i uden at flytte raadata eller gentage +60', async version => {
    await source(db, 'panel'); await source(db, 'list', 'm3u'); await source(db, 'custom');
    await upsertProgrammes(db, [programme('panel:tv2', at(17), at(18), '19 News')]);
    await db.runAsync("INSERT INTO favorites (channel_id) VALUES ('panel:tv2')");
    await setEpgTimeShifts(db, 'custom', { epgMinutes: -60, archiveMinutes: 0 });
    await db.execAsync('DROP VIEW programmes_effective');
    await db.execAsync(`PRAGMA user_version = ${version}`);
    await migrate(db);
    expect(await getEpgTimeShift(db, 'panel')).toBe(60);
    expect(await getArchiveTimeShift(db, 'panel')).toBe(60);
    expect(await getEpgTimeShift(db, 'list')).toBe(0);
    expect(await getEpgTimeShift(db, 'custom')).toBe(-60);
    expect(await getArchiveTimeShift(db, 'custom')).toBe(0);
    expect((await db.getFirstAsync<{ start_ms: number }>('SELECT start_ms FROM programmes'))?.start_ms).toBe(at(17).getTime());
    expect(await db.getAllAsync('SELECT channel_id FROM favorites')).toEqual([{ channel_id: 'panel:tv2' }]);
    await setEpgTimeShifts(db, 'panel', { epgMinutes: 0, archiveMinutes: 0 });
    await migrate(db);
    expect(await getEpgTimeShift(db, 'panel')).toBe(0);
    await source(db, 'later');
    expect(await getEpgTimeShift(db, 'later')).toBe(0);
    expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 31 });
  });
});
