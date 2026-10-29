import { createBackup, serialiseBackup } from './backup.js';
import { getBackupFailed, getBackupFolderUri, getBackupLastMs, setBackupFailed, setBackupLastMs } from './settings.js';
import type { SqlDatabase } from './types.js';

/**
 * Den automatiske sikkerhedskopi: én gang om ugen, i den mappe brugeren
 * valgte én gang, uden at spoerge igen.
 *
 * Selve skrivningen er en funktion udefra, saa logikken kan testes uden
 * expo-file-system, og saa tv (uden mappevaelger) bare lader vaere at kalde.
 */
export const WEEKLY_BACKUP_MS = 7 * 24 * 60 * 60 * 1000;

export type BackupWriter = (folderUri: string, json: string) => Promise<void>;

export type AutoBackupResult = 'off' | 'not-due' | 'written' | 'failed';

export interface AutoBackupState {
  folderUri: string | null;
  lastMs: number | null;
  failed: boolean;
}

export async function getAutoBackupState(db: SqlDatabase): Promise<AutoBackupState> {
  const [folderUri, lastMs, failed] = await Promise.all([getBackupFolderUri(db), getBackupLastMs(db), getBackupFailed(db)]);
  return { folderUri, lastMs, failed };
}

/**
 * Skriver kopien naar den er slaaet til og der er gaaet en uge — eller altid
 * med `force`, som bruges lige naar mappen er valgt. Fejler skrivningen
 * (mappen er slettet, kortet taget ud), huskes det, saa Indstillinger kan
 * bede om en ny mappe; naeste start proever igen.
 */
export async function runWeeklyBackup(
  db: SqlDatabase,
  write: BackupWriter,
  now = Date.now(),
  force = false,
): Promise<AutoBackupResult> {
  const folderUri = await getBackupFolderUri(db);
  if (folderUri === null) return 'off';
  const lastMs = await getBackupLastMs(db);
  if (!force && lastMs !== null && now - lastMs < WEEKLY_BACKUP_MS) return 'not-due';
  try {
    const json = serialiseBackup(await createBackup(db, now));
    await write(folderUri, json);
  } catch {
    await setBackupFailed(db, true);
    return 'failed';
  }
  await setBackupLastMs(db, now);
  await setBackupFailed(db, false);
  return 'written';
}
