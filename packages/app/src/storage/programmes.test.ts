import { beforeEach, describe, expect, it } from 'vitest';
import type { Programme } from '@norstream/core';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';
import {
  deleteProgrammesBefore,
  getNowNext,
  listProgrammes,
  listProgrammesFor,
  nowNextFor,
  nowProgrammesFor,
  nowTitlesFor,
  upsertProgrammes,
} from './programmes.js';

const T = (h: number): Date => new Date(Date.UTC(2026, 8, 4, h, 0, 0));

function prog(channelId: string, from: number, to: number, title: string): Programme {
  return { channelId, title, description: null, start: T(from), stop: T(to) };
}

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('upsertProgrammes', () => {
  it('gemmer og henter i tidsraekkefoelge', async () => {
    await upsertProgrammes(db, [
      prog('dr1', 21, 22, 'Sporten'),
      prog('dr1', 20, 21, 'TV Avisen'),
    ]);
    const list = await listProgrammes(db, 'dr1', T(19), T(23));
    expect(list.map((p) => p.title)).toEqual(['TV Avisen', 'Sporten']);
  });

  it('overskriver et program med samme kanal og starttid', async () => {
    await upsertProgrammes(db, [prog('dr1', 20, 21, 'Gammel titel')]);
    await upsertProgrammes(db, [prog('dr1', 20, 21, 'Ny titel')]);
    const list = await listProgrammes(db, 'dr1', T(19), T(22));
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe('Ny titel');
  });

  it('replaceWindow: et program der flyttede sig efterlader ikke et spoegelse (v360)', async () => {
    // Gaarsdagens oversigt: nyheder 18–19, haandbold 20–22, golf 22–23. Dagens:
    // basketball 19:30–21:30, film 21:30–23. Alt der overlapper det nye tidsrum
    // er modsagt af det nye (to programmer sender ikke samtidig) og ryger.
    await upsertProgrammes(db, [prog('sport1', 18, 19, 'Nyheder'), prog('sport1', 20, 22, 'Håndbold'), prog('sport1', 22, 23, 'Golf')]);
    const half = (h: number, m: number): Date => new Date(Date.UTC(2026, 8, 4, h, m, 0));
    await upsertProgrammes(
      db,
      [
        { channelId: 'sport1', title: 'Basketball', description: null, start: half(19, 30), stop: half(21, 30) },
        { channelId: 'sport1', title: 'Film', description: null, start: half(21, 30), stop: half(23, 0) },
        // En anden kanal roeres ikke af sport1's vindue.
        prog('dr1', 20, 21, 'TV Avisen'),
      ],
      { replaceWindow: true },
    );
    const list = await listProgrammes(db, 'sport1', T(17), T(24));
    // Nyheder (18–19) ligger foer vinduet og bliver; Haandbold og Golf i vinduet er vaek.
    expect(list.map((p) => p.title)).toEqual(['Nyheder', 'Basketball', 'Film']);
    expect((await listProgrammes(db, 'dr1', T(19), T(22))).map((p) => p.title)).toEqual(['TV Avisen']);
  });

  it('uden replaceWindow bliver det gamle liggende (som foer)', async () => {
    await upsertProgrammes(db, [prog('sport1', 20, 22, 'Håndbold')]);
    await upsertProgrammes(db, [prog('sport1', 21, 23, 'Basketball')]);
    expect((await listProgrammes(db, 'sport1', T(19), T(24))).map((p) => p.title)).toEqual(['Håndbold', 'Basketball']);
  });

  it('afdupliker samme (kanal, starttid) i ét kald — den sidste vinder', async () => {
    // En batch-INSERT med to ens noegler ville ellers faa SQLite til at kaste.
    await upsertProgrammes(db, [
      prog('dr1', 20, 21, 'Foerste'),
      prog('dr1', 20, 21, 'Sidste'),
    ]);
    const list = await listProgrammes(db, 'dr1', T(19), T(22));
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe('Sidste');
  });

  it('skriver mange raekker i ét kald (over baade batch- og transaktions-klumpen)', async () => {
    // Over 1800 raekker, saa det gaar gennem flere transaktioner.
    const many = Array.from({ length: 2000 }, (_, i) => prog('dr1', i, i + 1, `P${i}`));
    await upsertProgrammes(db, many);
    const list = await listProgrammes(db, 'dr1', T(0), T(2001));
    expect(list).toHaveLength(2000);
    expect(list[0]?.title).toBe('P0');
    expect(list[1999]?.title).toBe('P1999');
  });

  it('bevarer beskrivelsen', async () => {
    await upsertProgrammes(db, [
      { ...prog('dr1', 20, 21, 'TV Avisen'), description: 'Nyheder' },
    ]);
    expect((await listProgrammes(db, 'dr1', T(19), T(22)))[0]?.description).toBe(
      'Nyheder',
    );
  });

  it('returnerer Date-objekter, ikke tal', async () => {
    await upsertProgrammes(db, [prog('dr1', 20, 21, 'TV Avisen')]);
    const first = (await listProgrammes(db, 'dr1', T(19), T(22)))[0];
    expect(first?.start).toBeInstanceOf(Date);
    expect(first?.start.toISOString()).toBe('2026-09-04T20:00:00.000Z');
  });
});

