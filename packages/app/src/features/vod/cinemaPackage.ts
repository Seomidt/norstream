import type { SqlDatabase } from '../../storage/types.js';
import { cachedQuery } from '../../storage/queryCache.js';
import { cleanVodTitle } from '../../sync/tmdb.js';
import type { TmdbTitle } from '../../sync/tmdbHome.js';
import { comparableTitle } from '../home/panelMatch.js';

interface CatalogueRow { key: string; name: string; year: number | null; tmdb_id: number | null }
interface CatalogueIndex { ids: Map<number, string>; names: Map<string, string> }
const databaseIds = new WeakMap<SqlDatabase, number>();
let nextDatabaseId = 0;

/** Katalogsynk og sletning af kilde invaliderer den eksisterende query-cache.
 * Kun filmnoegle/navn/aar/id laeses, aldrig en forespoergsel per plakat. */
function catalogueIndex(db: SqlDatabase): Promise<CatalogueIndex> {
  let id = databaseIds.get(db);
  if (id === undefined) { id = ++nextDatabaseId; databaseIds.set(db, id); }
  return cachedQuery(`cinema-package:${id}`, async () => {
    const rows = await db.getAllAsync<CatalogueRow>(
      `SELECT i.key, i.name, COALESCE(fp.year, d.year, i.year) AS year, fp.tmdb_id
       FROM vod_items i LEFT JOIN vod_posters fp ON fp.item_key = i.key
       LEFT JOIN vod_details d ON d.item_key = i.key
       WHERE i.kind = 'movie' ORDER BY i.sort_order, i.key`,
    );
    const ids = new Map<number, string>();
    const names = new Map<string, string>();
    for (const row of rows) {
      if (row.tmdb_id !== null) {
        if (!ids.has(row.tmdb_id)) ids.set(row.tmdb_id, row.key);
        // Et kendt andet TMDB-id maa aldrig blive til et navnematch.
        continue;
      }
      const cleaned = cleanVodTitle(row.name);
      const year = row.year ?? cleaned.year;
      const name = comparableTitle(cleaned.title);
      if (name.length === 0 || year === null) continue;
      if (row.year !== null && cleaned.year !== null && row.year !== cleaned.year) continue;
      const key = `${year}:${name}`;
      if (!names.has(key)) names.set(key, row.key);
    }
    return { ids, names };
  }, 5 * 60_000);
}

/** Positive maerker kraever samme TMDB-id eller baade eksakt titel og aar.
 * Ukendt aar er ikke nok til at markere fx en genindspilning som tilgaengelig. */
export async function cinemaPackageMatches(db: SqlDatabase, titles: readonly TmdbTitle[]): Promise<Map<number, string>> {
  if (titles.length === 0) return new Map();
  const index = await catalogueIndex(db);
  const matches = new Map<number, string>();
  for (const title of titles) {
    if (title.kind !== 'movie') continue;
    const key = index.ids.get(title.id) ?? (title.year === null ? undefined : index.names.get(`${title.year}:${comparableTitle(title.title)}`));
    if (key !== undefined) matches.set(title.id, key);
  }
  return matches;
}
