/** Ren udgave-tolkning uden native-moduler, saa den kan testes. */

export interface ReleaseJson {
  body?: string;
  name?: string;
  assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
}

export interface ParsedRelease {
  versionCode: number;
  url: string;
  /** Filens stoerrelse i bytes, naar udgivelsen oplyser den; til at se om hentningen blev faerdig. */
  size: number | null;
}

/** Fast maerkat per udgave, som byggeriet opdaterer for hvert build. */
export function releaseTag(isTV: boolean): string {
  return isTV ? 'latest-norstream-tv' : 'latest-norstream';
}

/** Versionsnummer og APK-adresse ud af en GitHub-udgivelse; kaster ved mangler. */
export function parseRelease(release: ReleaseJson): ParsedRelease {
  const versionCode = Number.parseInt((release.body ?? release.name ?? '').trim(), 10);
  const asset = (release.assets ?? []).find((entry) => (entry.name ?? '').endsWith('.apk'));
  const url = asset?.browser_download_url;
  if (!Number.isFinite(versionCode) || url === undefined || url.length === 0) {
    throw new Error('Udgivelsen mangler et versionsnummer eller en fil.');
  }
  const size = typeof asset?.size === 'number' && asset.size > 0 ? asset.size : null;
  return { versionCode, url, size };
}

/** Hvad Androids installation svarede, naar den ikke installerede (v341). */
export type InstallOutcome =
  | { kind: 'installed' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: number | null; text: string };

/** Activity.RESULT_OK, RESULT_CANCELED og RESULT_FIRST_USER. */
const RESULT_OK = -1;
const RESULT_CANCELED = 0;

/**
 * Androids svar paa installationen, laest af det installeren sender tilbage
 * (`EXTRA_RETURN_RESULT`): resultatkoden, og ved fejl PackageManagers
 * `INSTALL_FAILED_*`-kode i `android.intent.extra.INSTALL_RESULT`. Koderne
 * er faste i Android; de vigtigste faar en forklaring man kan handle paa.
 */
export function installOutcome(resultCode: number, installResult: unknown): InstallOutcome {
  if (resultCode === RESULT_OK) return { kind: 'installed' };
  if (resultCode === RESULT_CANCELED) return { kind: 'cancelled' };
  const code = typeof installResult === 'number' && Number.isFinite(installResult) ? installResult : null;
  return { kind: 'failed', code, text: installFailureText(code) };
}

export function installFailureText(code: number | null): string {
  switch (code) {
    case -4:
      return 'Der er ikke plads nok på enheden til den nye udgave. Slet en app eller ryd plads, og prøv igen.';
    case -7:
    case -104:
      return 'Den installerede app er signeret med en anden nøgle end den nye. Afinstallér NorStream, installér den nye udgave, og hent dine favoritter fra skyen.';
    case -25:
      return 'Filen der blev hentet er ældre end den udgave der kører. Prøv igen om lidt.';
    case -2:
    case -3:
    case -100:
    case -101:
    case -102:
    case -103:
    case -105:
    case -106:
    case -107:
    case -108:
    case -109:
      return 'Filen var beskadiget, og Android kunne ikke læse den. Prøv igen — den hentes forfra.';
    case -110:
      return 'Android meldte en intern fejl under installationen. Genstart enheden, og prøv igen.';
    case -115:
      return 'Installationen blev afbrudt.';
    case null:
      return 'Android installerede ikke den nye udgave og sagde ikke hvorfor. Prøv igen, eller genstart enheden.';
    default:
      return `Android afviste installationen (kode ${code}). Prøv igen, eller genstart enheden.`;
  }
}

/** "45 %" af det der er hentet; null naar stoerrelsen er ukendt. */
export function percentText(written: number, total: number | null): string | null {
  if (total === null || total <= 0 || !Number.isFinite(written)) return null;
  return `${Math.min(100, Math.max(0, Math.floor((100 * written) / total)))} %`;
}
