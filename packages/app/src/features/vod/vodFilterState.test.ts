import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../storage/schema.js';
import { createTestDatabase } from '../../storage/testDb.js';
import type { SqlDatabase } from '../../storage/types.js';
import { defaultVodFilter, loadVodFilter, saveVodFilter, yearChoices, yearLabel } from './vodFilterState.js';

let db: SqlDatabase;
beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('vodFilterState (v367)', () => {
  it('husker udvalget per slags og kasserer ukendte genrer', async () => {
    await saveVodFilter(db, { kind: 'movie', countries: ['DK', 'GB'], genres: ['thriller'], yearFrom: 2026, yearTo: 2026, sort: 'rating', providers: [8], keys: ['x'] });
    // `keys` (tjeneste-opslagets svar) huskes ikke; tjenesten (8 = Netflix) goer.
    expect(await loadVodFilter(db, 'movie')).toEqual({ kind: 'movie', countries: ['DK', 'GB'], genres: ['thriller'], yearFrom: 2026, yearTo: 2026, sort: 'rating', providers: [8] });
    expect(await loadVodFilter(db, 'series')).toEqual(defaultVodFilter('series'));
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('vod_filter:series', ?)", ['{"genres":["thriller","vrøvl"],"sort":"nonsens"}']);
    const series = await loadVodFilter(db, 'series');
    expect(series.genres).toEqual(['thriller']);
    expect(series.sort).toBe('newest');
  });

  it('aarene: de tre seneste hver for sig, saa spring', () => {
    const choices = yearChoices(new Date('2026-10-04'));
    expect(choices.map((c) => c.label)).toEqual(['Alle år', '2026', '2025', '2024', '2020–2023', '2010–2019', 'Før 2010']);
    expect(choices[6]).toEqual({ label: 'Før 2010', from: null, to: 2009 });
    expect(yearLabel({ ...defaultVodFilter('movie'), yearFrom: 2020, yearTo: 2023 }, choices)).toBe('2020–2023');
    expect(yearLabel({ ...defaultVodFilter('movie'), yearFrom: 1999, yearTo: 1999 }, choices)).toBe('1999');
  });
});
