import type { SqlDatabase } from '../storage/types.js';

/**
 * Kanallogoer, hentet ned paa telefonen én gang.
 *
 * Foer laa ansvaret hos `Image`: hver gang en raekke kom paa skaermen, bad
 * den styresystemets billedcache om adressen, og den cache bestemmer selv
 * hvornaar den smider ting vaek. Det gav logoer der forsvandt og kom igen,
 * og opkald til de samme adresser dag efter dag.
 *
 * Nu hentes et logo til en fil under appens egen mappe og tegnes derfra.
 * Netvaerket bruges kun til kanaler der **ikke** har en fil endnu, og en
 * kanal hvor ingen adresse gav et logo, proeves ikke igen foer der er gaaet
 * et doegn — eller adresserne har aendret sig, eller brugeren beder om det.
 *
 * Alt der laeses under tegning er synkront og ligger i hukommelsen: tabellen
 * laeses ind én gang ved opstart og skrives igennem. Selve filerne ligger
 * bag `LogoFileStore`, saa reglerne her kan testes uden et filsystem.
 */
export interface LogoFileStore {
  /**
   * Henter adressen ned til en fil med det navn. Kaster naar den ikke kan
   * (ingen forbindelse, svar der ikke er 2xx). `head` er filens foerste
   * bytes, saa det kan afgoeres om det overhovedet er et billede.
   */
  download(url: string, fileName: string): Promise<{ uri: string; bytes: number; head: Uint8Array }>;
  /** Stien til en fil i logomappen, som den er lige nu. */
  uriFor(fileName: string): string;
  remove(uri: string): Promise<void>;
  removeAll(): Promise<void>;
}

interface CachedFile {
  uri: string;
  file: string;
  url: string;
  bytes: number;
}

interface Miss {
  tried: string;
  triedMs: number;
}

/** Hvor mange logoer der hentes ad gangen. Rullelisten beder om mange paa én gang. */
export const MAX_PARALLEL = 4;
/** Hvor laenge en kanal uden logo faar lov at vaere det, foer adresserne proeves igen. */
export const MISS_TTL_MS = 24 * 60 * 60_000;
/** Et logo stoerre end det er ikke et logo. */
export const MAX_LOGO_BYTES = 3 * 1024 * 1024;

const files = new Map<string, CachedFile>();
const misses = new Map<string, Miss>();
const inFlight = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
const queue: Array<{ key: string; uris: readonly string[] }> = [];
let running = 0;
let idleWaiters: Array<() => void> = [];
let database: SqlDatabase | null = null;
let store: LogoFileStore | null = null;

export async function initLogoCache(db: SqlDatabase, fileStore: LogoFileStore): Promise<void> {
  database = db;
  store = fileStore;
  files.clear();
  misses.clear();
  const rows = await db.getAllAsync<{ channel_key: string; url: string; file: string; bytes: number }>(
    'SELECT channel_key, url, file, bytes FROM logo_files',
  );
  for (const row of rows) {
    files.set(row.channel_key, {
      uri: fileStore.uriFor(row.file),
      file: row.file,
      url: row.url,
      bytes: row.bytes,
    });
  }
  const missed = await db.getAllAsync<{ channel_key: string; tried: string; tried_ms: number }>(
    'SELECT channel_key, tried, tried_ms FROM logo_misses',
  );
  for (const row of missed) misses.set(row.channel_key, { tried: row.tried, triedMs: row.tried_ms });
}

/** Filen kanalens logo ligger i, eller null naar der ikke er nogen. Synkron. */
export function cachedLogoUri(key: string): string | null {
  return files.get(key)?.uri ?? null;
}

/** Adressen det gemte logo kom fra. */
export function cachedLogoSource(key: string): string | null {
  return files.get(key)?.url ?? null;
}

/**
 * Soerger for at kanalen faar et logo, hvis den ikke har et. Koster intet
 * for en kanal der allerede har en fil, er ved at faa en, eller blev proevet
 * for nylig med de samme adresser.
 */
