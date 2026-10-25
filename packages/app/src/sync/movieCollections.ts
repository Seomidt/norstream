import type { SqlDatabase } from '../storage/types.js';
import {
  collectionCandidates, collectionIsFresh, freshCollectionLookup, saveCollectionLookup, saveMovieCollection, staleMovieCollectionIds,
} from '../storage/movieCollections.js';
import type { MovieCollectionDetails, MovieCollectionPart } from '../storage/movieCollections.js';
import { searchTmdb, tmdbAuth, TmdbRequestError } from './tmdb.js';
import type { TmdbFetch } from './tmdb.js';

const API = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p/w342';
interface RunningDiscovery { scope: string | null; promise: Promise<CollectionDiscoveryResult>; isCancelled: () => boolean }
const running = new WeakMap<SqlDatabase, RunningDiscovery>();
export interface CollectionDiscoveryOptions {
  limit?: number;
  itemKey?: string;
  isCancelled?: () => boolean;
  now?: () => number;
  pauseMs?: number;
  /** Kendte samlinger genhenter kun udloebne dele, ikke nye katalogtitler. */
  knownOnly?: boolean;
}
export interface CollectionDiscoveryResult { looked: number; changed: number; remaining: boolean; failed: boolean }
const validId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const scopeOf = (options: CollectionDiscoveryOptions): string | null => options.knownOnly === true ? 'known-collections' : options.itemKey === undefined ? null : `item:${options.itemKey}`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, 250) : null;
function image(value: unknown): string | null {
  return typeof value === 'string' && /^\/[a-zA-Z0-9_./-]+$/.test(value) ? IMAGE + value : null;
}

/** Manglende felt er ikke et bekraeftet nej til en samling. */
export function movieCollectionId(raw: unknown, expectedMovieId: number): number | null {
  if (!record(raw) || raw.id !== expectedMovieId || !Object.hasOwn(raw, 'belongs_to_collection')) throw new TmdbRequestError(null);
  const value = raw.belongs_to_collection;
  if (value === null) return null;
  if (!record(value) || !validId(value.id)) throw new TmdbRequestError(null);
  return value.id;
}

export function parseMovieCollection(raw: unknown, expectedId: number): MovieCollectionDetails {
  if (!record(raw) || raw.id !== expectedId || !Array.isArray(raw.parts) || text(raw.name) === null || raw.parts.length > 2000) throw new TmdbRequestError(null);
  const parts = new Map<number, MovieCollectionPart>();
  for (const part of raw.parts) {
    if (!record(part) || !validId(part.id) || text(part.title) === null) throw new TmdbRequestError(null);
    const date = typeof part.release_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(part.release_date) ? part.release_date : null;
    parts.set(part.id, {
      id: part.id, title: text(part.title)!, originalTitle: text(part.original_title),
      year: date === null ? null : Number(date.slice(0, 4)), releaseDate: date, posterUrl: image(part.poster_path),
    });
  }
  return { id: expectedId, name: text(raw.name)!, posterUrl: image(raw.poster_path), parts: [...parts.values()] };
}

async function json(fetchImpl: TmdbFetch, apiKey: string, path: string): Promise<unknown> {
  const auth = tmdbAuth(apiKey);
  try {
    const response = await fetchImpl(`${API}${path}?language=da-DK${auth.query}`, auth.headers);
    // Ogsaa fejl-svar forbruges, saa fetch-indpakningens body-timeout ryddes.
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new TmdbRequestError(response.ok ? null : response.status); }
    if (!response.ok) throw new TmdbRequestError(response.status);
    return value;
  } catch (error) {
    if (error instanceof TmdbRequestError) throw error;
    throw new TmdbRequestError(null);
  }
}

