import { describe, expect, it } from 'vitest';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

/**
 * Skemaet som det faktisk stod paa enheder der allerede har appen installeret.
 * Kopieret fra v1, ikke afledt af det nuvaerende: en migreringstest der bygger
 * sit udgangspunkt af den kode den tester, tester ingenting.
 */
const V1_SCHEMA = `
CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE channels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, number INTEGER, logo_url TEXT,
  category_id TEXT, epg_channel_id TEXT,
  has_archive INTEGER NOT NULL DEFAULT 0, archive_days INTEGER NOT NULL DEFAULT 0,
  is_stale INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE favorites (channel_id TEXT PRIMARY KEY);
CREATE TABLE programmes (
  channel_id TEXT NOT NULL, start_ms INTEGER NOT NULL, stop_ms INTEGER NOT NULL,
  title TEXT NOT NULL, description TEXT, PRIMARY KEY (channel_id, start_ms)
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 1;
`;

async function createV1Database(): Promise<SqlDatabase> {
  const db = createTestDatabase();
  await db.execAsync(V1_SCHEMA);
  return db;
}

async function tableNames(db: SqlDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return rows.map((r) => r.name);
}

async function userVersion(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

describe('migrate paa en frisk database', () => {
  it('opretter alle ni tabeller', async () => {
    const db = createTestDatabase();
    await migrate(db);
    const names = await tableNames(db);
    for (const table of [
      'categories',
      'channels',
      'favorites',
      'favorite_exclusions',
      'programmes',
      'epg_fetch',
      'epg_archive_fetch',
      'hidden_countries',
      'settings',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('stempler skemaversion 3', async () => {
    const db = createTestDatabase();
    await migrate(db);
    expect(await userVersion(db)).toBe(3);
  });

  it('er idempotent og sletter ikke data ved anden koersel', async () => {
    const db = createTestDatabase();
    await migrate(db);
    await db.runAsync('INSERT INTO favorites (channel_id) VALUES (?)', ['247634']);
    await migrate(db);
    const rows = await db.getAllAsync<{ channel_id: string }>(
      'SELECT channel_id FROM favorites',
    );
    expect(rows).toEqual([{ channel_id: '247634' }]);
  });

  it('opretter indekset paa programmernes tidsvindue', async () => {
    const db = createTestDatabase();
    await migrate(db);
    const rows = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index'",
    );
    expect(rows.map((r) => r.name)).toContain('idx_programmes_window');
  });

  it('afviser to programmer med samme kanal og starttid', async () => {
    const db = createTestDatabase();
    await migrate(db);
    await db.runAsync(
      'INSERT INTO programmes (channel_id, start_ms, stop_ms, title) VALUES (?, ?, ?, ?)',
      ['247634', 1000, 2000, 'A'],
    );
    await expect(
      db.runAsync(
        'INSERT INTO programmes (channel_id, start_ms, stop_ms, title) VALUES (?, ?, ?, ?)',
        ['247634', 1000, 3000, 'B'],
      ),
    ).rejects.toThrow();
  });

  it('giver favorites en source_category_id-kolonne', async () => {
    const db = createTestDatabase();
    await migrate(db);
    await db.runAsync(
      'INSERT INTO favorites (channel_id, source_category_id) VALUES (?, ?)',
      ['247634', '85'],
    );
    const row = await db.getFirstAsync<{ source_category_id: string | null }>(
      'SELECT source_category_id FROM favorites WHERE channel_id = ?',
      ['247634'],
    );
    expect(row?.source_category_id).toBe('85');
  });
});

describe('migrate fra v1', () => {
  it('bevarer favoritter hen over genopbygningen', async () => {
    const db = await createV1Database();
    await db.runAsync('INSERT INTO favorites (channel_id) VALUES (?)', ['247634']);
    await db.runAsync('INSERT INTO favorites (channel_id) VALUES (?)', ['247635']);

    await migrate(db);

    const rows = await db.getAllAsync<{ channel_id: string; source_category_id: string | null }>(
      'SELECT channel_id, source_category_id FROM favorites ORDER BY channel_id',
    );
    expect(rows).toEqual([
      { channel_id: '247634', source_category_id: null },
      { channel_id: '247635', source_category_id: null },
    ]);
  });

  it('bevarer timeshift-dialekten, som kun onboarding kan finde igen', async () => {
    const db = await createV1Database();
    await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', [
      'timeshift_dialect',
      'php',
    ]);
    await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', [
      'panel_offset_minutes',
      '120',
    ]);

    await migrate(db);

    const rows = await db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM settings ORDER BY key',
    );
    expect(rows).toEqual([
      { key: 'panel_offset_minutes', value: '120' },
      { key: 'timeshift_dialect', value: 'php' },
    ]);
  });

  it('kasserer last_sync_ms, saa kanaler og EPG hentes paa ny med det samme', async () => {
    const db = await createV1Database();
    await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', [
      'last_sync_ms',
      '1788626052000',
    ]);

    await migrate(db);

    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      ['last_sync_ms'],
    );
    expect(row).toBeNull();
  });

  it('kasserer den gamle EPG, som var noeglet paa epg_channel_id', async () => {
    const db = await createV1Database();
    await db.runAsync(
      'INSERT INTO programmes (channel_id, start_ms, stop_ms, title) VALUES (?, ?, ?, ?)',
      ['dr1.dk', 1000, 2000, 'Gammel'],
    );

    await migrate(db);

    const rows = await db.getAllAsync('SELECT * FROM programmes');
    expect(rows).toEqual([]);
  });

  it('stempler den nuvaerende version og opretter de nye tabeller', async () => {
    const db = await createV1Database();
    await migrate(db);
    expect(await userVersion(db)).toBe(3);
    const names = await tableNames(db);
    expect(names).toContain('epg_fetch');
    expect(names).toContain('hidden_countries');
  });

  it('starter alligevel naar den gamle database er beskadiget', async () => {
    // En halvt migreret v1-database uden favorites-tabel maa ikke kunne
    // laase appen ude. Favoritterne gaar tabt; appen goer ikke.
    const db = createTestDatabase();
    await db.execAsync('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    await db.execAsync('PRAGMA user_version = 1');

    await expect(migrate(db)).resolves.toBeUndefined();
    expect(await userVersion(db)).toBe(3);
    expect(await tableNames(db)).toContain('favorites');
  });
});