export function ensureLogo(key: string, uris: readonly string[], now = Date.now()): void {
  if (store === null || files.has(key) || inFlight.has(key) || uris.length === 0) return;
  const miss = misses.get(key);
  if (miss !== undefined && miss.tried === triedKey(uris) && now - miss.triedMs < MISS_TTL_MS) return;
  inFlight.add(key);
  queue.push({ key, uris: [...uris] });
  pump();
}

/** Kaldes naar kanalens logo aendrer sig: fil hentet, fjernet eller erstattet. */
export function subscribeLogo(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (set === undefined) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * Brugerens eget valg: hentes med det samme og erstatter det der laa.
 * Svarer med om det lykkedes — ellers staar kanalen uden logo, og kaederne
 * proeves igen som for enhver anden kanal.
 */
export async function replaceLogo(key: string, url: string): Promise<boolean> {
  if (store === null) return false;
  await removeFile(key);
  await clearMiss(key);
  const got = await fetchOne(key, url);
  notify(key);
  return got;
}

/**
 * Glemmer kanalens fil og forsoeg, saa adresserne proeves forfra ved naeste
 * tegning. Bruges naar brugeren fjerner sit eget valg.
 */
export async function resetLogo(key: string): Promise<void> {
  await removeFile(key);
  await clearMiss(key);
  notify(key);
}

/**
 * Filen kunne ikke tegnes — slettet af styresystemet, eller ikke et billede
 * alligevel. Filen fjernes, og kanalen taelles som proevet, saa den ikke
 * hentes og fejler i ring.
 */
export async function logoFailedToRender(key: string, uris: readonly string[]): Promise<void> {
  await removeFile(key);
  await recordMiss(key, uris, Date.now());
  notify(key);
}

/** Kanaler uden logo proeves igen, uanset hvornaar de sidst blev proevet. */
export async function forgetLogoMisses(): Promise<void> {
  misses.clear();
  await database?.runAsync('DELETE FROM logo_misses').catch(() => undefined);
}

/** Alle hentede logoer slettes. De hentes igen efterhaanden som kanalerne vises. */
export async function clearLogoCache(): Promise<void> {
  const keys = [...files.keys()];
  files.clear();
  misses.clear();
  await store?.removeAll();
  await database?.runAsync('DELETE FROM logo_files').catch(() => undefined);
  await database?.runAsync('DELETE FROM logo_misses').catch(() => undefined);
  for (const key of keys) notify(key);
}

export function logoCacheStats(): { count: number; bytes: number; missing: number } {
  let bytes = 0;
  for (const file of files.values()) bytes += file.bytes;
  return { count: files.size, bytes, missing: misses.size };
}

/** Til tests: naar koeen er tom og intet hentes. */
export function whenLogoQueueIdle(): Promise<void> {
  if (running === 0 && queue.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    idleWaiters.push(resolve);
  });
}

/** Til tests: alt glemmes, ogsaa databasen og filerne bag. */
export function resetLogoCacheForTests(): void {
  files.clear();
  misses.clear();
  inFlight.clear();
  listeners.clear();
  queue.length = 0;
  running = 0;
  idleWaiters = [];
  database = null;
  store = null;
}

function pump(): void {
  while (running < MAX_PARALLEL && queue.length > 0) {
    const job = queue.shift();
    if (job === undefined) break;
    running += 1;
    void resolveOne(job.key, job.uris).finally(() => {
      running -= 1;
      inFlight.delete(job.key);
      if (running === 0 && queue.length === 0) {
        const waiters = idleWaiters;
        idleWaiters = [];
        for (const resolve of waiters) resolve();
      } else {
        pump();
      }
    });
  }
}

async function resolveOne(key: string, uris: readonly string[]): Promise<void> {
  for (const url of uris) {
    if (files.has(key)) break;
    if (await fetchOne(key, url)) {
      notify(key);
      return;
    }
  }
  if (!files.has(key)) await recordMiss(key, uris, Date.now());
  notify(key);
}

