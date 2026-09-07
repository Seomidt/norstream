import { Directory, File } from 'expo-file-system';

/**
 * Sikkerhedskopien som fil, gennem systemets egne vaelgere.
 *
 * Ingen delingsark og intet ekstra bibliotek: brugeren vaelger en mappe
 * (Downloads, Drive, hvad telefonen har), og filen laegges der. Gendannelse
 * er den samme vej den anden vej. Det virker paa Android og iPhone; Apple TV
 * har ingen filvaelger, og det maa faa sin egen vej naar den tid kommer.
 */
export const BACKUP_FILE_NAME = 'norstream-sikkerhedskopi.json';

/** Sandt naar filen blev gemt; falsk naar brugeren fortroed i vaelgeren. */
export async function saveBackupToChosenFolder(json: string): Promise<boolean> {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch {
    return false;
  }
  let file: File;
  try {
    file = folder.createFile(BACKUP_FILE_NAME, 'application/json');
  } catch {
    // Der laa en fra sidst. Skriv oven i den.
    file = new File(folder, BACKUP_FILE_NAME);
  }
  file.write(json);
  return true;
}

/** Filens indhold, eller null naar brugeren fortroed. */
export async function readChosenBackupFile(): Promise<string | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', '*/*'] });
  if (picked.canceled) return null;
  return picked.result.text();
}