/**
 * v2 som den stod paa enheder der naaede at faa den forrige udgave. Igen
 * kopieret frem for afledt: pointen med testen nedenfor er at v2 -> v3 *ikke*
 * maa bygge om, og en test der laaner sit udgangspunkt fra produktionskoden
 * ville ikke kunne se forskellen.
 */
const V2_SCHEMA = `
CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE channels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, number INTEGER, logo_url TEXT,
  category_id TEXT, epg_channel_id TEXT,
  has_archive INTEGER NOT NULL DEFAULT 0, archive_days INTEGER NOT NULL DEFAULT 0,
  is_stale INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE favorites (channel_id TEXT PRIMARY KEY, source_category_id TEXT);
CREATE TABLE favorite_exclusions (channel_id TEXT PRIMARY KEY, category_id TEXT NOT NULL);
CREATE TABLE programmes (
  channel_id TEXT NOT NULL, start_ms INTEGER NOT NULL, stop_ms INTEGER NOT NULL,
  title TEXT NOT NULL, description TEXT, PRIMARY KEY (channel_id, start_ms)
);
CREATE TABLE epg_fetch (stream_id TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL);
CREATE TABLE hidden_countries (name TEXT PRIMARY KEY);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 2;
`;

describe('migrate fra v2', () => {
  it('tilfoejer arkivtabellen uden at roere det der stod i forvejen', async () => {
    const db = createTestDatabase();
    await db.execAsync(V2_SCHEMA);
    await db.runAsync("INSERT INTO favorites VALUES ('247634', 'dk-hd')");
    await db.runAsync("INSERT INTO favorite_exclusions VALUES ('99', 'dk-hd')");
    await db.runAsync(
      "INSERT INTO programmes VALUES ('247634', 1000, 2000, 'TV Avisen', NULL)",
    );
    await db.runAsync("INSERT INTO epg_fetch VALUES ('247634', 1500)");
    await db.runAsync("INSERT INTO hidden_countries VALUES ('__other__')");

    await migrate(db);

    expect(await userVersion(db)).toBe(3);
    expect(await tableNames(db)).toContain('epg_archive_fetch');

    // v2 -> v3 tilfoejer kun en tabel. Bygger den om alligevel, mister
    // brugeren sin oprydning i favoritterne og hele programcachen uden at
    // have faaet noget for det.
    const favorites = await db.getAllAsync<{ channel_id: string }>(
      'SELECT channel_id FROM favorites',
    );
    expect(favorites.map((row) => row.channel_id)).toEqual(['247634']);

    const exclusions = await db.getAllAsync<{ channel_id: string }>(
      'SELECT channel_id FROM favorite_exclusions',
    );
    expect(exclusions).toHaveLength(1);

    const programmes = await db.getAllAsync<{ title: string }>('SELECT title FROM programmes');
    expect(programmes.map((row) => row.title)).toEqual(['TV Avisen']);

    const fetches = await db.getAllAsync<{ stream_id: string }>(
      'SELECT stream_id FROM epg_fetch',
    );
    expect(fetches).toHaveLength(1);

    const hidden = await db.getAllAsync<{ name: string }>('SELECT name FROM hidden_countries');
    expect(hidden.map((row) => row.name)).toEqual(['__other__']);
  });

  it('er idempotent paa v3', async () => {
    const db = createTestDatabase();
    await migrate(db);
    await db.runAsync("INSERT INTO epg_archive_fetch VALUES ('247634', 42)");
    await migrate(db);
    const rows = await db.getAllAsync<{ fetched_at: number }>(
      'SELECT fetched_at FROM epg_archive_fetch',
    );
    expect(rows.map((row) => row.fetched_at)).toEqual([42]);
  });
});
