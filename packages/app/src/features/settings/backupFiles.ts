import { Directory, File } from 'expo-file-system';
import { usbVolumes } from '../../../modules/usb-storage/index.js';

/**
 * Sikkerhedskopien som fil, gennem systemets egne vaelgere.
 *
 * Ingen delingsark og intet ekstra bibliotek: brugeren vaelger en mappe
 * (Downloads, Drive, hvad telefonen har), og filen laegges der. Gendannelse
 * er den samme vej den anden vej. Det virker paa Android og iPhone; Apple TV
 * har ingen filvaelger, og det maa faa sin egen vej naar den tid kommer.
 *
 * Mappevaelgeren giver en varig tilladelse til mappen, saa dens adresse kan
 * gemmes og bruges igen ved naeste start — det er den automatiske kopi.
 */
export const BACKUP_FILE_NAME = 'norstream-sikkerhedskopi.json';

/**
 * Mappevaerdien der betyder "det USB-drev der sidder i": tv'ets vej. Drevet
 * slaas op hver gang, for stien kan skifte mellem bokse og genstarter.
 */
export const USB_FOLDER = 'usb';

/** Appens mappe paa det foerste USB-drev der sidder i, eller null. */
export function usbBackupFolder(): { uri: string; name: string } | null {
  const volume = usbVolumes()[0];
  if (volume === undefined) return null;
  return { uri: `file://${volume.path}`, name: volume.name };
}

const NO_USB = 'Intet USB-drev fundet. Sæt det i en hub med strøm igennem, og prøv igen.';

/** Kopien paa USB-drevet; kaster naar der intet drev er, eller ingen fil paa det. */
export async function readBackupFromUsb(): Promise<string> {
  const folder = usbBackupFolder();
  if (folder === null) throw new Error(NO_USB);
  const file = new File(new Directory(folder.uri), BACKUP_FILE_NAME);
  if (!file.exists) throw new Error('Der ligger ingen sikkerhedskopi på USB-drevet endnu.');
  return file.text();
}

/** Mappens adresse, eller null naar brugeren fortroed i vaelgeren. */
export async function pickBackupFolder(): Promise<string | null> {
  try {
    const folder = await Directory.pickDirectoryAsync();
    return folder.uri;
  } catch {
    return null;
  }
}

/** Skriver filen i mappen; kaster naar mappen ikke laengere kan naas. */
export async function writeBackupToFolder(folderUri: string, json: string): Promise<void> {
  const target = folderUri === USB_FOLDER ? usbBackupFolder()?.uri : folderUri;
  if (target === undefined) throw new Error(NO_USB);
  const folder = new Directory(target);
  let file: File;
  try {
    file = folder.createFile(BACKUP_FILE_NAME, 'application/json');
  } catch {
    // Der laa en fra sidst. Skriv oven i den.
    file = new File(folder, BACKUP_FILE_NAME);
  }
  file.write(json);
}

/** Sandt naar filen blev gemt; falsk naar brugeren fortroed i vaelgeren. */
export async function saveBackupToChosenFolder(json: string): Promise<boolean> {
  const folderUri = await pickBackupFolder();
  if (folderUri === null) return false;
  await writeBackupToFolder(folderUri, json);
  return true;
}

/** Filens indhold, eller null naar brugeren fortroed. */
export async function readChosenBackupFile(): Promise<string | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', '*/*'] });
  if (picked.canceled) return null;
  return picked.result.text();
}
