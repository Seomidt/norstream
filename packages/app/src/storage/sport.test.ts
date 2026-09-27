import { beforeEach, describe, expect, it } from 'vitest';
import { upsertProgrammes } from './programmes.js';
import { migrate } from './schema.js';
import {
  getAutoReminded,
  getSportTeams,
  searchProgrammes,
  setAutoReminded,
  setSportTeams,
  sportChannels,
} from './sport.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';
import { hideCountry } from './countries.js';
import { invalidateQueryCache } from './queryCache.js';

let db: SqlDatabase;
const H = 3_600_000;
const NOW = Date.UTC(2026, 8, 27, 13, 0);

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  invalidateQueryCache();
});

describe('searchProgrammes', () => {
  it('groft filter i databasen: ø og o er det samme, udloebne og for sene er ude', async () => {
    const at = (h: number) => new Date(NOW + h * H);
    await upsertProgrammes(db, [
      { channelId: 'a', title: 'Superliga: Brøndby - AGF', description: null, start: at(2), stop: at(4) },
      { channelId: 'b', title: 'Premier League', description: 'Brondby legend visits', start: at(1), stop: at(2) },
      { channelId: 'a', title: 'Brøndby før kampen', description: null, start: at(-3), stop: at(-2) },
      { channelId: 'c', title: 'Brøndby - FCK', description: null, start: at(200), stop: at(202) },
      { channelId: 'c', title: 'Nyheder', description: null, start: at(2), stop: at(3) },
    ]);
    const rows = await searchProgrammes(db, ['brondby'], NOW, NOW + 168 * H);
    expect(rows.map((r) => r.title)).toEqual(['Premier League', 'Superliga: Brøndby - AGF']);
    expect(await searchProgrammes(db, [], NOW, NOW + H)).toEqual([]);
  });
});

describe('sportChannels', () => {
  it('favoritter foerst, saa sport fra favoritternes lande, skjulte lande ude', async () => {
    await db.runAsync(
      `INSERT INTO categories (id, source_id, name) VALUES
       ('dk', 's', 'DK| SPORT'), ('dkg', 's', 'DK| GENERAL'), ('uk', 's', 'UK| SPORTS'), ('ar', 's', 'SA| BEIN SPORTS')`,
    );
    const channels: Array<[string, string, string, number]> = [
      ['s:1', 'UK: Sky Sports Main Event', 'uk', 1],
      ['s:2', 'DK: TV3 Sport', 'dk', 2],
      ['s:3', 'DK: DR1', 'dkg', 3],
      ['s:4', 'SA: beIN Sports 1', 'ar', 4],
      ['s:5', 'DK: Eurosport 1', 'dk', 5],
    ];
    for (const [id, name, category, order] of channels) {
      await db.runAsync(
        'INSERT INTO channels (id, source_id, stream_id, name, category_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        [id, 's', id.slice(2), name, category, order],
      );
    }
    await db.runAsync('INSERT INTO favorites (channel_id, position) VALUES (?, 0)', ['s:3']);
    await hideCountry(db, 'SA');
    invalidateQueryCache();

    const result = await sportChannels(db);
    expect(result.refresh).toEqual(['s:3', 's:2', 's:5', 's:1']);
    expect([...result.sport].sort()).toEqual(['s:1', 's:2', 's:5']);
    expect(result.hidden.has('s:4')).toBe(true);
    expect(result.rank.get('s:3')).toBe(0);
  });
});

describe('Mine hold', () => {
  it('renser og husker', async () => {
    expect(await getSportTeams(db)).toEqual([]);
    await setSportTeams(db, [' Brøndby ', 'brøndby', 'FC  København', '']);
    expect(await getSportTeams(db)).toEqual(['Brøndby', 'FC København']);
  });

  it('automatiske paamindelser glemmes efter et doegn', async () => {
    await setAutoReminded(db, new Set([`a@${NOW + H}`, `b@${NOW - 2 * 86_400_000}`]));
    expect([...(await getAutoReminded(db, NOW))]).toEqual([`a@${NOW + H}`]);
  });
});
