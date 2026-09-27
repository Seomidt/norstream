import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import {
  cacheDirectory,
  createDownloadResumable,
  deleteAsync,
  getContentUriAsync,
  getInfoAsync,
  readDirectoryAsync,
} from 'expo-file-system/legacy';
import { isTV } from '../../ui/tv.js';
import { installOutcome, parseRelease, releaseTag } from './appUpdateParse.js';
import type { InstallOutcome } from './appUpdateParse.js';

/**
 * Opdater appen fra en boks i en anden by, uden Play Store.
 *
 * Byggeriet lægger den nyeste APK som en offentlig GitHub-udgivelse med et
 * fast maerkat per udgave (tv eller telefon). Appen laeser maerkatet, ser om
 * versionsnummeret er hoejere end det installerede, henter APK'en og starter
 * Androids egen installation. Boksen skal tillade "installér ukendte apps"
 * for NorStream én gang; derefter er det bare Hent og et tryk.
 *
 * v341: hentningen og installationen er skilt ad og gjort til at stole paa.
 * - Filen hentes én gang per udgave (`norstream-<nr>.apk` i cachen) og
 *   bruges igen ved naeste forsoeg; to hentninger af samme udgave paa én
 *   gang bliver til én (foer skrev to hentninger i den samme fil, og
 *   installeren kunne faa en halv).
 * - Stoerrelsen fra udgivelsen tjekkes, saa en afbrudt hentning aldrig
 *   sendes til installeren.
 * - Installeren bedes svare (`EXTRA_RETURN_RESULT`), saa appen kan sige
 *   HVORFOR Android ikke installerede, i stedet for bare at vise bjaelken igen.
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
  /** Filens stoerrelse i bytes, naar udgivelsen oplyser den. */
  size: number | null;
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

export interface DownloadProgress {
  versionCode: number;
  written: number;
  total: number | null;
}

type ProgressListener = (progress: DownloadProgress | null) => void;
const listeners = new Set<ProgressListener>();

/** Hvor langt en hentning er; null naar ingen koerer. Til bjaelken og Indstillinger. */
export function onDownloadProgress(listener: ProgressListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(progress: DownloadProgress | null): void {
  for (const listener of listeners) listener(progress);
}

let inFlight: { versionCode: number; promise: Promise<string> } | null = null;

function apkPath(versionCode: number): string {
  return `${cacheDirectory ?? ''}norstream-${versionCode}.apk`;
}

/** Filen for udgaven, naar den allerede er hentet helt. */
async function readyApk(versionCode: number, size: number | null): Promise<string | null> {
  const info = await getInfoAsync(apkPath(versionCode)).catch(() => null);
  if (info === null || !info.exists) return null;
  if (size !== null && info.size !== size) return null;
  return info.uri;
}

/** Aeldre hentede udgaver fylder 100 MB hver; kun den aktuelle beholdes. */
async function removeOtherApks(keepVersion: number): Promise<void> {
  if (cacheDirectory === null) return;
  const names = await readDirectoryAsync(cacheDirectory).catch(() => []);
  for (const name of names) {
    if (!/^norstream-\d+\.apk$/.test(name) && name !== 'norstream-opdatering.apk') continue;
    if (name === `norstream-${keepVersion}.apk`) continue;
    await deleteAsync(`${cacheDirectory}${name}`, { idempotent: true }).catch(() => undefined);
  }
}

/** Glem en hentet fil (den var beskadiget); naeste forsoeg henter forfra. */
export async function discardApk(versionCode: number): Promise<void> {
  await deleteAsync(apkPath(versionCode), { idempotent: true }).catch(() => undefined);
}

/**
 * Henter APK'en for udgaven, eller giver den der allerede ligger. Én
 * hentning ad gangen per udgave; fremdriften meldes til `onDownloadProgress`.
 * Kaster med en grund der kan vises.
 */
export function downloadApk(info: { versionCode: number; url: string; size: number | null }): Promise<string> {
  if (inFlight !== null && inFlight.versionCode === info.versionCode) return inFlight.promise;
  const promise = (async (): Promise<string> => {
    if (cacheDirectory === null) throw new Error('Der er ingen plads at hente til.');
    const ready = await readyApk(info.versionCode, info.size);
    if (ready !== null) return ready;
    await removeOtherApks(info.versionCode);
    const target = apkPath(info.versionCode);
    await deleteAsync(target, { idempotent: true }).catch(() => undefined);
    notify({ versionCode: info.versionCode, written: 0, total: info.size });
    const task = createDownloadResumable(info.url, target, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      notify({
        versionCode: info.versionCode,
        written: totalBytesWritten,
        total: info.size ?? (totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : null),
      });
    });
    let result: Awaited<ReturnType<typeof task.downloadAsync>>;
    try {
      result = await task.downloadAsync();
    } catch {
      await deleteAsync(target, { idempotent: true }).catch(() => undefined);
      throw new Error('APK’en kunne ikke hentes. Er der forbindelse? Prøv igen.');
    }
    if (result === undefined) {
      await deleteAsync(target, { idempotent: true }).catch(() => undefined);
      throw new Error('Hentningen blev afbrudt. Prøv igen.');
    }
    if (result.status !== 200) {
      await deleteAsync(target, { idempotent: true }).catch(() => undefined);
      throw new Error(`Opdateringsserveren svarede HTTP ${result.status}.`);
    }
    const check = await getInfoAsync(target).catch(() => null);
    const whole = check !== null && check.exists && (info.size === null ? check.size > 0 : check.size === info.size);
    if (!whole) {
      await deleteAsync(target, { idempotent: true }).catch(() => undefined);
      throw new Error('Hentningen blev afbrudt, før filen var hel. Prøv igen.');
    }
    return result.uri;
  })().finally(() => {
    if (inFlight !== null && inFlight.promise === promise) inFlight = null;
    notify(null);
  });
  inFlight = { versionCode: info.versionCode, promise };
  return promise;
}

