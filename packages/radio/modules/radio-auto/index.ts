import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * Afspilleren bag NorRadio, med Android Auto.
 *
 * Paa Android er det et native-modul (modules/radio-auto/android): én
 * media3-session, som telefonens skaerm, notifikationen, rattet og bilen
 * alle styrer. Biblioteket bilen bladrer i, skrives som JSON til disken,
 * saa tjenesten kan svare bilen uden at appen er aaben.
 */

export type AutoState = 'idle' | 'connecting' | 'playing' | 'paused' | 'error';

export interface AutoSnapshot {
  state: AutoState;
  stationId: string | null;
  /** Stationens navn. */
  title: string | null;
  /** Det der spilles lige nu, naar streamen fortaeller det; ellers null. */
  artist: string | null;
  track: string | null;
  coverUrl: string | null;
  message: string | null;
}

/** Det tjenesten skal vide om en station: adresse, navn, logo, land. */
export interface AutoStation {
  id: string;
  name: string;
  url: string;
  logoUrl: string | null;
  /** Adresser at proeve i raekkefoelge; tjenesten tager det foerste der kan hentes. */
  logoUrls: string[];
  country: string;
}

/** En favorit slaaet til eller fra i bilen, som appen skal foere ind i databasen. */
export interface PendingFavourite {
  id: string;
  name: string;
  url: string;
  logoUrls: string[];
  country: string;
  on: boolean;
}

/** En sang gemt med bogmaerket i bilen, som appen skal foere ind i databasen. */
export interface PendingSong {
  artist: string;
  track: string;
  station: string;
  savedMs: number;
}

/** Vaekkeuret: klokkeslaet, station, og om det er slaaet til. */
export interface AlarmSetting {
  enabled: boolean;
  hour: number;
  minute: number;
  station: AutoStation | null;
  /** Naeste ringning, naar uret er sat. */
  nextMs: number | null;
}

export interface AutoLibrary {
  favourites: AutoStation[];
  countries: { code: string; name: string; flag: string; stations: AutoStation[] }[];
}

interface NativeModule {
  setLibrary(json: string): Promise<void>;
  play(json: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  current(): AutoSnapshot;
  autoLog(): string[];
  titledStations(): string[];
  pendingFavourites(): PendingFavourite[];
  clearPendingFavourites(): void;
  getAlarm(): Partial<AlarmSetting>;
  setAlarm(json: string): void;
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): void;
  pendingSongs(): PendingSong[];
  clearPendingSongs(): void;
  clearAutoLog(): void;
  nowPlayingEnabled(): boolean;
  setNowPlayingEnabled(enabled: boolean): void;
  addListener(event: 'onState', listener: (snapshot: AutoSnapshot) => void): { remove: () => void };
}

const native: NativeModule | null = Platform.OS === 'android' ? (requireNativeModule('RadioAuto') as NativeModule) : null;

export const radioAutoAvailable = native !== null;

export function setLibrary(library: AutoLibrary): Promise<void> {
  return native?.setLibrary(JSON.stringify(library)) ?? Promise.resolve();
}

export function play(station: AutoStation): Promise<void> {
  return native?.play(JSON.stringify(station)) ?? Promise.resolve();
}

export function pause(): Promise<void> {
  return native?.pause() ?? Promise.resolve();
}

export function resume(): Promise<void> {
  return native?.resume() ?? Promise.resolve();
}

export function stop(): Promise<void> {
  return native?.stop() ?? Promise.resolve();
}

const IDLE: AutoSnapshot = { state: 'idle', stationId: null, title: null, artist: null, track: null, coverUrl: null, message: null };

/** Kaldes midt i en render; kaster broen, maa det ikke vaelte skaermen. */
export function current(): AutoSnapshot {
  try {
    return native?.current() ?? IDLE;
  } catch {
    return IDLE;
  }
}

/** Tjenestens egen log, nyeste nederst. Til fejlsoegning i bilen. */
export function autoLog(): string[] {
  try {
    return native?.autoLog() ?? [];
  } catch {
    return [];
  }
}

/** Stationer der har vist sig at sende "Kunstner - Titel", laert ved afspilning. */
export function titledStations(): Set<string> {
  try {
    return new Set(native?.titledStations() ?? []);
  } catch {
    return new Set();
  }
}

export function pendingFavourites(): PendingFavourite[] {
  try {
    return native?.pendingFavourites() ?? [];
  } catch {
    return [];
  }
}

export function clearPendingFavourites(): void {
  try {
    native?.clearPendingFavourites();
  } catch {
    // Intet at rydde.
  }
}

const ALARM_OFF: AlarmSetting = { enabled: false, hour: 7, minute: 0, station: null, nextMs: null };

export function getAlarm(): AlarmSetting {
  try {
    const raw = native?.getAlarm();
    if (raw === undefined) return ALARM_OFF;
    return {
      enabled: raw.enabled ?? false,
      hour: raw.hour ?? 7,
      minute: raw.minute ?? 0,
      station: raw.station ?? null,
      nextMs: raw.nextMs ?? null,
    };
  } catch {
    return ALARM_OFF;
  }
}

export function setAlarm(setting: Omit<AlarmSetting, 'nextMs'>): void {
  try {
    native?.setAlarm(JSON.stringify(setting));
  } catch {
    // Uret findes kun paa Android.
  }
}

/** Om telefonen lader appen saette praecise alarmer (Android 12+ kan sige nej). */
export function canScheduleExactAlarms(): boolean {
  try {
    return native?.canScheduleExactAlarms() ?? true;
  } catch {
    return true;
  }
}

export function openExactAlarmSettings(): void {
  try {
    native?.openExactAlarmSettings();
  } catch {
    // Ingen indstillingsside.
  }
}

export function pendingSongs(): PendingSong[] {
  try {
    return native?.pendingSongs() ?? [];
  } catch {
    return [];
  }
}

export function clearPendingSongs(): void {
  try {
    native?.clearPendingSongs();
  } catch {
    // Intet at rydde.
  }
}

export function clearAutoLog(): void {
  try {
    native?.clearAutoLog();
  } catch {
    // Ingen log at rydde.
  }
}

export function nowPlayingEnabled(): boolean {
  try {
    return native?.nowPlayingEnabled() ?? true;
  } catch {
    return true;
  }
}

export function setNowPlayingEnabled(enabled: boolean): void {
  try {
    native?.setNowPlayingEnabled(enabled);
  } catch {
    // Kontakten findes kun paa Android.
  }
}

export function subscribe(listener: (snapshot: AutoSnapshot) => void): () => void {
  try {
    const subscription = native?.addListener('onState', listener);
    return () => subscription?.remove();
  } catch {
    return () => {};
  }
}
