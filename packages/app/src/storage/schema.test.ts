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
