import { getTmdbApiKey } from '../storage/settings.js';
import type { SqlDatabase } from '../storage/types.js';
import { TmdbRequestError, searchTmdb, tmdbFetch } from '../sync/tmdb.js';
import type { TmdbFetch } from '../sync/tmdb.js';

/**
 * Fylder plakater — og karakterer — ind for de film og serier der ingen har.
 *
 * Samme moenster som logoerne: en plakat slaas op naar titlen vises uden
 * en, hoejst nogle faa ad gangen, og svaret gemmes — ogsaa et nej, saa den
 * samme titel ikke spoerges om igen foer der er gaaet en maaned. Opslaget
 * gaar til TMDB og kraever brugerens egen noegle; uden den goeres intet.
 *
 * Det der findes, laeses ind i `vod_posters` og foelger med i alle lister
 * gennem opslaget i `storage/vod.ts`. Her holdes kun det der skal til for
 * at tegne med det samme: hvad der er fundet siden listen blev hentet.
 */
export const MAX_PARALLEL = 2;
export const MISS_TTL_MS = 30 * 24 * 60 * 60_000;
/** Efter en fejl fra TMDB (forkert noegle, nede) ventes der saa laenge foer der spoerges igen. */
export const ERROR_PAUSE_MS = 30_000;

const found = new Map<string, string>();
const inFlight = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
const queue: Array<{ key: string; kind: 'movie' | 'series'; name: string }> = [];
let running = 0;
let database: SqlDatabase | null = null;
let fetcher: TmdbFetch | null = null;
let apiKey: string | null = null;
let idleWaiters: Array<() => void> = [];
/** Ingen opslag foer dette tidspunkt: TMDB har lige svaret med en fejl. */
let pausedUntil = 0;

export async function initPosterFill(db: SqlDatabase, fetchImpl: TmdbFetch = tmdbFetch): Promise<void> {
  database = db;
  fetcher = fetchImpl;
  found.clear();
  apiKey = await getTmdbApiKey(db);
}

/** Naar noeglen aendres under Indstillinger. Tomt = slaaet fra. */
export function setPosterApiKey(key: string | null): void {
  const next = key === null || key.trim().length === 0 ? null : key.trim();
  const changed = next !== apiKey;
  apiKey = next;
  pausedUntil = 0;
  // En ny noegle: alt der blev husket som "findes ikke" med den gamle
  // (maaske forkerte) noegle skal proeves igen.
  if (changed && next !== null) void forgetPosterMisses();
}

/**
 * Glemmer de titler TMDB ikke havde en plakat til, saa de slaas op igen
 * naar de vises. Bruges naar noeglen skiftes og naar brugeren henter alt
 * forfra under Indstillinger.
 */
export async function forgetPosterMisses(): Promise<void> {
  if (database === null) return;
  await database.runAsync('DELETE FROM vod_posters WHERE url IS NULL').catch(() => undefined);
}

export function posterApiKeyPresent(): boolean {
  return apiKey !== null;
}

/** En plakat fundet siden listen blev hentet, ellers null. Synkron. */
export function foundPoster(key: string): string | null {
  return found.get(key) ?? null;
}

/** Beder om en plakat til en titel uden. Koster intet naar den er slaaet op for nylig. */
export function ensurePoster(item: { key: string; kind: 'movie' | 'series'; name: string }): void {
  if (apiKey === null || database === null || fetcher === null) return;
  if (found.has(item.key) || inFlight.has(item.key)) return;
  if (Date.now() < pausedUntil) return;
  inFlight.add(item.key);
  queue.push({ key: item.key, kind: item.kind, name: item.name });
  pump();
}

export function subscribePoster(key: string, listener: () => void): () => void {
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

/** Til tests. */
export function whenPosterQueueIdle(): Promise<void> {
  if (running === 0 && queue.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    idleWaiters.push(resolve);
  });
}

export function resetPosterFillForTests(): void {
  found.clear();
  inFlight.clear();
  listeners.clear();
  queue.length = 0;
  running = 0;
  idleWaiters = [];
  database = null;
  fetcher = null;
  apiKey = null;
  pausedUntil = 0;
}

function pump(): void {
  while (running < MAX_PARALLEL && queue.length > 0) {
    const job = queue.shift();
    if (job === undefined) break;
    running += 1;
    void lookUp(job).finally(() => {
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

async function lookUp(job: { key: string; kind: 'movie' | 'series'; name: string }): Promise<void> {
  if (database === null || fetcher === null || apiKey === null) return;
  const earlier = await database.getFirstAsync<{ url: string | null; tried_ms: number }>(
    'SELECT url, tried_ms FROM vod_posters WHERE item_key = ?',
    [job.key],
  );
  if (earlier !== null) {
    if (earlier.url !== null) {
      found.set(job.key, earlier.url);
      notify(job.key);
      return;
    }
    if (Date.now() - earlier.tried_ms < MISS_TTL_MS) return;
  }
  let hit: Awaited<ReturnType<typeof searchTmdb>>;
  try {
    hit = await searchTmdb(fetcher, apiKey, job.kind, job.name);
  } catch (error) {
    // Intet svar er ikke et nej: gemmes ikke, og der holdes en pause saa
    // en forkert noegle ikke giver et opslag per plakat paa skaermen.
    if (error instanceof TmdbRequestError || error instanceof Error) pausedUntil = Date.now() + ERROR_PAUSE_MS;
    return;
  }
  const url = hit?.posterUrl ?? null;
  await database
    .runAsync(
      'INSERT OR REPLACE INTO vod_posters (item_key, url, rating, tried_ms) VALUES (?, ?, ?, ?)',
      [job.key, url, hit?.rating ?? null, Date.now()],
    )
    .catch(() => undefined);
  if (url !== null) {
    found.set(job.key, url);
    notify(job.key);
  }
}

function notify(key: string): void {
  const set = listeners.get(key);
  if (set === undefined) return;
  for (const listener of [...set]) listener();
}
