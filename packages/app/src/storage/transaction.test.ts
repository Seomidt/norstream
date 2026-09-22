import { describe, expect, it } from 'vitest';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import { withTransaction } from './transaction.js';
import type { SqlDatabase } from './types.js';

async function freshDb(): Promise<SqlDatabase> {
  const db = createTestDatabase();
  await migrate(db);
  return db;
}

async function categoryIds(db: SqlDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM categories ORDER BY id');
  return rows.map((r) => r.id);
}

describe('withTransaction', () => {
  it('beholder skrivningerne naar arbejdet loeber igennem', async () => {
    const db = await freshDb();
    await withTransaction(db, async () => {
      await db.runAsync('INSERT INTO categories (id, name) VALUES (?, ?)', ['1', 'Danmark']);
      await db.runAsync('INSERT INTO categories (id, name) VALUES (?, ?)', ['2', 'Sport']);
    });
    expect(await categoryIds(db)).toEqual(['1', '2']);
  });

  it('ruller alt tilbage naar arbejdet kaster midtvejs', async () => {
    const db = await freshDb();
    await expect(
      withTransaction(db, async () => {
        await db.runAsync('INSERT INTO categories (id, name) VALUES (?, ?)', ['1', 'Danmark']);
        throw new Error('afbrudt');
      }),
    ).rejects.toThrow('afbrudt');

    // Uden transaktionen ville '1' vaere committet af sig selv og staa tilbage.
    expect(await categoryIds(db)).toEqual([]);
  });

  it('kaster den oprindelige fejl, ikke en fejl fra ROLLBACK', async () => {
    const db = await freshDb();
    const real = new Error('den rigtige aarsag');

    // Simulerer at transaktionen allerede er væk naar vi naar ROLLBACK: saa
    // svarer SQLite "cannot rollback - no transaction is active". Den besked
    // maa ikke erstatte `real`.
    const sabotaged: SqlDatabase = {
      ...db,
      execAsync: async (sql: string) => {
        if (sql === 'ROLLBACK') throw new Error('cannot rollback - no transaction is active');
        return db.execAsync(sql);
      },
    };

    await expect(
      withTransaction(sabotaged, async () => {
        throw real;
      }),
    ).rejects.toThrow('den rigtige aarsag');

    // Ryd op efter os selv, saa forbindelsen ikke staar i en aaben transaktion.
    await db.execAsync('ROLLBACK');
  });

  it('efterlader ikke en aaben transaktion efter en fejl', async () => {
    const db = await freshDb();
    await expect(
      withTransaction(db, async () => {
        throw new Error('afbrudt');
      }),
    ).rejects.toThrow('afbrudt');

    // Var transaktionen stadig aaben, ville denne BEGIN fejle med
    // "cannot start a transaction within a transaction".
    await expect(
      withTransaction(db, async () => {
        await db.runAsync('INSERT INTO categories (id, name) VALUES (?, ?)', ['1', 'Danmark']);
      }),
    ).resolves.toBeUndefined();
    expect(await categoryIds(db)).toEqual(['1']);
  });
});
