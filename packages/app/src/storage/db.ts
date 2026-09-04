import * as SQLite from 'expo-sqlite';
import { migrate } from './schema.js';
import type { SqlDatabase } from './types.js';

const DATABASE_NAME = 'uhf-play.db';

let cached: SqlDatabase | null = null;

/**
 * Aabner databasen og koerer migreringen. expo-sqlite's runAsync-overloads
 * kraever params som naervaerende argument, mens SqlDatabase goer det
 * valgfrit — en lille adapter goer forskellen eksplicit og typesikker, uden
 * at gribe til en cast der ville skjule at typerne ikke passede.
 */
export async function openDatabase(): Promise<SqlDatabase> {
  if (cached !== null) return cached;

  const native = await SQLite.openDatabaseAsync(DATABASE_NAME);

  const db: SqlDatabase = {
    execAsync: (sql) => native.execAsync(sql),
    runAsync: (sql, params = []) => native.runAsync(sql, params),
    getAllAsync: (sql, params = []) => native.getAllAsync(sql, params),
    getFirstAsync: (sql, params = []) => native.getFirstAsync(sql, params),
  };

  await migrate(db);
  cached = db;
  return db;
}