/**
 * Starter Androids installation af den hentede fil og venter paa svaret.
 * Lykkes den, bliver appen lukket af Android undervejs (den bliver jo
 * skiftet ud), saa 'installed' ses sjaeldent herfra. Kaster kun naar
 * installeren slet ikke kunne startes.
 */
export async function installApk(localUri: string): Promise<InstallOutcome> {
  let contentUri: string;
  try {
    contentUri = await getContentUriAsync(localUri);
  } catch {
    throw new Error('Filen kunne ikke gøres klar til installation.');
  }
  let result: IntentLauncher.IntentLauncherResult;
  try {
    // FLAG_GRANT_READ_URI_PERMISSION = 1, saa installeren maa laese filen.
    // RETURN_RESULT: installeren svarer med om det lykkedes, og hvorfor ikke.
    result = await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
      data: contentUri,
      flags: 1,
      extra: { 'android.intent.extra.RETURN_RESULT': true },
    });
  } catch (cause) {
    const text = cause instanceof Error ? cause.message : '';
    if (/already/i.test(text)) throw new Error('En installation er allerede i gang. Følg den på skærmen.');
    throw new Error('Installationen kunne ikke startes. Tillad “installér ukendte apps” for NorStream, og prøv igen.');
  }
  const extra = (result.extra ?? {}) as Record<string, unknown>;
  return installOutcome(result.resultCode, extra['android.intent.extra.INSTALL_RESULT']);
}

/** Henter (eller genbruger) filen og starter installationen. */
export async function downloadAndInstall(info: { versionCode: number; url: string; size: number | null }): Promise<InstallOutcome> {
  return installApk(await downloadApk(info));
}

/** Filen skal hentes forfra efter disse svar: Android kunne ikke laese den. */
export function shouldDiscardAfter(outcome: InstallOutcome): boolean {
  if (outcome.kind !== 'failed') return false;
  return outcome.code === null || outcome.code === -2 || outcome.code === -3 || (outcome.code <= -100 && outcome.code >= -109);
}
