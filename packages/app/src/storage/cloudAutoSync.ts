import { backupHasUserData, createBackup, parseBackup, serialiseBackup } from './backup.js';
import type { Backup, CredentialLoader, RestoreResult } from './backup.js';
import { getSkyConfig, getSkySync, getSkyStorageCode, getSkyStorageState, setSkyLastMs, setSkyStorageState } from './settings.js';
import type { SqlDatabase } from './types.js';

/**
 * v401: hver installation gemmer i sit eget namespace. Baggrundskoersler
 * henter aldrig andre bokses data ind; gendannelse er altid et manuelt valg.
 */

export interface CloudIo {
  upload(code: string, json: string): Promise<void>;
  /** Kopien under kodeordet, eller null naar der ingen ligger. Kaster ved netfejl. */
  download(code: string): Promise<string | null>;
}

export type CloudSyncOutcome = 'off' | 'unchanged' | 'uploaded' | 'applied' | 'empty' | 'failed';

export interface CloudSyncResult {
  outcome: CloudSyncOutcome;
  /** Naar skyen blev lagt ind: hvad der kom med (til logoer og genindlaesning). */
  restore?: RestoreResult;
}

/** FNV-1a, 32 bit, som hex. Kun til at se om noget er aendret. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Fingeraftrykket af det brugeren selv har lavet: uden tidspunkt og uden kodeord. */
export function fingerprint(backup: Backup): string {
  const bare = {
    ...backup,
    exportedMs: 0,
    synced: false,
    sources: backup.sources.map(({ password: _password, ...rest }) => rest),
  };
  return hashText(JSON.stringify(bare));
}

const running = new WeakMap<SqlDatabase, Promise<CloudSyncResult>>();

/** Automatisk backup for denne boks; aldrig automatisk gendannelse. */
export function runCloudSync(
  db: SqlDatabase,
  io: CloudIo,
  now = Date.now(),
  loadCreds?: CredentialLoader,
): Promise<CloudSyncResult> {
  const pending = running.get(db);
  if (pending) return pending;
  const task = syncOnce(db, io, now, loadCreds).finally(() => running.delete(db));
  running.set(db, task);
  return task;
}

async function syncOnce(db: SqlDatabase, io: CloudIo, now: number, loadCreds?: CredentialLoader): Promise<CloudSyncResult> {
  const config = await getSkyConfig(db);
  if (config.code === '' || !(await getSkySync(db))) return { outcome: 'off' };
  try {
    const storageCode = await getSkyStorageCode(db);
    const state = await getSkyStorageState(db, storageCode);
    const local = await createBackup(db, now, loadCreds);
    const localFp = fingerprint(local);
    if (state.fingerprint === localFp) return { outcome: 'unchanged' };
    if (!backupHasUserData(local)) return { outcome: 'empty' };
    await io.upload(storageCode, serialiseBackup(local));
    // Kodeordet kan vaere skiftet mens netvaerkskaldet koerte.
    if ((await getSkyStorageCode(db)) === storageCode) {
      await setSkyStorageState(db, storageCode, { fingerprint: localFp, seenMs: local.exportedMs, dirtySinceMs: 0 });
      await setSkyLastMs(db, now);
    }
    return { outcome: 'uploaded' };
  } catch {
    return { outcome: 'failed' };
  }
}

/**
 * Efter en manuel "Hent fra skyen" (eller gendannelse ved opsaetning): det
 * der ligger her, ER skyens kopi nu. Uden dette ville naeste synkronisering
 * enten hente den igen eller laegge den op igen.
 */
export async function markCloudApplied(db: SqlDatabase, cloudJson: string, now = Date.now()): Promise<void> {
  let seenMs = now;
  try {
    seenMs = parseBackup(cloudJson).exportedMs;
  } catch {
    // Uparselig: saa taeller "nu".
  }
  const after = await createBackup(db, now);
  // Den manuelt hentede kopi skal ogsaa gemmes i denne boks' egen sky.
  // Naeste baggrundskoersel uploader derfor den lokale tilstand.
  await setSkyStorageState(db, '', { fingerprint: fingerprint(after), seenMs, dirtySinceMs: 0 });
}
