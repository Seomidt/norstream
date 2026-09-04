/** De vaerdityper appen faktisk binder til SQL-parametre. */
export type SqlValue = string | number | null;

/**
 * Appens egen graenseflade mod SQLite — ikke noget expo-sqlite opfylder
 * direkte. En lille adapter i db.ts binder den til den rigtige database;
 * tests koerer mod node:sqlite uden emulator via samme graenseflade.
 */
export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqlValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
}
