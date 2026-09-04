import { beforeEach, describe, expect, it } from 'vitest';
import type { Programme } from '@uhf-play/core';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';
import {
  deleteProgrammesBefore,
  getNowNext,
  listProgrammes,
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
