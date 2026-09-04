import * as SecureStore from 'expo-secure-store';
import type { XtreamCredentials } from '@uhf-play/core';

const KEY = 'uhf_play_xtream_credentials';

/**
 * Credentials ligger i iOS Keychain og Android Keystore via expo-secure-store,
 * aldrig i SQLite og aldrig i en log. Spec sec.7 kraever krypteret opbevaring;
 * SQLite-filen er ikke krypteret.
 */
export async function saveCredentials(creds: XtreamCredentials): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(creds));
}

export async function loadCredentials(): Promise<XtreamCredentials | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as XtreamCredentials).baseUrl === 'string' &&
      typeof (parsed as XtreamCredentials).username === 'string' &&
      typeof (parsed as XtreamCredentials).password === 'string'
    ) {
      return parsed as XtreamCredentials;
    }
    return null;
  } catch {
    // Beskadiget vaerdi behandles som ingen credentials: brugeren onboarder igen.
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
