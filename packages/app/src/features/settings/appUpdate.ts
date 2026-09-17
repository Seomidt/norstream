import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { getContentUriAsync, downloadAsync, cacheDirectory } from 'expo-file-system/legacy';
import { isTV } from '../../ui/tv.js';
import { parseRelease, releaseTag } from './appUpdateParse.js';

/**
 * Opdater appen fra en boks i en anden by, uden Play Store.
 *
 * Byggeriet lægger den nyeste APK som en offentlig GitHub-udgivelse med et
 * fast maerkat per udgave (tv eller telefon). Appen laeser maerkatet, ser om
 * versionsnummeret er hoejere end det installerede, henter APK'en og starter
 * Androids egen installation. Boksen skal tillade "installér ukendte apps"
 * for NorStream én gang; derefter er det bare Hent og et tryk.
 */
const REPO = 'Seomidt/norstream';

/** Det installerede versionsnummer (Androids versionCode). 0 hvis ukendt. */
export function currentVersionCode(): number {
  const raw = Application.nativeBuildVersion;
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface UpdateInfo {
  /** Versionsnummeret i skyen. */
  versionCode: number;
  /** Adressen til APK'en. */
  url: string;
  /** Sandt naar skyens udgave er nyere end den installerede. */
  available: boolean;
}

/** Slaar den nyeste udgave op. Kaster med en kort grund ved fejl. */
export async function checkForUpdate(fetchImpl: typeof fetch = fetch): Promise<UpdateInfo> {
  let response: Response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/tags/${releaseTag(isTV)}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
  } catch {
    throw new Error('Kunne ikke nå opdateringsserveren. Er der forbindelse?');
  }
  if (response.status === 404) throw new Error('Der er ingen udgivelse at opdatere fra endnu.');
  if (!response.ok) throw new Error(`Opdateringsserveren svarede HTTP ${response.status}.`);
  const parsed = parseRelease(await response.json());
  return { ...parsed, available: parsed.versionCode > currentVersionCode() };
}

/** Henter APK'en og starter Androids installation. Kaster med en grund ved fejl. */
export async function downloadAndInstall(url: string): Promise<void> {
  if (cacheDirectory === null) throw new Error('Der er ingen plads at hente til.');
  const target = `${cacheDirectory}norstream-opdatering.apk`;
  let localUri: string;
  try {
    const result = await downloadAsync(url, target);
    localUri = result.uri;
  } catch {
    throw new Error('APK’en kunne ikke hentes. Prøv igen.');
  }
  let contentUri: string;
  try {
    contentUri = await getContentUriAsync(localUri);
  } catch {
    throw new Error('Filen kunne ikke gøres klar til installation.');
  }
  try {
    // FLAG_GRANT_READ_URI_PERMISSION = 1, saa installeren maa laese filen.
    await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', { data: contentUri, flags: 1 });
  } catch {
    throw new Error('Installationen kunne ikke startes. Tillad “installér ukendte apps” for NorStream.');
  }
}
