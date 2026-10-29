import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import {
  cacheDirectory,
  createDownloadResumable,
  deleteAsync,
  getContentUriAsync,
  getInfoAsync,
  readDirectoryAsync,
} from 'expo-file-system/legacy';
import { isTV } from '../../ui/tv.js';
import { logEvent } from '../../diagnostics/log.js';
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

const inFlight = new Map<number, Promise<string>>();
let downloadQueue: Promise<unknown> = Promise.resolve();
const playbackPauses = new Set<symbol>();
const resumeWaiters = new Set<() => void>();
let activeDownload: { pause: () => void } | null = null;

/** Video har foersteret til nettet. Flere ejere kan holde samme pause. */
export function pauseApkDownloads(): () => void {
  const token = Symbol('apk-playback-pause');
  playbackPauses.add(token);
  activeDownload?.pause();
  return () => {
    if (!playbackPauses.delete(token) || playbackPauses.size !== 0) return;
    for (const resume of [...resumeWaiters]) resume();
  };
}

async function waitForDownloadSlot(): Promise<void> {
  while (playbackPauses.size !== 0) {
    await new Promise<void>((resolve) => {
      const resume = (): void => { resumeWaiters.delete(resume); resolve(); };
      resumeWaiters.add(resume);
    });
  }
}

/** Saa laenge en hentning maa staa uden nye bytes, foer den regnes for gaaet i staa. */
const DOWNLOAD_STALL_MS = 45_000;

