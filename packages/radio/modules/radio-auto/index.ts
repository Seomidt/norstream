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
  title: string | null;
  message: string | null;
}

/** Det tjenesten skal vide om en station: adresse, navn, logo, land. */
export interface AutoStation {
  id: string;
  name: string;
  url: string;
  logoUrl: string | null;
  country: string;
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

const IDLE: AutoSnapshot = { state: 'idle', stationId: null, title: null, message: null };

/** Kaldes midt i en render; kaster broen, maa det ikke vaelte skaermen. */
export function current(): AutoSnapshot {
  try {
    return native?.current() ?? IDLE;
  } catch {
    return IDLE;
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
