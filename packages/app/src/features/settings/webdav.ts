import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { fileUrl, folderUrl } from './webdavUrl.js';
export { fileUrl, folderUrl } from './webdavUrl.js';

/**
 * Sikkerhedskopi til en WebDAV-sky: pCloud, Koofr, Nextcloud, en NAS.
 *
 * Google Drev kan ikke logges ind med brugernavn og kodeord fra en app
 * (Google kraever deres eget web-login). WebDAV kan: man taster adresse,
 * bruger og kode, og appen laegger filen med en almindelig HTTP-PUT. Det
 * virker fra tv'et, hvor der hverken er filvaelger eller Drev-app.
 *
 * Adressen skal pege paa en mappe (ender paa "/"); appen laver den om noedvendigt
 * (MKCOL) og skriver norstream-sikkerhedskopi.json i den.
 */
export interface WebdavConfig {
  /** Mappens adresse, fx https://webdav.koofr.net/dav/NorStream/ */
  url: string;
  username: string;
  password: string;
}

const CONFIG_KEY = 'norstream_webdav';

/** Kodeord ligger i Keychain/Keystore, ikke i SQLite. Web har ingen secure-store. */
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

export async function getWebdavConfig(): Promise<WebdavConfig | null> {
  const raw = await readItem(CONFIG_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WebdavConfig>;
    if (typeof parsed.url === 'string' && typeof parsed.username === 'string' && typeof parsed.password === 'string' && parsed.url.length > 0) {
      return { url: parsed.url, username: parsed.username, password: parsed.password };
    }
  } catch {
    // Beskadiget; behandles som ingen.
  }
  return null;
}

export async function setWebdavConfig(config: WebdavConfig | null): Promise<void> {
  if (config === null) {
    if (Platform.OS === 'web') webStore.delete(CONFIG_KEY);
    else await SecureStore.deleteItemAsync(CONFIG_KEY);
    return;
  }
  await writeItem(CONFIG_KEY, JSON.stringify(config));
}

function authHeader(config: WebdavConfig): string {
  // btoa findes ikke i React Native; Buffer gør. base64 af "bruger:kode".
  const raw = `${config.username}:${config.password}`;
  const base64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(raw))) : Buffer.from(raw, 'utf-8').toString('base64');
  return `Basic ${base64}`;
}

const TIMEOUT_MS = 20_000;

async function request(method: string, url: string, headers: Record<string, string>, body?: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { method, headers, body, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** En kort, menneskelig grund til at det gik galt, uden kodeordet. */
function reason(status: number): string {
  if (status === 401 || status === 403) return 'Forkert brugernavn eller kodeord.';
  if (status === 404 || status === 409) return 'Mappen kunne ikke findes eller laves. Tjek adressen.';
  if (status === 507) return 'Der er ikke mere plads i skyen.';
  return `Tjenesten svarede HTTP ${status}.`;
}

/** Laver mappen hvis den mangler, og skriver filen. Kaster med en grund ved fejl. */
export async function putBackup(config: WebdavConfig, json: string): Promise<void> {
  const auth = { Authorization: authHeader(config) };
  // MKCOL er harmloest naar mappen findes (405/301); kun rigtige fejl stopper.
  try {
    await request('MKCOL', folderUrl(config.url), auth);
  } catch {
    // Netfejl paa MKCOL: PUT'en nedenfor giver den rigtige besked.
  }
  let response: Response;
  try {
    response = await request('PUT', fileUrl(config.url), { ...auth, 'Content-Type': 'application/json' }, json);
  } catch {
    throw new Error('Skyen kunne ikke nås. Er der forbindelse, og er adressen rigtig?');
  }
  if (!response.ok) throw new Error(reason(response.status));
}

/** Henter filens indhold. Kaster med en grund ved fejl. */
export async function getBackup(config: WebdavConfig): Promise<string> {
  let response: Response;
  try {
    response = await request('GET', fileUrl(config.url), { Authorization: authHeader(config) });
  } catch {
    throw new Error('Skyen kunne ikke nås. Er der forbindelse, og er adressen rigtig?');
  }
  if (response.status === 404) throw new Error('Der ligger ingen sikkerhedskopi i skyen endnu.');
  if (!response.ok) throw new Error(reason(response.status));
  return response.text();
}
