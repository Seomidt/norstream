import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import type { SqlDatabase } from '../storage/types.js';
import { DiagnosticJournal } from './journal.js';
import { DiagnosticReporter } from './reporter.js';
import type { DiagnosticSession } from './reporter.js';
import { logEvent, onLogEntry, recentEntries, restoreLog } from './log.js';

const ENDPOINT = 'https://usewnyvdxxfgvwaefvmq.supabase.co/functions/v1/diagnostics';
const KEY = 'norstream_diagnostic_session';
let ready: Promise<void> | null = null;
let reporter: DiagnosticReporter | null = null;
let journal: DiagnosticJournal | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let reportTimer: ReturnType<typeof setTimeout> | null = null;
let webSession: DiagnosticSession | null = null;
let lastError = false;
let failureRevision = 0;
let failureQueued = 0;
let database: SqlDatabase | null = null;
let enrolling: Promise<void> | null = null;
let automaticUntil = 0;
let disabled = false;
let lastEnrolmentAttempt = -Infinity;

async function post(body: object, token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-diagnostic-token': token } : {}) },
      body: JSON.stringify(body), signal: controller.signal,
    });
    const value: unknown = await response.json();
    return { status: response.status, body: value && typeof value === 'object' ? value as Record<string, unknown> : {} };
  } finally { clearTimeout(timer); }
}

/** Opstart venter ikke paa cloud. Automatisk, tidsbegraenset upload efter opdateringen. */
export function startDiagnostics(db: SqlDatabase): void {
  if (ready !== null) return;
  database = db;
  journal = new DiagnosticJournal(db);
  for (const entry of recentEntries()) journal.append(entry);
  onLogEntry(entry => {
    journal!.append(entry);
    if (flushTimer === null) flushTimer = setTimeout(() => {
      flushTimer = null;
      void journal!.flush().catch(() => undefined);
    }, 500);
    // Fejl/EOF fastholdes hurtigt i outbox; kvoten gaelder stadig ved upload.
    if (/sluttede|fejl\/haengt|opgiver|native fej|status: error/i.test(entry.line)) {
      failureRevision++;
      if (reportTimer !== null) return;
      reportTimer = setTimeout(() => { reportTimer = null; void sendDiagnosticReport(); }, 500);
    }
  });
  ready = (async () => {
    restoreLog(await journal!.recent().catch(() => []));
    reporter = new DiagnosticReporter(db, {
      async load() {
        if (Platform.OS === 'web') return webSession;
        try {
          const raw = await SecureStore.getItemAsync(KEY);
          if (raw === null) return null;
          const value = JSON.parse(raw);
          return value && typeof value.token === 'string' && typeof value.supportCode === 'string' && typeof value.expiresAt === 'number' ? value as DiagnosticSession : null;
        } catch { return null; }
      },
      async save(value) {
        if (Platform.OS === 'web') { webSession = value; return; }
        if (value === null) await SecureStore.deleteItemAsync(KEY);
        else await SecureStore.setItemAsync(KEY, JSON.stringify(value));
      },
    }, post, Number(Application.nativeBuildVersion) || 382);
    await reporter.init();
    const deadline = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key='diagnostic_auto_until'");
    automaticUntil = deadline === null ? Date.now() + 7 * 86400000 : Number(deadline.value);
    if (deadline === null) await db.runAsync("INSERT INTO settings(key,value) VALUES('diagnostic_auto_until',?)", [String(automaticUntil)]);
    disabled = (await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key='diagnostic_disabled'"))?.value === '1';
    await journal!.flush().catch(() => undefined);
    // Aflever foerst en eventuel rapport, som ikke naaede frem foer genstart.
    void sendDiagnosticReport();
    setInterval(() => { void sendDiagnosticReport(); }, 60_000);
    AppState.addEventListener('change', state => {
      void journal!.flush().catch(() => undefined);
      if (state === 'active' || state === 'background') void sendDiagnosticReport();
    });
  })();
  // Intet uhaandteret promise og ingen fejlfinding, der blokerer forsiden.
  void ready.catch(() => undefined);
}
export async function diagnosticState(): Promise<{ supportCode: string | null; expiresAt: number | null; lastSent: number | null; failed: boolean; phase: 'starting' | 'active' | 'off' | 'expired' }> {
  await ready;
  const s = reporter?.session;
  const phase = disabled ? 'off' : automaticUntil > 0 && Date.now() >= automaticUntil ? 'expired' : s && s.expiresAt > Date.now() ? 'active' : 'starting';
  return { supportCode: phase === 'active' ? s!.supportCode : null, expiresAt: s ? Math.min(s.expiresAt, automaticUntil) : null, lastSent: reporter?.lastSent ?? null, failed: lastError, phase };
}
export async function activateDiagnostics(): Promise<void> {
  await ready;
  if (reporter === null) throw new Error('Fejlfinding er ikke klar. Prøv igen.');
  if (Date.now() >= automaticUntil) throw new Error('Fejlfindingperioden er udløbet.');
  disabled = false;
  await database?.runAsync("INSERT OR REPLACE INTO settings(key,value) VALUES('diagnostic_disabled','0')");
  try { await ensureAutomaticSession(); } catch (e) {
    if (e instanceof Error && /minut|ugyldigt svar|ikke tilgængelig/i.test(e.message)) throw e;
    throw new Error('Kunne ikke aktivere. Kontrollér internet og prøv igen.');
  }
  logEvent('fejlfinding', 'automatisk fejlrapport aktiveret i syv dage');
  void sendDiagnosticReport();
}
export async function stopDiagnostics(): Promise<void> {
  await ready;
  disabled = true;
  await database?.runAsync("INSERT OR REPLACE INTO settings(key,value) VALUES('diagnostic_disabled','1')");
  await reporter?.stop();
  logEvent('fejlfinding', 'automatisk fejlrapport slået fra');
}
async function ensureAutomaticSession(): Promise<void> {
  if (reporter === null || disabled || Date.now() >= automaticUntil || reporter.session !== null) return;
  if (enrolling !== null) return enrolling;
  if (Date.now() - lastEnrolmentAttempt < 60_000) return;
  lastEnrolmentAttempt = Date.now();
  enrolling = (async () => {
    await reporter!.activate();
    // Sluk/udloeb skal vinde over et forsinket netvaerkssvar.
    if (disabled || Date.now() >= automaticUntil) { await reporter!.stop(); return; }
    logEvent('fejlfinding', 'automatisk fejlrapport startet; stopper efter syv dage');
  })().finally(() => { enrolling = null; });
  return enrolling;
}
export async function sendDiagnosticReport(): Promise<void> {
  try {
    if (reporter === null || automaticUntil === 0) return;
    if (disabled || Date.now() >= automaticUntil) { if (reporter.session !== null) await reporter.stop(); return; }
    await ensureAutomaticSession();
    if (reporter.session === null || disabled) return;
    await journal?.flush();
    const revision = failureRevision;
    const queued = await reporter.queue(await journal!.recent(80), revision > failureQueued ? 'failure' : 'heartbeat');
    if (queued) failureQueued = revision;
    await reporter.send();
    lastError = false;
  } catch { lastError = true; /* Ingen adresser eller raafejl i loggen. Outbox beholdes. */ }
}
