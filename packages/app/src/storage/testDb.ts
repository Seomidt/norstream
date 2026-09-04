import { createRequire } from 'node:module';
import type { SqlDatabase, SqlValue } from './types.js';

/**
 * In-memory SQLite til tests, bygget paa Node's indbyggede modul.
 * Giver rigtig SQL-adfaerd — indekser, constraints, UPSERT — uden en
 * ekstra afhaengighed og uden emulator.
 */
export function createTestDatabase(): SqlDatabase {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  return {
    async execAsync(sql: string): Promise<void> {
      db.exec(sql);
    },
    async runAsync(sql: string, params: SqlValue[] = []): Promise<unknown> {
      return db.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[] = []): Promise<T | null> {
      const row = db.prepare(sql).get(...params);
      return (row ?? null) as T | null;
    },
  };
}
