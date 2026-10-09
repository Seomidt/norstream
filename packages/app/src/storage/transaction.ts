import type { SqlDatabase } from './types.js';

/**
 * Én samlet skrivning.
 *
 * Uden en transaktion skriver SQLite hver saetning til disken for sig, og
 * 22.000 kanaler bliver til 22.000 skrivninger — det er derfor listen stod
 * tom laenge efter opsaetning, og guiden froes mens der synkroniseredes.
 * Inden i én transaktion er det én skrivning, og et afbrudt sync efterlader
 * den gamle liste hel i stedet for halvt udskiftet.
 *
 * Kan nestes: den yderste aabner og lukker, de indre koerer bare med. SQLite
 * kan ikke begynde en transaktion inde i en anden, og de skrivende lag
 * kalder hinanden (VOD-listen skriver kategorier og titler i ét).
 */
const depth = new WeakMap<SqlDatabase, number>();

export async function withTransaction<T>(db: SqlDatabase, work: () => Promise<T>): Promise<T> {
  const current = depth.get(db) ?? 0;
  if (current > 0) {
    depth.set(db, current + 1);
    try {
      return await work();
    } finally {
      depth.set(db, (depth.get(db) ?? 1) - 1);
    }
  }
  depth.set(db, 1);
  await db.execAsync('BEGIN');
  try {
    const result = await work();
    await db.execAsync('COMMIT');
    return result;
  } catch (cause) {
    // Uden det her ville en afbrudt skrivning efterlade en aaben transaktion,
    // og saa er hele databasen laast til appen bliver lukket ned.
    await db.execAsync('ROLLBACK').catch(() => undefined);
    throw cause;
  } finally {
    depth.set(db, 0);
  }
}