function stallError(written: number, size: number | null): Error {
  const percent = size === null || size <= 0 ? null : Math.floor((100 * written) / size);
  logEvent('opdatering', `hentningen gik i staa ved ${percent === null ? `${Math.round(written / 1048576)} MB` : `${percent} %`}`);
  return new Error(
    `Hentningen gik i stå${percent === null ? '' : ` ved ${percent} %`} — der kom ingenting i ${Math.round(DOWNLOAD_STALL_MS / 1000)} s. Tjek nettet på boksen, og tryk Opdater igen.`,
  );
}

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
  const existing = inFlight.get(info.versionCode);
  if (existing !== undefined) return existing;
  // Ogsaa forskellige udgaver serialiseres, saa de ikke downloader samtidig
  // eller sletter hinandens filer gennem removeOtherApks.
  const promise = downloadQueue.then(async (): Promise<string> => {
    if (cacheDirectory === null) throw new Error('Der er ingen plads at hente til.');
    const ready = await readyApk(info.versionCode, info.size);
    if (ready !== null) return ready;
    await waitForDownloadSlot();
    await removeOtherApks(info.versionCode);
    const target = apkPath(info.versionCode);
    await deleteAsync(target, { idempotent: true }).catch(() => undefined);
    // Afspilning kan vaere begyndt under et af filsystemets async-kald.
    await waitForDownloadSlot();
    notify({ versionCode: info.versionCode, written: 0, total: info.size });
    logEvent('opdatering', `henter udgave ${info.versionCode}${info.size === null ? '' : ` (${Math.round(info.size / 1048576)} MB)`}`);
    // Vagt mod en hentning der staar stille (v361): paa tv stod bjaelken paa
    // "Henter 0 %" uden at komme videre og uden at give op — hentningen har
    // ingen tidsgraense, og saa kunne man heller ikke proeve igen (den
    // igangvaerende blev genbrugt). Kommer der ingen bytes i STALL_MS,
    // afbrydes den og siger det; naeste tryk henter forfra.
    let lastWritten = 0;
    let idleMs = 0;
    let runningSince: number | null = null;
    let stalled = false;
    const stopClock = (): void => {
      if (runningSince !== null) idleMs += Date.now() - runningSince;
      runningSince = null;
    };
    const makeTask = (resumeData?: string) => createDownloadResumable(info.url, target, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (totalBytesWritten !== lastWritten) {
        lastWritten = totalBytesWritten;
        idleMs = 0;
        if (runningSince !== null) runningSince = Date.now();
      }
      notify({
        versionCode: info.versionCode,
        written: totalBytesWritten,
        total: info.size ?? (totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : null),
      });
    }, resumeData);
    let task = makeTask();
    let resume = false;
    let resumed = false;
    let resumedFromBytes = 0;
    let restartedRange = false;
    let control: { pause: () => void } | null = null;
    const watchdog = setInterval(() => {
      if (runningSince === null || stalled || idleMs + Date.now() - runningSince < DOWNLOAD_STALL_MS) return;
      stalled = true;
      stopClock();
      clearInterval(watchdog);
      void task.cancelAsync().catch(() => undefined);
    }, 5_000);
    let result: Awaited<ReturnType<typeof task.downloadAsync>>;
    try {
      while (true) {
        await waitForDownloadSlot();
        // En anden microtask kan tage en pause efter waiterens resolve.
        // Fra denne kontrol til native-start er der derfor ingen await.
        if (playbackPauses.size !== 0) continue;
        let finished = false;
        let pauseResult: Promise<boolean> | null = null;
        const cycle = {
          pause: (): void => {
            if (finished || pauseResult !== null || stalled) return;
            stopClock();
            pauseResult = task.pauseAsync().then(() => true).catch(async () => {
              // En afsluttet eller endnu ikke registreret native opgave kan
              // ikke pauses. Stop den, og hent forfra efter afspilningen.
              await task.cancelAsync().catch(() => undefined);
              return false;
            });
          },
        };
        control = cycle;
        activeDownload = cycle;
        runningSince = Date.now();
        let failure: unknown;
        try {
          result = await (resume ? task.resumeAsync() : task.downloadAsync());
        } catch (cause: unknown) {
          failure = cause;
          result = undefined;
        }
        finished = true;
        stopClock();
        if (activeDownload === cycle) activeDownload = null;
        const paused: boolean | null = pauseResult === null ? null : await pauseResult;
        // Native kan naa at afslutte filen samtidig med pause-anmodningen.
        // En hel fil har forrang; der maa ikke startes endnu en hentning.
        if (result != null) {
          // Android appender ved resume, selv naar serveren ignorerer Range.
          // En hel HTTP 200-fil oven paa del-filen maa aldrig installeres.
          if (Platform.OS === 'android' && resume && resumedFromBytes > 0 && result.status === 200) {
            if (restartedRange) throw new Error('Opdateringsserveren kunne ikke genoptage hentningen. Prøv igen.');
            restartedRange = true;
            await deleteAsync(target, { idempotent: true }).catch(() => undefined);
            task = makeTask();
            lastWritten = 0;
            idleMs = 0;
            resume = false;
            resumedFromBytes = 0;
            continue;
          }
          resumed = resume;
          break;
        }
        if (stalled) throw stallError(lastWritten, info.size);
        if (paused !== null) {
          resume = paused;
          if (paused && Platform.OS === 'android') {
            // Android tager sit pause-snapshot foer det sidste write er
            // draenet. Brug filens faktiske stoerrelse EFTER begge native
            // promises er afsluttet, ellers kan sidste stykke dubleres.
            const partial = await getInfoAsync(target).catch(() => null);
            if (partial?.exists && Number.isSafeInteger(partial.size) && partial.size >= 0) {
              task = makeTask(String(partial.size));
              lastWritten = partial.size;
              resumedFromBytes = partial.size;
            } else resume = false;
          }
          if (!resume) {
            await waitForDownloadSlot();
            await deleteAsync(target, { idempotent: true }).catch(() => undefined);
            lastWritten = 0;
            idleMs = 0;
            resumedFromBytes = 0;
            task = makeTask();
          }
          continue;
        }
        if (failure !== undefined) throw failure;
        throw new Error('Hentningen blev afbrudt. Prøv igen.');
      }
    } catch (cause) {
      await deleteAsync(target, { idempotent: true }).catch(() => undefined);
      if (stalled) throw stallError(lastWritten, info.size);
      logEvent('opdatering', `hentningen fejlede: ${cause instanceof Error ? cause.message.replace(/https?:\/\/\S+/g, '[adresse]') : 'ukendt fejl'}`);
      throw new Error('APK’en kunne ikke hentes. Er der forbindelse? Prøv igen.');
    } finally {
      clearInterval(watchdog);
      if (activeDownload === control) activeDownload = null;
    }
    if (result == null) {
      await deleteAsync(target, { idempotent: true }).catch(() => undefined);
      if (stalled) throw stallError(lastWritten, info.size);
      throw new Error('Hentningen blev afbrudt. Prøv igen.');
    }
    logEvent('opdatering', `hentet: ${Math.round(lastWritten / 1048576)} MB, svar ${result.status}`);
    if (result.status !== 200 && !(resumed && result.status === 206)) {
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
  }).finally(() => {
    if (inFlight.get(info.versionCode) === promise) inFlight.delete(info.versionCode);
    notify(null);
  });
  inFlight.set(info.versionCode, promise);
  downloadQueue = promise.catch(() => undefined);
  return promise;
}

/**
 * Starter Androids installation af den hentede fil og venter paa svaret.
 * Lykkes den, bliver appen lukket af Android undervejs (den bliver jo
 * skiftet ud), saa 'installed' ses sjaeldent herfra. Kaster kun naar
 * installeren slet ikke kunne startes.
 */
export async function installApk(localUri: string): Promise<InstallOutcome> {
  if (playbackPauses.size !== 0) throw new Error('Afslut afspilningen, og prøv installationen igen.');
  let contentUri: string;
  try {
    contentUri = await getContentUriAsync(localUri);
  } catch {
    throw new Error('Filen kunne ikke gøres klar til installation.');
  }
  // Afspilning kan vaere startet mens content-URI'en blev gjort klar.
  if (playbackPauses.size !== 0) throw new Error('Afslut afspilningen, og prøv installationen igen.');
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