/** Henter én adresse. Sandt naar der nu ligger en fil for kanalen. */
async function fetchOne(key: string, url: string): Promise<boolean> {
  if (store === null) return false;
  const file = fileNameFor(key, url);
  let result: { uri: string; bytes: number; head: Uint8Array };
  try {
    result = await store.download(url, file);
  } catch {
    return false;
  }
  if (result.bytes <= 0 || result.bytes > MAX_LOGO_BYTES || !looksLikeImage(result.head)) {
    await store.remove(result.uri).catch(() => undefined);
    return false;
  }
  files.set(key, { uri: result.uri, file, url, bytes: result.bytes });
  await database
    ?.runAsync(
      'INSERT OR REPLACE INTO logo_files (channel_key, url, file, bytes, fetched_ms) VALUES (?, ?, ?, ?, ?)',
      [key, url, file, result.bytes, Date.now()],
    )
    .catch(() => undefined);
  return true;
}

async function removeFile(key: string): Promise<void> {
  const file = files.get(key);
  if (file === undefined) return;
  files.delete(key);
  await store?.remove(file.uri).catch(() => undefined);
  await database?.runAsync('DELETE FROM logo_files WHERE channel_key = ?', [key]).catch(() => undefined);
}

async function recordMiss(key: string, uris: readonly string[], now: number): Promise<void> {
  const tried = triedKey(uris);
  misses.set(key, { tried, triedMs: now });
  await database
    ?.runAsync('INSERT OR REPLACE INTO logo_misses (channel_key, tried, tried_ms) VALUES (?, ?, ?)', [
      key,
      tried,
      now,
    ])
    .catch(() => undefined);
}

async function clearMiss(key: string): Promise<void> {
  if (!misses.has(key)) return;
  misses.delete(key);
  await database?.runAsync('DELETE FROM logo_misses WHERE channel_key = ?', [key]).catch(() => undefined);
}

function notify(key: string): void {
  const set = listeners.get(key);
  if (set === undefined) return;
  for (const listener of [...set]) listener();
}

function triedKey(uris: readonly string[]): string {
  return uris.join('\n');
}

/**
 * Filnavn for kanalens logo. Noeglen er kilde-id og stream-id; alt der ikke
 * maa staa i et filnavn bliver til en streg. Endelsen kommer fra adressen
 * naar den siger noget, ellers png — billedet afkodes efter indholdet, ikke
 * efter navnet.
 */
export function fileNameFor(key: string, url: string): string {
  const safe = key.replace(/[^A-Za-z0-9._-]+/g, '_');
  const match = /\.(png|jpe?g|gif|webp|bmp)(?:[?#]|$)/i.exec(url);
  const ext = match === undefined || match === null ? 'png' : match[1]!.toLowerCase();
  return `${safe}.${ext}`;
}

/**
 * Om de foerste bytes er et billedformat telefonen kan tegne. En vaert der
 * svarer 200 med en HTML-side, eller et SVG, ville ellers blive gemt som logo
 * og fejle ved hver tegning.
 */
export function looksLikeImage(head: Uint8Array): boolean {
  if (head.length < 4) return false;
  const [a, b, c, d] = [head[0]!, head[1]!, head[2]!, head[3]!];
  if (a === 0x89 && b === 0x50 && c === 0x4e && d === 0x47) return true; // PNG
  if (a === 0xff && b === 0xd8 && c === 0xff) return true; // JPEG
  if (a === 0x47 && b === 0x49 && c === 0x46 && d === 0x38) return true; // GIF
  if (a === 0x42 && b === 0x4d) return true; // BMP
  if (a === 0x00 && b === 0x00 && c === 0x01 && d === 0x00) return true; // ICO
  if (
    a === 0x52 &&
    b === 0x49 &&
    c === 0x46 &&
    d === 0x46 &&
    head.length >= 12 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return true; // WEBP
  }
  return false;
}
