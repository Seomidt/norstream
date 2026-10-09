import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { XtreamCredentials } from '@norstream/core';

/** Nøglen fra tiden med ét panel. Laeses stadig, saa den kan flyttes over. */
const LEGACY_KEY = 'uhf_play_xtream_credentials';

/** Én kilde, ét sted i Keychain. */
function keyFor(sourceId: string): string {
  return `norstream_source_${sourceId}`;
}

/**
 * expo-secure-store har ingen web-implementering (den er en tom stub der
 * kaster ved kald). Paa web holder vi derfor credentials i en modul-variabel
 * i stedet: de overlever kun den nuvaerende side-session og forsvinder ved et
 * genindlaes. Det er bevidst — vi vil ikke gemme et panel-kodeord i
 * localStorage, hvor det ligger i klartekst og kan laeses af ethvert script
 * paa origin'et. Web er en udviklings-flade her, ikke en distributions-
 * platform, saa "log ind igen efter genindlaes" er en accepteret konsekvens.
 */
const webStore = new Map<string, string>();

async function readItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return webStore.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function writeItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function isValidCredentials(value: unknown): value is XtreamCredentials {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as XtreamCredentials).baseUrl === 'string' &&
    typeof (value as XtreamCredentials).username === 'string' &&
    typeof (value as XtreamCredentials).password === 'string'
  );
}

function parse(raw: string | null): XtreamCredentials | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidCredentials(parsed) ? parsed : null;
  } catch {
    // Beskadiget vaerdi behandles som ingen credentials.
    return null;
  }
}

/**
 * Adgangsoplysninger ligger i iOS Keychain og Android Keystore via
 * expo-secure-store, aldrig i SQLite og aldrig i en log. SQLite-filen er ikke
 * krypteret, og `sources`-tabellen har derfor ingen kolonne til kodeord.
 */
export async function saveSourceCredentials(
  sourceId: string,
  creds: XtreamCredentials,
): Promise<void> {
  await writeItem(keyFor(sourceId), JSON.stringify(creds));
}

export async function loadSourceCredentials(
  sourceId: string,
): Promise<XtreamCredentials | null> {
  return parse(await readItem(keyFor(sourceId)));
}

export async function clearSourceCredentials(sourceId: string): Promise<void> {
  await deleteItem(keyFor(sourceId));
}

/** Adgangsoplysningerne fra tiden med ét panel, hvis de stadig ligger der. */
export async function loadLegacyCredentials(): Promise<XtreamCredentials | null> {
  return parse(await readItem(LEGACY_KEY));
}

export async function clearLegacyCredentials(): Promise<void> {
  await deleteItem(LEGACY_KEY);
}
