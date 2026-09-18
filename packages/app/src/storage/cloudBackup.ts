import { createBackup, serialiseBackup } from './backup.js';
import type { CredentialLoader } from './backup.js';
import { getSkyConfig, getSkyLastMs, setSkyLastMs } from './settings.js';
import { WEEKLY_BACKUP_MS } from './autoBackup.js';
import type { SqlDatabase } from './types.js';

/**
 * Den ugentlige sikkerhedskopi til skyen.
 *
 * Selve uploaden er en funktion udefra (samme greb som autoBackup.ts), saa
 * logikken kan testes uden netvaerk, og filen ikke bygger paa feature-laget
 * herinde. Uploaden faar kodeordet og kopien; krypteringen sker i skyen.
 */
export type CloudUploader = (code: string, json: string) => Promise<void>;

export type CloudBackupResult = 'off' | 'not-due' | 'written' | 'failed';

/**
 * Skriver kopien til skyen naar den er slaaet til og der er gaaet en uge —
 * eller altid med `force` ("Gem nu"). 'off' naar der ikke er valgt et
 * kodeord; 'failed' er en midlertidig fejl der proeves igen.
 */
export async function runWeeklyCloudBackup(
  db: SqlDatabase,
  upload: CloudUploader,
  now = Date.now(),
  force = false,
  loadCreds?: CredentialLoader,
): Promise<CloudBackupResult> {
  const config = await getSkyConfig(db);
  if (!config.enabled || config.code === '') return 'off';
  const lastMs = await getSkyLastMs(db);
  if (!force && lastMs !== null && now - lastMs < WEEKLY_BACKUP_MS) return 'not-due';
  try {
    const json = serialiseBackup(await createBackup(db, now, loadCreds));
    await upload(config.code, json);
  } catch {
    return 'failed';
  }
  await setSkyLastMs(db, now);
  return 'written';
}
