import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { XtreamCredentials } from '@norstream/core';

const KEY = 'uhf_play_xtream_credentials';

/**
 * expo-secure-store har ingen web-implementering (den er en tom stub der
 * kaster ved kald). Paa web holder vi derfor credentials i en modul-variabel
 * i stedet: de overlever kun den nuvaerende side-session og forsvinder ved et
 * genindlaes. Det er bevidst — vi vil ikke gemme et panel-kodeord i
 * localStorage, hvor det ligger i klartekst og kan laeses af ethvert script
 * paa origin'et. Web er en udviklings-flade her, ikke en distributions-
 * platform (spec'en shipper til iOS, Android, Apple TV og Android TV), saa
 * "log ind igen efter genindlaes" er en accepteret konsekvens, ikke en fejl.
 * Native platforme bruger stadig expo-secure-store (Keychain/Keystore)
 * uaendret.
 */
let webCredentials: XtreamCredentials | null = null;

function isValidCredentials(value: unknown): value is XtreamCredentials {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as XtreamCredentials).baseUrl === 'string' &&
    typeof (value as XtreamCredentials).username === 'string' &&
    typeof (value as XtreamCredentials).password === 'string'
  );
}

/**
 * Credentials ligger i iOS Keychain og Android Keystore via expo-secure-store,
 * aldrig i SQLite og aldrig i en log. Spec sec.7 kraever krypteret opbevaring;
 * SQLite-filen er ikke krypteret. Paa web bruges en in-memory fallback, se
 * kommentaren ved webCredentials ovenfor.
 */
export async function saveCredentials(creds: XtreamCredentials): Promise<void> {
  if (Platform.OS === 'web') {
    webCredentials = creds;
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(creds));
}

export async function loadCredentials(): Promise<XtreamCredentials | null> {
  if (Platform.OS === 'web') {
    return webCredentials;
  }

  const raw = await SecureStore.getItemAsync(KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isValidCredentials(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    // Beskadiget vaerdi behandles som ingen credentials: brugeren onboarder igen.
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  if (Platform.OS === 'web') {
    webCredentials = null;
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}
