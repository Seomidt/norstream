import { createRequire } from 'node:module';
import type { SqlDatabase } from './types.js';

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
    async runAsync(sql: string, params: unknown[] = []): Promise<void> {
      db.prepare(sql).run(...(params as never[]));
    },
    async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const row = db.prepare(sql).get(...(params as never[]));
      return (row ?? null) as T | null;
    },
  };
}
