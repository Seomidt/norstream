import { normaliseChannelName } from '@norstream/core';
import type { SqlDatabase, SqlValue } from './types.js';

/**
 * Logoer brugeren selv har valgt.
 *
 * Arkiverne daekker det de daekker, og udbyderens egen vaert er doed. De
 * kanaler der er tilbage, kan kun faa et logo af den der sidder med
 * telefonen — og det skal vaere let: soeg i det register appen allerede
 * har hentet, eller indsaet en adresse. Valget staar foerst i logoraekken
 * og roeres ikke af nogen opdatering.
 */

export async function setLogoOverride(db: SqlDatabase, channelKey: string, url: string): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO logo_overrides (channel_key, url) VALUES (?, ?)', [
    channelKey,
    url.trim(),
  ]);
}

export async function clearLogoOverride(db: SqlDatabase, channelKey: string): Promise<void> {
  await db.runAsync('DELETE FROM logo_overrides WHERE channel_key = ?', [channelKey]);
}

export async function getLogoOverride(db: SqlDatabase, channelKey: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ url: string }>(
    'SELECT url FROM logo_overrides WHERE channel_key = ?',
    [channelKey],
  );
  return row?.url ?? null;
}

export interface RegistryLogoHit {
  /** Navnet som registret kender det, renset. */
  name: string;
  /** Landekode, eller '*' for de internationale. */
  country: string;
  url: string;
}

/**
 * Soeger i det hentede register paa et kanalnavn.
 *
 * Noeglerne er normaliserede navne med land bag: `TV2ECHO:DK`. Soegningen
 * normaliseres paa samme maade, saa "tv 2 echo" og "TV2 Echo HD" finder det
 * samme. Én raekke per adresse: den samme fil ligger under flere noegler
 * (land, stjerne, gamle navne), og den skal kun vises én gang.
 */
export async function searchRegistryLogos(
  db: SqlDatabase,
  query: string,
  limit = 60,
): Promise<RegistryLogoHit[]> {
  const key = normaliseChannelName(query);
  if (key.length === 0) return [];
  const rows = await db.getAllAsync<{ key: string; country: string; url: string }>(
    `SELECT key, country, url FROM registry_logos
     WHERE key LIKE ? ESCAPE '\\' AND key NOT LIKE 'id:%'
     ORDER BY LENGTH(key), key
     LIMIT ?`,
    [`${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, Math.max(1, limit * 4)],
  );
  const seen = new Set<string>();
  const hits: RegistryLogoHit[] = [];
  for (const row of rows) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    const separator = row.key.lastIndexOf(':');
    hits.push({
      name: separator === -1 ? row.key : row.key.slice(0, separator),
      country: row.country.length > 0 ? row.country : '*',
      url: row.url,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export interface ChannelWithoutLogo {
  id: string;
  name: string;
  isFavorite: boolean;
  hasOverride: boolean;
}

/**
 * Kanalerne der ikke har et logo fra nogen af arkiverne.
 *
 * Det vil sige: intet eget valg, intet fra en XMLTV-fil, intet i registret.
 * De staar med udbyderens egen adresse alene, og paa brugerens panel er den
 * vaert doed. Favoritterne foerst — det er dem man ser hver dag.
 */
export async function listChannelsWithoutArchiveLogo(
  db: SqlDatabase,
  opts: { search?: string; limit?: number } = {},
): Promise<ChannelWithoutLogo[]> {
  const params: SqlValue[] = [];
  let where = '';
  const search = opts.search?.trim() ?? '';
  if (search.length > 0) {
    where = "AND c.name LIKE ? ESCAPE '\\'";
    params.push(`%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
  }
  params.push(Math.max(1, Math.trunc(opts.limit ?? 200)));
  const rows = await db.getAllAsync<{ id: string; name: string; is_favorite: number | null; has_override: number | null }>(
    `SELECT c.id, c.name,
            CASE WHEN f.channel_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite,
            CASE WHEN lo.channel_key IS NOT NULL THEN 1 ELSE 0 END AS has_override
     FROM channels c
     LEFT JOIN favorites f ON f.channel_id = c.id
     LEFT JOIN logo_overrides lo ON lo.channel_key = c.id
     LEFT JOIN xmltv_logos xl ON xl.channel_key = c.id
     LEFT JOIN registry_logos ri ON ri.key = 'id:' || LOWER(TRIM(c.epg_channel_id))
     LEFT JOIN registry_logos rc ON rc.key = c.match_key || ':' || c.country
     LEFT JOIN registry_logos ra ON ra.key = c.match_key || ':*'
     WHERE lo.channel_key IS NULL AND xl.channel_key IS NULL
       AND ri.url IS NULL AND rc.url IS NULL AND ra.url IS NULL
       ${where}
     ORDER BY is_favorite DESC, c.sort_order
     LIMIT ?`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isFavorite: row.is_favorite === 1,
    hasOverride: row.has_override === 1,
  }));
}
