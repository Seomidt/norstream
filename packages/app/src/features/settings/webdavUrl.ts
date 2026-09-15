/** Filnavnet for sikkerhedskopien; samme som backupFiles.BACKUP_FILE_NAME. */
export const BACKUP_FILE_NAME = 'norstream-sikkerhedskopi.json';

/** Mappeadressen med præcis ét afsluttende "/". */
export function folderUrl(url: string): string {
  return url.trim().replace(/\/+$/, '') + '/';
}

/** Filens fulde adresse i mappen. */
export function fileUrl(url: string): string {
  return folderUrl(url) + BACKUP_FILE_NAME;
}
