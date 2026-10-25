import type { SqlDatabase } from './types.js';
import { cachedQuery, invalidateQueryCache } from './queryCache.js';
import { withTransaction } from './transaction.js';
import { listVodItemsByKeys } from './vod.js';
import type { StoredVodItem } from './vod.js';
import { cleanVodTitle } from '../sync/tmdb.js';
import { comparableTitle } from '../features/home/panelMatch.js';

export interface MovieCollectionSummary {
  id: number;
  name: string;
  posterUrl: string | null;
  available: number;
}
export interface MovieCollectionPart {
  id: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  releaseDate: string | null;
  posterUrl: string | null;
}
export interface MovieCollectionDetails {
  id: number;
  name: string;
  posterUrl: string | null;
  parts: MovieCollectionPart[];
}
export interface CollectionCandidate { key: string; name: string; year: number | null; tmdbId: number | null }
interface CatalogueRow { key: string; name: string; year: number | null; tmdb_id: number | null }
interface MemberRow { collection_id: number; tmdb_id: number; title: string; original_title: string | null; year: number | null; release_date: string | null }
interface CollectionRow { id: number; name: string; poster_url: string | null }
interface Match { collectionId: number; tmdbId: number; key: string; releaseDate: string | null; year: number | null }
const databaseIds = new WeakMap<SqlDatabase, number>();
let nextDatabaseId = 0;
export const COLLECTION_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** Samme katalogmatch for oversigt, samlingens film og genvejen paa filmen. */
async function matches(db: SqlDatabase): Promise<Match[]> {
  let id = databaseIds.get(db);
  if (id === undefined) { id = ++nextDatabaseId; databaseIds.set(db, id); }
  return cachedQuery(`movie-collections:${id}`, async () => {
    const members = await db.getAllAsync<MemberRow>('SELECT collection_id,tmdb_id,title,original_title,year,release_date FROM movie_collection_members');
    if (members.length === 0) return [];
    const catalogue = await db.getAllAsync<CatalogueRow>(
        `SELECT i.key, i.name, COALESCE(fp.year, d.year, i.year) AS year,
           COALESCE(fp.tmdb_id, CASE WHEN l.item_name=i.name THEN l.tmdb_id END) AS tmdb_id
         FROM vod_items i LEFT JOIN vod_posters fp ON fp.item_key=i.key
         LEFT JOIN vod_details d ON d.item_key=i.key
         LEFT JOIN movie_collection_lookup l ON l.item_key=i.key
         WHERE i.kind='movie' ORDER BY i.sort_order, i.key`,
      );
    const ids = new Map<number, string>();
    const names = new Map<string, string>();
    for (let index = 0; index < catalogue.length; index += 1) {
      const row = catalogue[index]!;
      if (row.tmdb_id !== null) {
        if (!ids.has(row.tmdb_id)) ids.set(row.tmdb_id, row.key);
      } else {
        const cleaned = cleanVodTitle(row.name);
        const year = row.year ?? cleaned.year;
        if (year !== null && (row.year === null || cleaned.year === null || row.year === cleaned.year)) {
          const name = comparableTitle(cleaned.title);
          if (name.length > 0 && !names.has(`${year}:${name}`)) names.set(`${year}:${name}`, row.key);
        }
      }
      // Et stort katalog maa ikke holde fjernbetjeningens JS-koe i et langt loop.
      if (index > 0 && index % 500 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const out: Match[] = [];
    const nameIds = new Map<string, number | null>();
    for (const member of members) {
      if (member.year === null) continue;
      for (const name of [member.title, member.original_title]) {
        if (name === null) continue;
        const key = `${member.year}:${comparableTitle(name)}`;
        const previous = nameIds.get(key);
        nameIds.set(key, previous === undefined || previous === member.tmdb_id ? member.tmdb_id : null);
      }
    }
    for (const member of members) {
      let key = ids.get(member.tmdb_id);
      if (key === undefined && member.year !== null) {
        for (const name of [member.title, member.original_title]) {
          if (name === null) continue;
          const wanted = `${member.year}:${comparableTitle(name)}`;
          if (nameIds.get(wanted) === member.tmdb_id) key = names.get(wanted);
          if (key !== undefined) break;
        }
      }
      if (key !== undefined) out.push({ collectionId: member.collection_id, tmdbId: member.tmdb_id, key, releaseDate: member.release_date, year: member.year });
    }
    return out;
  }, 5 * 60_000);
}

export async function listMovieCollections(db: SqlDatabase): Promise<MovieCollectionSummary[]> {
  const rows = await db.getAllAsync<CollectionRow>('SELECT id,name,poster_url FROM movie_collections ORDER BY name COLLATE NOCASE,id');
  if (rows.length === 0) return [];
  const found = await matches(db);
  const counts = new Map<number, Set<number>>();
  for (const match of found) {
    const ids = counts.get(match.collectionId) ?? new Set<number>();
    ids.add(match.tmdbId); counts.set(match.collectionId, ids);
  }
  return rows.flatMap(row => {
    const available = counts.get(row.id)?.size ?? 0;
    return available === 0 ? [] : [{ id: row.id, name: row.name, posterUrl: row.poster_url, available }];
  });
}

export async function listMovieCollectionItems(db: SqlDatabase, collectionId: number): Promise<StoredVodItem[]> {
  const found = (await matches(db)).filter(row => row.collectionId === collectionId)
    .sort((a, b) => (a.releaseDate ?? `${a.year ?? 9999}-12-31`).localeCompare(b.releaseDate ?? `${b.year ?? 9999}-12-31`) || a.tmdbId - b.tmdbId);
  const ordered = [...new Map(found.map(row => [row.tmdbId, row])).values()];
  const items = new Map((await listVodItemsByKeys(db, ordered.map(row => row.key))).map(item => [item.key, item]));
  return ordered.flatMap(row => { const item = items.get(row.key); return item === undefined ? [] : [item]; });
}

export async function movieCollectionForItem(db: SqlDatabase, itemKey: string): Promise<MovieCollectionSummary | null> {
  const all = await listMovieCollections(db);
  if (all.length === 0) return null;
  const [found, item] = await Promise.all([
    matches(db),
    db.getFirstAsync<{ tmdb_id: number | null }>(
      `SELECT COALESCE(fp.tmdb_id,CASE WHEN l.item_name=i.name THEN l.tmdb_id END) AS tmdb_id
       FROM vod_items i LEFT JOIN vod_posters fp ON fp.item_key=i.key
       LEFT JOIN movie_collection_lookup l ON l.item_key=i.key WHERE i.key=? AND i.kind='movie'`, [itemKey],
    ),
  ]);
  const match = found.find(row => row.key === itemKey || (item?.tmdb_id !== null && item?.tmdb_id !== undefined && row.tmdbId === item.tmdb_id));
  return match === undefined ? null : all.find(row => row.id === match.collectionId) ?? null;
}

/** Kun metadata fra et gyldigt TMDB-svar maa erstatte en gammel samling. */
export async function saveMovieCollection(db: SqlDatabase, collection: MovieCollectionDetails, now: number): Promise<void> {
  await withTransaction(db, async () => {
    await db.runAsync(`INSERT INTO movie_collections(id,name,poster_url,fetched_ms) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,poster_url=excluded.poster_url,fetched_ms=excluded.fetched_ms`,
    [collection.id, collection.name, collection.posterUrl, now]);
    await db.runAsync('DELETE FROM movie_collection_members WHERE collection_id=?', [collection.id]);
    for (const part of collection.parts) {
      await db.runAsync(`INSERT INTO movie_collection_members(collection_id,tmdb_id,title,original_title,year,release_date,poster_url)
        VALUES(?,?,?,?,?,?,?)`, [collection.id, part.id, part.title, part.originalTitle, part.year, part.releaseDate, part.posterUrl]);
    }
  });
  invalidateQueryCache();
}

export async function saveCollectionLookup(db: SqlDatabase, candidate: CollectionCandidate, tmdbId: number | null, collectionId: number | null, now: number): Promise<void> {
  // En ny katalogsynk kan have fjernet eller omdoebt filmen under netkaldet.
  await db.runAsync(`INSERT INTO movie_collection_lookup(item_key,item_name,tmdb_id,collection_id,checked_ms)
    SELECT key,name,?,?,? FROM vod_items WHERE key=? AND name=? AND kind='movie'
    ON CONFLICT(item_key) DO UPDATE SET item_name=excluded.item_name,tmdb_id=excluded.tmdb_id,
      collection_id=excluded.collection_id,checked_ms=excluded.checked_ms`,
  [tmdbId, collectionId, now, candidate.key, candidate.name]);
  invalidateQueryCache();
}

export async function collectionCandidates(db: SqlDatabase, now: number, limit: number, itemKey?: string): Promise<CollectionCandidate[]> {
  const rows = await db.getAllAsync<CatalogueRow>(
    `SELECT i.key,i.name,COALESCE(fp.year,d.year,i.year) AS year,
      COALESCE(fp.tmdb_id,CASE WHEN l.item_name=i.name THEN l.tmdb_id END) AS tmdb_id
     FROM vod_items i LEFT JOIN vod_posters fp ON fp.item_key=i.key
     LEFT JOIN vod_details d ON d.item_key=i.key LEFT JOIN movie_collection_lookup l ON l.item_key=i.key
     WHERE i.kind='movie' AND (l.item_key IS NULL OR l.item_name<>i.name OR l.checked_ms<?)
       ${itemKey === undefined ? '' : 'AND i.key=?'}
     ORDER BY CASE WHEN fp.tmdb_id IS NULL THEN 1 ELSE 0 END,i.added_ms DESC,i.sort_order,i.key LIMIT ?`,
    itemKey === undefined ? [now - COLLECTION_MAX_AGE_MS, limit] : [now - COLLECTION_MAX_AGE_MS, itemKey, limit],
  );
  return rows.map(row => ({ key: row.key, name: row.name, year: row.year, tmdbId: row.tmdb_id }));
}

export async function collectionIsFresh(db: SqlDatabase, id: number, now: number): Promise<boolean> {
  const row = await db.getFirstAsync<{ fetched_ms: number }>('SELECT fetched_ms FROM movie_collections WHERE id=?', [id]);
  return row !== null && now - row.fetched_ms < COLLECTION_MAX_AGE_MS;
}

/** Samme offentlige film-id genbruger metadata paa tvaers af kvalitetsudgaver. */
export async function freshCollectionLookup(db: SqlDatabase, tmdbId: number, now: number): Promise<{ collectionId: number | null } | null> {
  return db.getFirstAsync<{ collectionId: number | null }>(
    `SELECT l.collection_id AS collectionId FROM movie_collection_lookup l
     JOIN vod_items i ON i.key=l.item_key AND i.name=l.item_name
     WHERE l.tmdb_id=? AND l.checked_ms>=? AND i.kind='movie' LIMIT 1`,
    [tmdbId, now - COLLECTION_MAX_AGE_MS],
  );
}
