/**
 * Den delmaengde af expo-sqlite's API som repositories bruger.
 * Formet efter expo-sqlite, saa den rigtige database opfylder den direkte,
 * og saa tests kan koere mod node:sqlite uden emulator.
 */
export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<void>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}
