import { Directory, File, Paths } from 'expo-file-system';
import type { LogoFileStore } from './logoCache.js';

/**
 * Mappen logoerne ligger i. Under `document`, ikke `cache`: hele pointen er
 * at et logo hentes én gang, og styresystemet maa ikke rydde den vaek for at
 * skaffe plads til noget andet.
 */
const FOLDER = 'logoer';

/** Hvor laenge en enkelt hentning faar lov at tage. Doede vaerter er sorteret fra foer, men ikke langsomme. */
const TIMEOUT_MS = 15_000;

/** Saa meget laeses for at afgoere om filen er et billede. */
const HEAD_BYTES = 16;

function logosDirectory(): Directory {
  const directory = new Directory(Paths.document, FOLDER);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

/**
 * Den rigtige lagring, oven paa expo-file-system. Tyndt lag: reglerne for
 * hvornaar der hentes, hvad der gemmes og hvad der proeves igen, ligger i
 * `logoCache.ts` og er testet der.
 */
export function createLogoFileStore(): LogoFileStore {
  return {
    async download(url, fileName) {
      const target = new File(logosDirectory(), fileName);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let file: File;
      try {
        file = await File.downloadFileAsync(url, target, {
          idempotent: true,
          headers: { Accept: 'image/*' },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const bytes = file.size ?? 0;
      // Hele filen laeses for at faa de foerste bytes; logoer er smaa, og
      // en fil der ikke er det, afvises af kalderen paa stoerrelsen alene.
      const head =
        bytes > 0 && bytes <= 3 * 1024 * 1024
          ? new Uint8Array((await file.arrayBuffer()).slice(0, HEAD_BYTES))
          : new Uint8Array();
      return { uri: file.uri, bytes, head };
    },

    uriFor(fileName) {
      return new File(logosDirectory(), fileName).uri;
    },

    async remove(uri) {
      try {
        const file = new File(uri);
        if (file.exists) file.delete();
      } catch {
        // Filen er vaek allerede. Det var det der skulle opnaas.
      }
    },

    async removeAll() {
      try {
        const directory = new Directory(Paths.document, FOLDER);
        if (directory.exists) directory.delete();
      } catch {
        // Mappen kunne ikke slettes; de enkelte filer overskrives naar de hentes igen.
      }
    },
  };
}
