import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../storage/testDb.js';
import { migrate } from '../storage/schema.js';
const secure = vi.hoisted(() => new Map<string, string>());
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: { addEventListener: vi.fn() } }));
vi.mock('expo-application', () => ({ nativeBuildVersion: '382' }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => secure.get(k) ?? null, setItemAsync: async (k: string,v: string) => { secure.set(k,v); }, deleteItemAsync: async (k: string) => { secure.delete(k); } }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); secure.clear(); });
describe('automatisk opsamling uden koder', () => {
  it('starter automatisk og stop huskes paa tværs af genstart', async () => {
    vi.useFakeTimers(); const db = createTestDatabase(); await migrate(db);
    const fetch = vi.fn(async (_url: string, init: any) => ({ status: 200, json: async () => JSON.parse(init.body).action === 'enrol' ? { ok: true, token: 'a'.repeat(64), supportCode: 'A123456789AB', expiresAt: new Date(Date.now()+7*86400000).toISOString() } : { ok: true } }));
    vi.stubGlobal('fetch', fetch); vi.resetModules();
    const runtime = await import('./runtime.js'); runtime.startDiagnostics(db); await runtime.diagnosticState(); await runtime.sendDiagnosticReport();
    expect(fetch.mock.calls.some(c => JSON.parse(c[1].body).action === 'enrol')).toBe(true);
    expect((await runtime.diagnosticState()).phase).toBe('active');
    await runtime.stopDiagnostics(); const count = fetch.mock.calls.length; await runtime.sendDiagnosticReport(); expect(fetch).toHaveBeenCalledTimes(count);
    vi.clearAllTimers(); vi.resetModules(); const restarted = await import('./runtime.js'); restarted.startDiagnostics(db); await restarted.diagnosticState(); await restarted.sendDiagnosticReport();
    expect(fetch).toHaveBeenCalledTimes(count); expect((await restarted.diagnosticState()).phase).toBe('off'); vi.clearAllTimers();
  });
  it('udloeb forlaenges ikke ved genstart og laver ingen tilmelding', async () => {
    vi.useFakeTimers(); const db = createTestDatabase(); await migrate(db);
    await db.runAsync("INSERT INTO settings(key,value) VALUES('diagnostic_auto_until',?)", [String(Date.now()-1)]);
    const fetch = vi.fn(); vi.stubGlobal('fetch',fetch); vi.resetModules();
    const runtime = await import('./runtime.js'); runtime.startDiagnostics(db); await runtime.diagnosticState(); await runtime.sendDiagnosticReport();
    expect(fetch).not.toHaveBeenCalled(); expect((await runtime.diagnosticState()).phase).toBe('expired'); vi.clearAllTimers();
  });
});
