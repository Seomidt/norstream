import { describe, expect, it } from 'vitest';
import { createTestDatabase } from './testDb.js';
import { migrate } from './schema.js';
import { VERIFIED_META_UPSERT } from './vodMetadata.js';
describe('metadata-cache ved samtidige opslag', () => {
  it('et plakatopslag uden genre kan ikke slette validerede reservefelter for samme film', async () => {
    const db = createTestDatabase(); await migrate(db);
    await db.runAsync(VERIFIED_META_UPSERT, ['film', null, null, 1, ',thriller,', 2024, 42]);
    await db.runAsync(VERIFIED_META_UPSERT, ['film', 'https://example.test/p.jpg', 8, 2, '', null, 42]);
    expect(await db.getFirstAsync('SELECT genres, year, tmdb_id FROM vod_posters')).toEqual({ genres: ',thriller,', year: 2024, tmdb_id: 42 });
    await db.runAsync(VERIFIED_META_UPSERT, ['film', null, null, 3, ',drama,', 2025, 99]);
    expect(await db.getFirstAsync('SELECT genres, year, tmdb_id FROM vod_posters')).toEqual({ genres: ',drama,', year: 2025, tmdb_id: 99 });
  });
});
