import { genresFromTmdbIds, packGenres } from '../storage/genres.js';
import type { SqlDatabase } from '../storage/types.js';
import { TmdbRequestError, searchTmdb, watchProviders } from './tmdb.js';
import type { TmdbFetch } from './tmdb.js';
import { MISS_TTL_MS } from '../ui/posterFill.js';
import { logEvent } from '../diagnostics/log.js';

/**
 * Genre og aar fra TMDB til film og serier i baggrunden (v367).
 *
 * Plakatopslaget (`ui/posterFill.ts`) spoerger kun for titler der vises uden
 * plakat eller karakter. Filteret under Film vil ogsaa vide genren paa dem
 * der har begge dele fra panelet, saa her gaas listen igennem bagfra, nyeste
 * foerst, nogle hundrede ad gangen. Svaret gemmes i den samme tabel som
 * plakaterne, saa ét opslag per titel giver alt. TMDB er ikke panelet og
 * konkurrerer ikke om dets ene forbindelse; der holdes bare en lille pause
 * mellem kaldene.
 */
export const META_BATCH = 300;
const PAUSE_MS = 120;

let running: Promise<{ looked: number; found: number }> | null = null;

export function enrichVodMeta(
  db: SqlDatabase,
  fetchImpl: TmdbFetch,
  apiKey: string,
  options: { limit?: number; kind?: 'movie' | 'series'; pauseMs?: number; now?: () => number } = {},
): Promise<{ looked: number; found: number }> {
  if (running !== null) return running;
  running = run(db, fetchImpl, apiKey, options).finally(() => {
    running = null;
  });
  return running;
}

async function run(
  db: SqlDatabase,
  fetchImpl: TmdbFetch,
  apiKey: string,
  options: { limit?: number; kind?: 'movie' | 'series'; pauseMs?: number; now?: () => number },
): Promise<{ looked: number; found: number }> {
  const now = options.now ?? Date.now;
  const limit = options.limit ?? META_BATCH;
  const pauseMs = options.pauseMs ?? PAUSE_MS;
  // Ingen raekke endnu; eller en raekke fra foer v25 (fundet, men uden
  // genre); eller et nej der er gammelt nok til at proeve igen.
  const rows = await db.getAllAsync<{ key: string; kind: string; name: string }>(
    `SELECT i.key, i.kind, i.name FROM vod_items i
     LEFT JOIN vod_posters fp ON fp.item_key = i.key
     WHERE (fp.item_key IS NULL
            OR (fp.genres IS NULL AND (fp.url IS NOT NULL OR fp.rating IS NOT NULL OR fp.tried_ms < ?)))
       ${options.kind === undefined ? '' : 'AND i.kind = ?'}
     ORDER BY i.added_ms DESC, i.sort_order LIMIT ?`,
    options.kind === undefined ? [now() - MISS_TTL_MS, limit] : [now() - MISS_TTL_MS, options.kind, limit],
  );
  if (rows.length === 0) return { looked: 0, found: 0 };
  const startedAt = now();
  let looked = 0;
  let found = 0;
  for (const row of rows) {
    let hit: Awaited<ReturnType<typeof searchTmdb>>;
    try {
      hit = await searchTmdb(fetchImpl, apiKey, row.kind === 'series' ? 'series' : 'movie', row.name);
    } catch (cause) {
      // Noeglen afvist eller TMDB nede: resten venter til naeste gang.
      logEvent('baggrund', `film-info: stoppede efter ${looked} opslag (${cause instanceof TmdbRequestError && cause.status !== null ? `HTTP ${cause.status}` : 'intet svar'})`);
      break;
    }
    looked += 1;
    if (hit !== null) found += 1;
    // En fundet titel uden genre faar '' og ikke NULL, saa den ikke slaas op igen.
    const genres = hit === null ? null : packGenres(genresFromTmdbIds(hit.genreIds)) ?? '';
    await db
      .runAsync(
        'INSERT OR REPLACE INTO vod_posters (item_key, url, rating, tried_ms, genres, year, tmdb_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [row.key, hit?.posterUrl ?? null, hit?.rating ?? null, now(), genres, hit?.year ?? null, hit?.id ?? null],
      )
      .catch(() => undefined);
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  logEvent('baggrund', `film-info: ${looked} opslag hos TMDB, ${found} fundet, ${Math.round((now() - startedAt) / 1000)} s`);
  await fillProviders(db, fetchImpl, apiKey, { limit, kind: options.kind, pauseMs, now });
  return { looked, found };
}

/** Pakket som genrerne: ",8,119," saa SQL kan spoerge LIKE '%,8,%'. Tom = ligger ingen steder. */
export function packProviders(ids: readonly number[]): string {
  return ids.length === 0 ? '' : `,${ids.join(',')},`;
}

export function unpackProviders(packed: string | null | undefined): number[] {
  if (packed === null || packed === undefined || packed.length === 0) return [];
  return packed.split(',').filter((s) => s.length > 0).map(Number).filter((n) => Number.isFinite(n));
}

/**
 * Anden runde (v369): hvilke tjenester titlen ligger paa i Danmark, for de
 * titler TMDB kender (tmdb_id) og som ikke er spurgt endnu. Ét kald per
 * titel; svaret gemmes ogsaa naar det er "ingen", saa der ikke spoerges igen.
 */
export async function fillProviders(
  db: SqlDatabase,
  fetchImpl: TmdbFetch,
  apiKey: string,
  options: { limit?: number; kind?: 'movie' | 'series'; pauseMs?: number; now?: () => number } = {},
): Promise<number> {
  const now = options.now ?? Date.now;
  const limit = options.limit ?? META_BATCH;
  const pauseMs = options.pauseMs ?? PAUSE_MS;
  const rows = await db.getAllAsync<{ key: string; kind: string; tmdb_id: number }>(
    `SELECT i.key, i.kind, fp.tmdb_id FROM vod_items i
     JOIN vod_posters fp ON fp.item_key = i.key
     WHERE fp.tmdb_id IS NOT NULL AND fp.providers IS NULL
       ${options.kind === undefined ? '' : 'AND i.kind = ?'}
     ORDER BY i.added_ms DESC, i.sort_order LIMIT ?`,
    options.kind === undefined ? [limit] : [options.kind, limit],
  );
  if (rows.length === 0) return 0;
  const startedAt = now();
  let done = 0;
  let placed = 0;
  for (const row of rows) {
    let ids: number[];
    try {
      ids = await watchProviders(fetchImpl, apiKey, row.kind === 'series' ? 'series' : 'movie', row.tmdb_id);
    } catch (cause) {
      logEvent('baggrund', `tjenester: stoppede efter ${done} opslag (${cause instanceof TmdbRequestError && cause.status !== null ? `HTTP ${cause.status}` : 'intet svar'})`);
      break;
    }
    done += 1;
    if (ids.length > 0) placed += 1;
    await db.runAsync('UPDATE vod_posters SET providers = ? WHERE item_key = ?', [packProviders(ids), row.key]).catch(() => undefined);
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  logEvent('baggrund', `tjenester: ${done} opslag hos TMDB, ${placed} ligger paa en tjeneste i DK, ${Math.round((now() - startedAt) / 1000)} s`);
  return done;
}
