import { describe, expect, it } from 'vitest';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';

describe('migrate', () => {
  it('opretter alle fem tabeller', async () => {
    const db = createTestDatabase();
    await migrate(db);
    const rows = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = rows.map((r) => r.name);
    expect(names).toContain('categories');
    expect(names).toContain('channels');
    expect(names).toContain('favorites');
    expect(names).toContain('programmes');
    expect(names).toContain('settings');
  });

  it('stempler skemaversionen i user_version', async () => {
    const db = createTestDatabase();
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    expect(row?.user_version).toBeGreaterThan(0);
  });

  it('er idempotent', async () => {
    const db = createTestDatabase();
    await migrate(db);
    await expect(migrate(db)).resolves.toBeUndefined();
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
      ['dr1', 1000, 2000, 'A'],
    );
    await expect(
      db.runAsync(
        'INSERT INTO programmes (channel_id, start_ms, stop_ms, title) VALUES (?, ?, ?, ?)',
        ['dr1', 1000, 3000, 'B'],
      ),
    ).rejects.toThrow();
  });
});

describe('indekser', () => {
  it('kan sortere kanallisten paa indeks i stedet for et midlertidigt trae', async () => {
    const db = createTestDatabase();
    await migrate(db);
    const plan = await db.getAllAsync<{ detail: string }>(
      'EXPLAIN QUERY PLAN SELECT id FROM channels ORDER BY sort_order',
    );
    const detail = plan.map((r) => r.detail).join(' | ');
    // Uden idx_channels_sort svarer SQLite "USE TEMP B-TREE FOR ORDER BY" og
    // bygger et trae over alle 22.142 raekker ved hvert opslag.
    expect(detail).toContain('idx_channels_sort');
    expect(detail).not.toContain('TEMP B-TREE');
  });
});
