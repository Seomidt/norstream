import type { SqlDatabase } from '../storage/types.js';
import type { LogEntry } from './journal.js';
import { safe } from './log.js';
export interface DiagnosticSession { token: string; supportCode: string; expiresAt: number }
export interface DiagnosticStore {
  load(): Promise<DiagnosticSession | null>;
  save(value: DiagnosticSession | null): Promise<void>;
}
export interface PlaybackSnapshot {
  observedAt: number; mode: 'archive' | 'live' | 'closed'; status: string; playing: boolean;
  programmeStart?: number; programmeStop?: number; segmentStart?: number;
  position?: number; buffered?: number; duration?: number; queued?: number; rendered?: number; dropped?: number;
}
let playback: PlaybackSnapshot | null = null;
export function setPlaybackSnapshot(value: PlaybackSnapshot): void { playback = value; }
export function closePlaybackSnapshot(): void { if (playback !== null) playback = { ...playback, observedAt: Date.now(), mode: 'closed', playing: false }; }
// Disse id'er bruges kun til idempotens. Upload-adgang gives af serverens
// kryptografiske token, aldrig af Math.random eller rapport-id'et.
export function reportId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
  });
}
export function diagnosticPayload(version: number, entries: LogEntry[], sentAt: number, snapshot = playback, kind: 'heartbeat' | 'failure' = 'heartbeat'): object {
  const selected = entries.slice(-80).map(e => ({ at: e.at, line: safe(e.line).slice(0, 300) }));
  const result = { schema: 1, kind, version, sentAt, entries: selected, playback: snapshot };
  // UTF-8, ikke JavaScripts tegnantal. Plads til requestens id og action.
  const bytes = (text: string) => Array.from(text).reduce((n, c) => n + (c.codePointAt(0)! > 0xffff ? 4 : c.charCodeAt(0) > 0x7ff ? 3 : c.charCodeAt(0) > 0x7f ? 2 : 1), 0);
  while (selected.length > 0 && bytes(JSON.stringify(result)) > 30_000) selected.shift();
  return result;
}
export class DiagnosticReporter {
  session: DiagnosticSession | null = null;
  lastSent: number | null = null;
  private generation = 0;
  private sending: Promise<void> | null = null;
  private lastAttempt = -Infinity;
  private mutations: Promise<unknown> = Promise.resolve();
  private change<T>(action: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(action);
    this.mutations = next.catch(() => undefined);
    return next;
  }
  constructor(private db: SqlDatabase, private store: DiagnosticStore,
    private post: (body: object, token?: string) => Promise<{ status: number; body: Record<string, unknown> }>,
    private version: number, private now: () => number = Date.now) {}
  async init(): Promise<void> {
    const saved = await this.store.load();
    if (saved !== null && saved.expiresAt > this.now() && /^[a-f0-9]{64}$/.test(saved.token) && /^[A-F0-9]{12}$/.test(saved.supportCode)) this.session = saved;
    else if (saved !== null) { await this.store.save(null); await this.db.execAsync('DELETE FROM diagnostic_outbox'); }
  }
  async activate(): Promise<void> {
    const generation = ++this.generation;
    const r = await this.post({ action: 'enrol' });
    if (r.status !== 200 || r.body.ok !== true) throw new Error(r.status === 429 ? 'Prøv igen om et minut.' : 'Automatisk fejlfinding er ikke tilgængelig lige nu.');
    const { token, supportCode, expiresAt } = r.body;
    const expires = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || typeof supportCode !== 'string' || !/^[A-F0-9]{12}$/.test(supportCode) || !Number.isFinite(expires) || expires <= this.now()) throw new Error('Serveren gav et ugyldigt svar.');
    const session = { token, supportCode, expiresAt: expires };
    await this.change(async () => {
      if (generation !== this.generation) return;
      await this.store.save(session);
      if (generation !== this.generation) return;
      this.session = session;
      this.lastAttempt = -Infinity;
      await this.db.execAsync('DELETE FROM diagnostic_outbox');
    });
  }
  async stop(): Promise<void> {
    const previous = this.session;
    this.generation++;
    this.session = null;
    await this.change(async () => {
      await this.store.save(null);
      await this.db.execAsync('DELETE FROM diagnostic_outbox');
    });
    if (previous !== null) await this.post({ action: 'stop' }, previous.token).catch(() => undefined);
  }
  queue(entries: LogEntry[], kind: 'heartbeat' | 'failure' = 'heartbeat'): Promise<boolean> {
    const generation = this.generation;
    return this.change(async () => {
      const s = this.session;
      if (generation !== this.generation || s === null || s.expiresAt <= this.now()) return false;
      const existing = await this.db.getFirstAsync<{ support_code: string }>('SELECT support_code FROM diagnostic_outbox WHERE id=1');
      if (existing?.support_code === s.supportCode || generation !== this.generation) return false;
      const payload = JSON.stringify(diagnosticPayload(this.version, entries, this.now(), playback, kind));
      await this.db.runAsync('INSERT OR REPLACE INTO diagnostic_outbox(id,support_code,report_id,payload) VALUES(1,?,?,?)', [s.supportCode, reportId(), payload]);
      return true;
    });
  }
  send(): Promise<void> {
    if (this.sending !== null) return this.sending;
    this.sending = this.upload().finally(() => { this.sending = null; });
    return this.sending;
  }
  private async upload(): Promise<void> {
    const s = this.session, generation = this.generation;
    if (s !== null && s.expiresAt <= this.now()) { await this.stop(); return; }
    if (s === null || s.expiresAt <= this.now() || this.now() - this.lastAttempt < 60_000) return;
    const pending = await this.db.getFirstAsync<{ support_code: string; report_id: string; payload: string }>('SELECT support_code,report_id,payload FROM diagnostic_outbox WHERE id=1');
    if (pending === null || pending.support_code !== s.supportCode || generation !== this.generation) return;
    this.lastAttempt = this.now();
    const r = await this.post({ action: 'upload', reportId: pending.report_id, report: JSON.parse(pending.payload) }, s.token);
    await this.change(async () => {
      if (generation !== this.generation) return;
      if (r.status === 200 && r.body.ok === true) {
        this.lastSent = this.now();
        await this.db.runAsync('DELETE FROM diagnostic_outbox WHERE report_id=?', [pending.report_id]);
      } else if (r.status === 410 || r.status === 403 || r.status === 401) {
        this.session = null;
        await this.store.save(null);
        await this.db.execAsync('DELETE FROM diagnostic_outbox');
      }
    });
  }
}
