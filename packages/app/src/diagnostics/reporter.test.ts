import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../storage/testDb.js';
import { createBackup, serialiseBackup } from '../storage/backup.js';
import { migrate } from '../storage/schema.js';
import { DiagnosticReporter, diagnosticPayload } from './reporter.js';
import { DiagnosticJournal } from './journal.js';
import type { DiagnosticSession } from './reporter.js';
import { cleanReport } from '../../../../supabase/functions/diagnostics/validate.js';
async function fixture() {
  const db = createTestDatabase(); await migrate(db);
  let saved: DiagnosticSession | null = null, now = 1_800_000_000_000, offline = false;
  const calls: { body: any; token?: string }[] = [];
  const store = { load: async () => saved, save: async (s: DiagnosticSession | null) => { saved = s; } };
  const post = async (body: any, token?: string) => {
    calls.push({ body, token }); if (offline) throw new Error('offline');
    return { status: 200, body: body.action === 'enrol' ? { ok: true, token: 'a'.repeat(64), supportCode: 'A123456789AB', expiresAt: new Date(now + 7 * 86400000).toISOString() } : { ok: true } };
  };
  const make = () => new DiagnosticReporter(db, store, post, 382, () => now);
  return { db, calls, make, store, post, tick: (n: number) => { now += n; }, offline: (value: boolean) => { offline = value; }, now: () => now };
}
describe('privat automatisk fejlfinding', () => {
  it('sender intet uden aktivering; ingen upload-token i SQLite', async () => {
    const f = await fixture(), r = f.make(); await r.init();
    await r.queue([{ at: f.now(), line: 'test' }]); await r.send(); expect(f.calls).toHaveLength(0);
    await r.activate(); await r.queue([{ at: f.now(), line: 'password=secret https://example.test/user/pass' }]);
    const rows = await f.db.getAllAsync<{ payload: string }>('SELECT payload FROM diagnostic_outbox');
    expect(rows[0]!.payload).not.toContain('secret'); expect(rows[0]!.payload).not.toContain('https:'); expect(rows[0]!.payload).not.toContain('a'.repeat(64));
  });
  it('bevarer rapport-id ved offline, genstart og tabt kvittering', async () => {
    const f = await fixture(), r = f.make(); await r.activate();
    await Promise.all([r.queue([{ at: f.now(), line: 'fejl' }]), r.queue([{ at: f.now(), line: 'anden fejl' }])]);
    f.offline(true); await expect(r.send()).rejects.toThrow('offline'); const id = f.calls.at(-1)!.body.reportId;
    await r.send(); expect(f.calls).toHaveLength(2);
    const restarted = f.make(); await restarted.init(); f.offline(false); await restarted.send();
    expect(f.calls.at(-1)!.body.reportId).toBe(id); expect(await f.db.getFirstAsync('SELECT * FROM diagnostic_outbox')).toBeNull();
  });
  it('deaktivering vinder over et forsinket aktiveringssvar', async () => {
    const f = await fixture(); let resolve!: (r: any) => void;
    const r = new DiagnosticReporter(f.db, f.store, () => new Promise(done => { resolve = done; }), 382, f.now);
    const activation = r.activate(); while (!resolve) await Promise.resolve();
    await r.stop(); resolve({ status: 200, body: { ok: true, token: 'a'.repeat(64), supportCode: 'A123456789AB', expiresAt: new Date(f.now() + 86400000).toISOString() } }); await activation;
    expect(r.session).toBeNull(); expect(await f.store.load()).toBeNull();
  });
  it('stop under koedannelse efterlader ingen outbox eller adgang', async () => {
    const f = await fixture(), r = f.make(); await r.activate();
    await Promise.all([r.queue([{ at: f.now(), line: 'fejl' }]), r.stop()]); await r.send();
    expect(await f.db.getFirstAsync('SELECT * FROM diagnostic_outbox')).toBeNull(); expect(await f.store.load()).toBeNull(); expect(f.calls.filter(c => c.body.action === 'upload')).toHaveLength(0);
  });
  it('udloeb standser uploads', async () => {
    const f = await fixture(), r = f.make(); await r.activate(); await r.queue([]); f.tick(8 * 86400000); await r.send();
    expect(r.session).toBeNull(); expect(f.calls.filter(c => c.body.action === 'upload')).toHaveLength(0);
  });
  it('UTF-8 overholder HTTP-graensen; serveren ignorerer fremmede felter', () => {
    const payload = diagnosticPayload(382, Array.from({ length: 80 }, () => ({ at: Date.now(), line: '雪'.repeat(300) })), Date.now());
    expect(Buffer.byteLength(JSON.stringify({ action: 'upload', reportId: 'a'.repeat(36), report: payload }))).toBeLessThan(32768);
    const cleaned = cleanReport({ ...payload, password: 'secret', playback: { position: 100, token: 'secret', dropped: NaN } });
    expect(JSON.stringify(cleaned)).not.toContain('secret'); expect(cleaned!.playback).toEqual({ position: 100 });
    expect(cleanReport({ ...payload, entries: [{ at: 1, line: 'x'.repeat(301) }] })).toBeNull();
  });
  it('log overlever en ny journal med et doegns TTL og 2000-linjers loft', async () => {
    const f = await fixture(), journal = new DiagnosticJournal(f.db);
    journal.append({ at: f.now() - 25 * 3600000, line: 'gammel' });
    for (let i = 0; i < 2100; i++) journal.append({ at: f.now(), line: `${i} token=secret HTTPS://example.test/secret` });
    await journal.flush(f.now()); const resumed = new DiagnosticJournal(f.db);
    const entries = await resumed.recent(2000, f.now()); expect(entries).toHaveLength(2000); expect(entries[0]!.line).toMatch(/^100 /);
    expect(JSON.stringify(entries)).not.toContain('secret'); expect(await resumed.recent(2000, f.now() + 25 * 3600000)).toEqual([]);
  });
  it('backup udelader installations-id, outbox og log', async () => {
    const f = await fixture(), r = f.make(); await r.activate(); await r.queue([{ at: f.now(), line: 'kun lokal log' }]);
    const backup = serialiseBackup(await createBackup(f.db, f.now(), async () => null));
    expect(backup).not.toContain('diagnostic_claim_id'); expect(backup).not.toContain('kun lokal log'); expect(backup).not.toContain('a'.repeat(64));
  });
  it('opgraderer v28 uden datatab og skriver ikke ved naeste start', async () => {
    const f = await fixture(); await f.db.execAsync("DROP TABLE diagnostic_log; DROP TABLE diagnostic_outbox; PRAGMA user_version=28; INSERT INTO settings(key,value) VALUES('keep','yes');");
    await migrate(f.db); expect(await f.db.getFirstAsync('SELECT value FROM settings WHERE key=\'keep\'')).toEqual({ value: 'yes' });
    const writes: string[] = [];
    await migrate({ ...f.db, execAsync: async s => { writes.push(s); await f.db.execAsync(s); }, runAsync: async (s, p) => { writes.push(s); return f.db.runAsync(s,p); } });
    expect(writes).toEqual([]);
  });
});
