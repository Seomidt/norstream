import { Directory, File, Paths } from 'expo-file-system';
import type { RecordingStore } from '../../sync/recorder.js';

/**
 * Mappen optagelserne ligger i. Under `document` og ikke `cache`: styresystemet
 * maa ikke rydde en optagelse vaek for at skaffe plads. Brugeren har bedt om
 * den, og det er brugeren der sletter den igen.
 */
const FOLDER = 'optagelser';

/** Filnavnet maa ikke rumme kolon; optagelsens id gør. */
function fileNameFor(id: string): string {
  return `${id.replace(/[^A-Za-z0-9._-]+/g, '_')}.ts`;
}

function recordingsDirectory(): Directory {
  const directory = new Directory(Paths.document, FOLDER);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

/**
 * Den rigtige hentning, oven paa expo-file-system.
 *
 * Laget er med vilje tyndt: alt hvad der kan gaa galt paa en maade der betyder
 * noget — hvornaar der hentes, hvad der sker ved fejl, hvad brugeren faar at
 * vide — ligger i `recorder.ts` og er testet der. Her er kun stier og kald.
 */
export function createRecordingStore(): RecordingStore {
  return {
    async download(url, id, onProgress) {
      const target = new File(recordingsDirectory(), fileNameFor(id));
      const file = await File.downloadFileAsync(url, target, {
        // Et nyt forsoeg efter en afbrudt hentning skal overskrive resten af
        // den halve fil, ikke fejle paa at den ligger der.
        idempotent: true,
        onProgress: onProgress
          ? ({ bytesWritten }) => {
              onProgress(bytesWritten);
            }
          : undefined,
      });
      return { uri: file.uri, bytes: file.size };
    },

    async remove(uri) {
      // Maa ikke kaste naar filen ikke findes: kalderen rydder op efter en
      // hentning der kan vaere gaaet galt hvor som helst undervejs.
      try {
        const file = new File(uri);
        if (file.exists) file.delete();
      } catch {
        // Filen er vaek, eller stien kan ikke laeses. Begge dele er i orden her.
      }
    },
  };
}

/** Hvor meget plads der er tilbage paa enheden, i bytes. */
export function availableBytes(): number {
  return Paths.availableDiskSpace;
}
