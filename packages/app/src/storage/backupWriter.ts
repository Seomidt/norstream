import { USB_FOLDER, writeBackupToFolder } from '../features/settings/backupFiles.js';
import { getWebdavConfig, putBackup } from '../features/settings/webdav.js';

/** Vaerdien i backup_folder_uri der betyder "skriv til WebDAV-skyen". */
export const CLOUD_FOLDER = 'cloud';

/**
 * Den ugentlige kopi kan gaa til en mappe, et USB-drev eller en WebDAV-sky.
 * `runWeeklyBackup` kalder denne med den gemte maal-vaerdi; her sendes den
 * videre til den rigtige vej. Skyen laeser sin adresse fra Keychain.
 */
export async function writeWeeklyBackup(folderUri: string, json: string): Promise<void> {
  if (folderUri === CLOUD_FOLDER) {
    const config = await getWebdavConfig();
    if (config === null) throw new Error('Skyen er ikke sat op.');
    await putBackup(config, json);
    return;
  }
  await writeBackupToFolder(folderUri, json);
}
