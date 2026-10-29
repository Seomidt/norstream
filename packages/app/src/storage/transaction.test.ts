import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from './testDb.js';
import { withTransaction } from './transaction.js';
import type { SqlDatabase } from './types.js';

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await db.execAsync('CREATE TABLE t (v INTEGER)');
});

async function count(): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM t'))?.n ?? 0;
}

describe('withTransaction', () => {
  it('skriver alt eller intet', async () => {
    await withTransaction(db, async () => {
      await db.runAsync('INSERT INTO t VALUES (1)');
      await db.runAsync('INSERT INTO t VALUES (2)');
    });
    expect(await count()).toBe(2);

    await expect(
      withTransaction(db, async () => {
        await db.runAsync('INSERT INTO t VALUES (3)');
        throw new Error('afbrudt');
      }),
    ).rejects.toThrow('afbrudt');
    expect(await count()).toBe(2);
  });

  it('kan nestes: den yderste bestemmer', async () => {
    await expect(
      withTransaction(db, async () => {
        await db.runAsync('INSERT INTO t VALUES (1)');
        await withTransaction(db, async () => {
          await db.runAsync('INSERT INTO t VALUES (2)');
        });
        throw new Error('afbrudt udenfor');
      }),
    ).rejects.toThrow();
    expect(await count()).toBe(0);

    await withTransaction(db, async () => {
      await withTransaction(db, async () => {
        await db.runAsync('INSERT INTO t VALUES (1)');
      });
    });
    expect(await count()).toBe(1);
  });

  it('efterlader ingen aaben transaktion efter en fejl', async () => {
    await withTransaction(db, async () => {
      throw new Error('x');
    }).catch(() => undefined);
    // En ny BEGIN ville fejle hvis den gamle stadig var aaben.
    await withTransaction(db, async () => {
      await db.runAsync('INSERT INTO t VALUES (1)');
    });
    expect(await count()).toBe(1);
  });
});