describe('nowTitlesFor', () => {
  it('giver nu-titlen for hver kanal i ét opslag', async () => {
    await upsertProgrammes(db, [
      prog('dr1', 20, 21, 'TV Avisen'),
      prog('dr1', 21, 22, 'Bagefter'),
      prog('tv2', 19, 22, 'Film'),
      prog('dr2', 8, 9, 'I morges'),
    ]);
    const titles = await nowTitlesFor(db, ['dr1', 'tv2', 'dr2', 'ukendt'], T(20));
    expect(titles.get('dr1')).toBe('TV Avisen');
    expect(titles.get('tv2')).toBe('Film');
    // dr2 sender ikke noget kl. 20, og en ukendt kanal har ingen raekke.
    expect(titles.has('dr2')).toBe(false);
    expect(titles.has('ukendt')).toBe(false);
  });

  it('vaelger den senest begyndte ved overlap (som getNowNext)', async () => {
    await upsertProgrammes(db, [
      prog('dr1', 18, 22, 'Lang udsendelse'),
      prog('dr1', 20, 21, 'Indslag'),
    ]);
    expect((await nowTitlesFor(db, ['dr1'], T(20))).get('dr1')).toBe('Indslag');
  });

  it('tom liste giver et tomt opslag', async () => {
    expect((await nowTitlesFor(db, [], T(20))).size).toBe(0);
  });
});

describe('listProgrammes', () => {
  beforeEach(async () => {
    await upsertProgrammes(db, [
      prog('dr1', 18, 19, 'Tidligt'),
      prog('dr1', 20, 21, 'TV Avisen'),
      prog('dr1', 22, 23, 'Sent'),
      prog('tv2', 20, 21, 'Anden kanal'),
    ]);
  });

  it('medtager programmer der overlapper vinduet', async () => {
    expect((await listProgrammes(db, 'dr1', T(20), T(21))).map((p) => p.title)).toEqual(
      ['TV Avisen'],
    );
  });

  it('udelader andre kanaler', async () => {
    const list = await listProgrammes(db, 'dr1', T(17), T(24));
    expect(list.every((p) => p.channelId === 'dr1')).toBe(true);
  });

  it('returnerer tom liste for en ukendt kanal', async () => {
    expect(await listProgrammes(db, 'findes-ikke', T(17), T(24))).toEqual([]);
  });
});

describe('getNowNext', () => {
  beforeEach(async () => {
    await upsertProgrammes(db, [
      prog('dr1', 20, 21, 'TV Avisen'),
      prog('dr1', 21, 22, 'Sporten'),
    ]);
  });

  it('finder det igangvaerende og det naeste program', async () => {
    const result = await getNowNext(db, 'dr1', T(20));
    expect(result.now?.title).toBe('TV Avisen');
    expect(result.next?.title).toBe('Sporten');
  });

  it('regner sluttidspunktet som eksklusivt', async () => {
    expect((await getNowNext(db, 'dr1', T(21))).now?.title).toBe('Sporten');
  });

  it('giver null for naeste naar der ikke kommer mere', async () => {
    expect((await getNowNext(db, 'dr1', T(21))).next).toBeNull();
  });

  it('giver null for begge naar der ikke sendes noget', async () => {
    const result = await getNowNext(db, 'dr1', T(23));
    expect(result.now).toBeNull();
    expect(result.next).toBeNull();
  });

  it('giver null for begge naar kanalen ikke har EPG-data', async () => {
    const result = await getNowNext(db, 'ukendt', T(20));
    expect(result.now).toBeNull();
    expect(result.next).toBeNull();
  });

  it('returnerer det foegende program selv hvis der ikke sendes noget nu (i en pause)', async () => {
    // Programmer: A fra 20-21, B fra 22-23, query midt i pausen (21:30)
    // Bruger anden kanal for ikke at konflikte med beforeEach
    await upsertProgrammes(db, [
      prog('tv2', 20, 21, 'A'),
      prog('tv2', 22, 23, 'B'),
    ]);
    // Query at 21:30 (midtvejs mellem de to programmer)
    const queryTime = new Date(Date.UTC(2026, 8, 4, 21, 30, 0));
    const result = await getNowNext(db, 'tv2', queryTime);
    expect(result.now).toBeNull();
    expect(result.next?.title).toBe('B');
  });

  it('returnerer det foerste program hvis der ikke sendes noget endnu', async () => {
    // Query foer det foerste program
    const result = await getNowNext(db, 'dr1', T(19));
    expect(result.now).toBeNull();
    expect(result.next?.title).toBe('TV Avisen');
  });
});

