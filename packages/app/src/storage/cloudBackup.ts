import { backupHasUserData, createBackup, serialiseBackup } from './backup.js';
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

export type CloudBackupResult = 'off' | 'not-due' | 'empty' | 'written' | 'failed';

/**
 * Skriver kopien til skyen naar den er slaaet til og der er gaaet en uge —
 * eller altid med `force` ("Gem nu"). 'off' naar der ikke er valgt et
 * kodeord; 'failed' er en midlertidig fejl der proeves igen.
 *
 * 'empty': der er intet at gemme endnu (ingen favoritter, grupper osv.). Saa
 * uploades der IKKE — ellers ville en ny boks, hvor man netop har skrevet
 * kodeordet for at HENTE, overskrive den gode kopi i skyen med en tom, og
 * favoritterne var vaek for altid. Kodeordet gemmes stadig (af kalderen), saa
 * man kan trykke Hent.
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
    const backup = await createBackup(db, now, loadCreds);
    // Aldrig laegge en tom kopi op oven paa en der har noget i sig.
    if (!backupHasUserData(backup)) return 'empty';
    await upload(config.code, serialiseBackup(backup));
  } catch {
    return 'failed';
  }
  await setSkyLastMs(db, now);
  return 'written';
}
