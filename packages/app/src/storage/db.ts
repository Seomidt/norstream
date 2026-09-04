import * as SQLite from 'expo-sqlite';
import { migrate } from './schema.js';
import type { SqlDatabase } from './types.js';

const DATABASE_NAME = 'uhf-play.db';

let cached: SqlDatabase | null = null;

/**
 * Aabner databasen og koerer migreringen. expo-sqlite's async-API opfylder
 * SqlDatabase direkte, saa der er ingen adapter mellem app og repositories.
 */
export async function openDatabase(): Promise<SqlDatabase> {
  if (cached !== null) return cached;
  // Enkelt cast, ikke "as unknown as": SqlDatabase er formet saa expo-sqlite's
  // rigtige type er tilordnelig. En dobbelt-cast ville slaa typekontrollen fra
  // netop paa graensen mellem app og repositories.
  const db: SqlDatabase = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await migrate(db);
  cached = db;
  return db;
}