describe('deleteProgrammesBefore', () => {
  it('fjerner programmer der er sluttet foer skaeringstidspunktet', async () => {
    await upsertProgrammes(db, [
      prog('dr1', 18, 19, 'Gammelt'),
      prog('dr1', 20, 21, 'Nyt'),
    ]);
    await deleteProgrammesBefore(db, T(20));
    expect((await listProgrammes(db, 'dr1', T(17), T(24))).map((p) => p.title)).toEqual(
      ['Nyt'],
    );
  });
});

describe('listProgrammesFor / nowNextFor (v340)', () => {
  beforeEach(async () => {
    await upsertProgrammes(db, [
      prog('dr1', 19, 20, 'Nyheder'),
      prog('dr1', 20, 21, 'Film'),
      prog('dr1', 21, 23, 'Sen film'),
      prog('tv2', 18, 22, 'Kampen'),
      prog('tv2', 22, 23, 'Sporten'),
      prog('dr2', 23, 24, 'Natten'),
    ]);
  });

  it('henter vinduet for flere kanaler i ét opslag, sorteret', async () => {
    const list = await listProgrammesFor(db, ['dr1', 'tv2', 'ukendt'], T(20), T(22));
    expect(list.map((p) => `${p.channelId}:${p.title}`)).toEqual(['tv2:Kampen', 'dr1:Film', 'dr1:Sen film']);
    expect(await listProgrammesFor(db, [], T(20), T(22))).toEqual([]);
  });

  it('nu og naeste per kanal; kanaler uden data mangler i svaret', async () => {
    const pairs = await nowNextFor(db, ['dr1', 'tv2', 'dr2'], T(20.5));
    expect(pairs.get('dr1')?.now?.title).toBe('Film');
    expect(pairs.get('dr1')?.next?.title).toBe('Sen film');
    expect(pairs.get('tv2')?.now?.title).toBe('Kampen');
    expect(pairs.get('tv2')?.next?.title).toBe('Sporten');
    // dr2 sender intet kl. 20.30, men "naeste" er der.
    expect(pairs.get('dr2')?.now).toBeNull();
    expect(pairs.get('dr2')?.next?.title).toBe('Natten');
    expect(pairs.has('ukendt')).toBe(false);
  });
});

describe('forsidens samlede nu-opslag', () => {
  it('bevarer start-forfra-data og vaelger seneste start ved overlap', async () => {
    await upsertProgrammes(db, [
      prog('dr1', 19, 22, 'Gammelt overlap'),
      { ...prog('dr1', 20, 21, 'Nyheder'), description: 'Beskrivelse' },
      prog('dr2', 19, 20, 'Sluttet'),
      prog('dr2', 21, 22, 'Fremtid'),
      prog('tv2', 20, 22, 'Film'),
    ]);
    let reads = 0;
    const counted: SqlDatabase = { ...db, getAllAsync: async (sql, params) => {
      reads++;
      return db.getAllAsync(sql, params);
    } };
    const result = await nowProgrammesFor(counted, ['dr1', 'dr1', 'dr2', 'tv2', 'ukendt'], T(20));
    expect(reads).toBe(1);
    expect(result.get('dr1')).toEqual((await getNowNext(db, 'dr1', T(20))).now);
    expect(result.get('dr1')?.description).toBe('Beskrivelse');
    expect(result.get('tv2')?.title).toBe('Film');
    expect(result.has('dr2')).toBe(false);
    expect(result.has('ukendt')).toBe(false);
  });

  it('klarer mere end SQLites variabelgraense og tomme lister', async () => {
    const ids = Array.from({ length: 1100 }, (_, i) => `c${i}`);
    await upsertProgrammes(db, ids.map((id) => prog(id, 20, 21, id)));
    expect((await nowProgrammesFor(db, ids, T(20))).size).toBe(1100);
    expect((await nowProgrammesFor(db, [], T(20))).size).toBe(0);
  });
});
