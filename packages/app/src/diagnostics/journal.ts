import type { SqlDatabase } from '../storage/types.js';
import { safe } from './log.js';
export interface LogEntry { at: number; line: string }
export class DiagnosticJournal {
  private pending: LogEntry[] = [];
  private running: Promise<void> | null = null;
  constructor(private db: SqlDatabase) {}
  append(entry: LogEntry): void {
    if (!Number.isFinite(entry.at) || entry.at < 0) return;
    this.pending.push({ at: entry.at, line: safe(entry.line).slice(0, 300) });
    if (this.pending.length > 2000) this.pending.splice(0, this.pending.length - 2000);
  }
  flush(now = Date.now()): Promise<void> {
    if (this.running !== null) return this.running.then(() => this.pending.length > 0 ? this.flush(now) : undefined);
    this.running = this.write(now).finally(() => { this.running = null; });
    return this.running;
  }
  private async write(now: number): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0, 80);
      try {
        await this.db.runAsync(`INSERT INTO diagnostic_log (at,line) VALUES ${batch.map(() => '(?,?)').join(',')}`, batch.flatMap(e => [e.at, e.line]));
      } catch (e) { this.pending.unshift(...batch); throw e; }
    }
    await this.db.runAsync('DELETE FROM diagnostic_log WHERE at < ? OR id NOT IN (SELECT id FROM diagnostic_log ORDER BY id DESC LIMIT 2000)', [now - 24 * 60 * 60_000]);
  }
  async recent(count = 300, now = Date.now()): Promise<LogEntry[]> {
    const rows = await this.db.getAllAsync<LogEntry>('SELECT at,line FROM diagnostic_log WHERE at >= ? ORDER BY id DESC LIMIT ?', [now - 24 * 60 * 60_000, Math.min(2000, Math.max(1, count))]);
    return rows.reverse().map(e => ({ at: e.at, line: safe(e.line).slice(0, 300) }));
  }
}
