import { createBackup, serialiseBackup } from './backup.js';
import {
  getGoogleDriveConfig,
  getGoogleDriveLastMs,
  setGoogleDriveFileId,
  setGoogleDriveLastMs,
} from './settings.js';
import type { GoogleDriveConfig } from './settings.js';
import { WEEKLY_BACKUP_MS } from './autoBackup.js';
import type { SqlDatabase } from './types.js';

/**
 * Den ugentlige sikkerhedskopi til Google Drev.
 *
 * Selve uploaden er en funktion udefra (samme greb som autoBackup.ts), saa
 * logikken kan testes uden netvaerk, og saa filen ikke bygger paa
 * feature-laget herinde. Den samme fil opdateres hver gang; fil-id’et
 * huskes.
 */
export type CloudUploader = (config: GoogleDriveConfig, json: string) => Promise<{ fileId: string }>;

export type CloudBackupResult = 'off' | 'not-due' | 'written' | 'reauth' | 'failed';

/**
 * Skriver kopien til Drev naar den er slaaet til og der er gaaet en uge —
 * eller altid med `force` ("Gem nu"). 'reauth' betyder at loginet er udloebet
 * og skal fornyes; 'failed' er en midlertidig fejl der proeves igen.
 */
export async function runWeeklyCloudBackup(
  db: SqlDatabase,
  upload: CloudUploader,
  now = Date.now(),
  force = false,
): Promise<CloudBackupResult> {
  const config = await getGoogleDriveConfig(db);
  if (!config.enabled || config.refreshToken === null || config.clientId === '' || config.clientSecret === '') {
    return 'off';
  }
  const lastMs = await getGoogleDriveLastMs(db);
  if (!force && lastMs !== null && now - lastMs < WEEKLY_BACKUP_MS) return 'not-due';
  let fileId: string;
  try {
    const json = serialiseBackup(await createBackup(db, now));
    ({ fileId } = await upload(config, json));
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'reauth') return 'reauth';
    return 'failed';
  }
  await setGoogleDriveFileId(db, fileId);
  await setGoogleDriveLastMs(db, now);
  return 'written';
}