/** Smaa metadatabatches, ingen video-, login- eller arkivforbindelse. */
export function discoverMovieCollections(
  db: SqlDatabase, fetchImpl: TmdbFetch, apiKey: string, options: CollectionDiscoveryOptions = {},
): Promise<CollectionDiscoveryResult> {
  const previous = running.get(db);
  if (previous !== undefined) {
    // Et enkelt filmkort og hele oversigten har forskellige kandidater.
    // Del samme scope, men genberegn et andet scopes restarbejde bagefter.
    return previous.promise.then(result => !options.isCancelled?.()
      && (previous.scope !== scopeOf(options) || previous.isCancelled())
      ? discoverMovieCollections(db, fetchImpl, apiKey, options) : result);
  }
  const task = run(db, fetchImpl, apiKey, options).finally(() => { if (running.get(db)?.promise === task) running.delete(db); });
  running.set(db, { scope: scopeOf(options), promise: task, isCancelled: options.isCancelled ?? (() => false) });
  return task;
}

async function run(db: SqlDatabase, fetchImpl: TmdbFetch, apiKey: string, options: CollectionDiscoveryOptions): Promise<CollectionDiscoveryResult> {
  const result: CollectionDiscoveryResult = { looked: 0, changed: 0, remaining: false, failed: false };
  const stopped = options.isCancelled ?? (() => false);
  if (apiKey.trim().length === 0 || stopped()) return result;
  const limit = Math.max(1, Math.min(30, Math.trunc(options.limit ?? 12)));
  const now = options.now ?? Date.now;
  if (options.knownOnly === true) {
    const ids = await staleMovieCollectionIds(db, now(), limit);
    for (const id of ids) {
      if (stopped()) return result;
      try {
        const collection = parseMovieCollection(await json(fetchImpl, apiKey, `/collection/${id}`), id);
        if (stopped()) return result;
        await saveMovieCollection(db, collection, now());
        result.looked += 1;
        result.changed += 1;
      } catch { result.failed = true; break; }
    }
    if (!stopped() && !result.failed) result.remaining = (await staleMovieCollectionIds(db, now(), 1)).length > 0;
    return result;
  }
  const candidates = await collectionCandidates(db, now(), limit, options.itemKey);
  const membership = new Map<number, number | null>();
  result.remaining = candidates.length === limit;
  for (const candidate of candidates) {
    if (stopped()) break;
    try {
      let tmdbId = candidate.tmdbId;
      if (tmdbId === null) tmdbId = (await searchTmdb(fetchImpl, apiKey, 'movie', candidate.name, candidate.year))?.id ?? null;
      if (stopped()) break;
      result.looked += 1;
      let collectionId: number | null = null;
      if (tmdbId !== null) {
        if (membership.has(tmdbId)) collectionId = membership.get(tmdbId)!;
        else {
          const cached = await freshCollectionLookup(db, tmdbId, now());
          if (stopped()) break;
          collectionId = cached === null ? movieCollectionId(await json(fetchImpl, apiKey, `/movie/${tmdbId}`), tmdbId) : cached.collectionId;
          if (stopped()) break;
          membership.set(tmdbId, collectionId);
        }
        const fresh = collectionId === null || await collectionIsFresh(db, collectionId, now());
        if (stopped()) break;
        if (collectionId !== null && !fresh) {
          const collection = parseMovieCollection(await json(fetchImpl, apiKey, `/collection/${collectionId}`), collectionId);
          if (stopped()) break;
          await saveMovieCollection(db, collection, now());
        }
      }
      if (stopped()) break;
      await saveCollectionLookup(db, candidate, tmdbId, collectionId, now());
      result.changed += 1;
      const pause = options.pauseMs ?? 120;
      if (pause > 0 && !stopped()) await new Promise<void>(resolve => setTimeout(resolve, pause));
    } catch {
      // Offline, forkert noegle og fejlformat gemmes aldrig som "ingen samling".
      result.failed = true;
      result.remaining = false;
      break;
    }
  }
  if (!stopped() && !result.failed) result.remaining = (await collectionCandidates(db, now(), 1, options.itemKey)).length > 0;
  return result;
}
