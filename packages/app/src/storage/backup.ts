import type { SqlDatabase } from './types.js';

/**
 * Sikkerhedskopi af det brugeren selv har lavet: favoritter i deres
 * raekkefoelge, fravalg, egne logoer, skjulte lande, indstillinger, "min
 * liste" og hvor langt film og afsnit er set.
 *
 * Ikke med: adgangskoder (de ligger i Keychain og skal tastes igen),
 * kanaler og programdata (de hentes igen), optagelser (filerne ligger paa
 * telefonen), og de hentede logo-filer (de hentes igen, én gang).
 *
 * **Kildens id er problemet.** Alt brugerens er noeglet paa kanalen, og
 * kanalens noegle begynder med kildens id — et id appen selv finder paa
 * naar man logger ind. Logger man ind paa ny, faar det samme panel et nyt
 * id, og en favorit fra den gamle installation peger paa ingenting. Derfor
 * gemmes kilderne med adresse og brugernavn, og ved gendannelse oversaettes
 * det gamle id til det nye for den kilde der har samme adresse og
 * brugernavn. Findes kilden ikke (endnu), springes dens ting over og
 * taelles.
 */
export const BACKUP_VERSION = 1;

export interface Backup {
  app: 'norstream';
  version: number;
  exportedMs: number;
  sources: Array<{
    id: string;
    kind: string;
    name: string;
    url: string;
    username: string | null;
    xmltvUrl: string | null;
  }>;
  favorites: Array<{ channelId: string; sourceCategoryId: string | null; position: number | null }>;
  favoriteExclusions: Array<{ channelId: string; categoryId: string }>;
  logoOverrides: Array<{ channelKey: string; url: string }>;
  hiddenCountries: string[];
  settings: Record<string, string>;
  watchlist: Array<{ itemKey: string; addedMs: number }>;
  progress: Array<{ itemKey: string; positionS: number; durationS: number | null; updatedMs: number }>;
}

/** Indstillinger der er brugerens valg, ikke appens bogholderi om hentetider. */
const SETTING_KEYS = [
  'subtitle_language',
  'stream_format',
  'mini_preview_enabled',
  'youtube_api_key',
  'tmdb_api_key',
  'google_search_key',
  'google_search_cx',
  'logo_registry_enabled',
];
/** Indstillinger per kilde: noeglen ender paa kildens id. */
const SCOPED_SETTING_PREFIXES = ['timeshift_dialect:', 'panel_offset_minutes:'];

export async function createBackup(db: SqlDatabase, now = Date.now()): Promise<Backup> {
  const sources = await db.getAllAsync<{
    id: string;
    kind: string;
    name: string;
    url: string;
    username: string | null;
    xmltv_url: string | null;
  }>('SELECT id, kind, name, url, username, xmltv_url FROM sources ORDER BY sort_order, created_at');
  const favorites = await db.getAllAsync<{
    channel_id: string;
    source_category_id: string | null;
    position: number | null;
  }>('SELECT channel_id, source_category_id, position FROM favorites ORDER BY position IS NULL, position');
  const exclusions = await db.getAllAsync<{ channel_id: string; category_id: string }>(
    'SELECT channel_id, category_id FROM favorite_exclusions',
  );
  const overrides = await db.getAllAsync<{ channel_key: string; url: string }>(
    'SELECT channel_key, url FROM logo_overrides',
  );
  const hidden = await db.getAllAsync<{ name: string }>('SELECT name FROM hidden_countries');
  const settingRows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM settings',
  );
  const watchlist = await db.getAllAsync<{ item_key: string; added_ms: number }>(
    'SELECT item_key, added_ms FROM vod_watchlist',
  );
  const progress = await db.getAllAsync<{
    item_key: string;
    position_s: number;
    duration_s: number | null;
    updated_ms: number;
  }>('SELECT item_key, position_s, duration_s, updated_ms FROM vod_progress');

  const settings: Record<string, string> = {};
  for (const row of settingRows) {
    if (SETTING_KEYS.includes(row.key) || SCOPED_SETTING_PREFIXES.some((p) => row.key.startsWith(p))) {
      settings[row.key] = row.value;
    }
  }

  return {
    app: 'norstream',
    version: BACKUP_VERSION,
    exportedMs: now,
    sources: sources.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      url: row.url,
      username: row.username,
      xmltvUrl: row.xmltv_url,
    })),
    favorites: favorites.map((row) => ({
      channelId: row.channel_id,
      sourceCategoryId: row.source_category_id,
      position: row.position,
    })),
    favoriteExclusions: exclusions.map((row) => ({
      channelId: row.channel_id,
      categoryId: row.category_id,
    })),
    logoOverrides: overrides.map((row) => ({ channelKey: row.channel_key, url: row.url })),
    hiddenCountries: hidden.map((row) => row.name),
    settings,
    watchlist: watchlist.map((row) => ({ itemKey: row.item_key, addedMs: row.added_ms })),
    progress: progress.map((row) => ({
      itemKey: row.item_key,
      positionS: row.position_s,
      durationS: row.duration_s,
      updatedMs: row.updated_ms,
    })),
  };
}

export function serialiseBackup(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}

/** Laeser en fil. Kaster med en besked der kan vises, naar det ikke er en sikkerhedskopi. */
export function parseBackup(text: string): Backup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Filen er ikke en sikkerhedskopi fra NorStream.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Filen er ikke en sikkerhedskopi fra NorStream.');
  }
  const candidate = parsed as Partial<Backup>;
  if (candidate.app !== 'norstream' || typeof candidate.version !== 'number') {
    throw new Error('Filen er ikke en sikkerhedskopi fra NorStream.');
  }
  if (candidate.version > BACKUP_VERSION) {
    throw new Error('Sikkerhedskopien er fra en nyere udgave af appen.');
  }
  return {
    app: 'norstream',
    version: candidate.version,
    exportedMs: typeof candidate.exportedMs === 'number' ? candidate.exportedMs : 0,
    sources: Array.isArray(candidate.sources) ? candidate.sources : [],
    favorites: Array.isArray(candidate.favorites) ? candidate.favorites : [],
    favoriteExclusions: Array.isArray(candidate.favoriteExclusions) ? candidate.favoriteExclusions : [],
    logoOverrides: Array.isArray(candidate.logoOverrides) ? candidate.logoOverrides : [],
    hiddenCountries: Array.isArray(candidate.hiddenCountries) ? candidate.hiddenCountries : [],
    settings:
      typeof candidate.settings === 'object' && candidate.settings !== null ? candidate.settings : {},
    watchlist: Array.isArray(candidate.watchlist) ? candidate.watchlist : [],
    progress: Array.isArray(candidate.progress) ? candidate.progress : [],
  };
}

export interface RestoreResult {
  favorites: number;
  logoOverrides: number;
  hiddenCountries: number;
  settings: number;
  watchlist: number;
  progress: number;
  /** Kilder i kopien der ikke findes paa denne installation. Deres ting blev sprunget over. */
  missingSources: string[];
  /** Noeglerne for de logoer brugeren selv har valgt, saa filerne kan hentes om. */
  overrideKeys: string[];
}

/**
 * Laegger kopien ind. Favoritter, fravalg, egne logoer og skjulte lande
 * **erstattes** — en gendannelse skal give det kopien viser, ikke en
 * blanding. "Min liste" og fremdrift laegges oveni; der er intet at miste.
 */
export async function restoreBackup(db: SqlDatabase, backup: Backup): Promise<RestoreResult> {
  const current = await db.getAllAsync<{ id: string; url: string; username: string | null }>(
    'SELECT id, url, username FROM sources',
  );
  const idMap = new Map<string, string>();
  const missingSources: string[] = [];
  for (const old of backup.sources) {
    const match = current.find(
      (source) => sameUrl(source.url, old.url) && (source.username ?? '') === (old.username ?? ''),
    );
    if (match === undefined) missingSources.push(old.name);
    else idMap.set(old.id, match.id);
  }
  // En kopi fra den samme installation: id'erne er de samme, og kilder der
  // ikke stod i kopien (eller staar der uden match) beholder deres egne.
  for (const source of current) if (!idMap.has(source.id)) idMap.set(source.id, source.id);

  const remap = (key: string): string | null => {
    const separator = key.indexOf(':');
    if (separator === -1) return null;
    const target = idMap.get(key.slice(0, separator));
    return target === undefined ? null : `${target}${key.slice(separator)}`;
  };

  const result: RestoreResult = {
    favorites: 0,
    logoOverrides: 0,
    hiddenCountries: 0,
    settings: 0,
    watchlist: 0,
    progress: 0,
    missingSources,
    overrideKeys: [],
  };

  await db.runAsync('DELETE FROM favorites');
  await db.runAsync('DELETE FROM favorite_exclusions');
  let position = 0;
  for (const favorite of backup.favorites) {
    const channelId = remap(favorite.channelId);
    if (channelId === null) continue;
    const categoryId =
      favorite.sourceCategoryId === null ? null : remap(favorite.sourceCategoryId);
    await db.runAsync(
      'INSERT OR REPLACE INTO favorites (channel_id, source_category_id, position) VALUES (?, ?, ?)',
      [channelId, categoryId, position],
    );
    position += 1;
    result.favorites += 1;
  }
  for (const exclusion of backup.favoriteExclusions) {
    const channelId = remap(exclusion.channelId);
    const categoryId = remap(exclusion.categoryId);
    if (channelId === null || categoryId === null) continue;
    await db.runAsync(
      'INSERT OR REPLACE INTO favorite_exclusions (channel_id, category_id) VALUES (?, ?)',
      [channelId, categoryId],
    );
  }

  await db.runAsync('DELETE FROM logo_overrides');
  for (const override of backup.logoOverrides) {
    const channelKey = remap(override.channelKey);
    if (channelKey === null || typeof override.url !== 'string') continue;
    await db.runAsync('INSERT OR REPLACE INTO logo_overrides (channel_key, url) VALUES (?, ?)', [
      channelKey,
      override.url,
    ]);
    result.overrideKeys.push(channelKey);
    result.logoOverrides += 1;
  }

  await db.runAsync('DELETE FROM hidden_countries');
  for (const name of backup.hiddenCountries) {
    if (typeof name !== 'string') continue;
    await db.runAsync('INSERT OR IGNORE INTO hidden_countries (name) VALUES (?)', [name]);
    result.hiddenCountries += 1;
  }

  for (const [key, value] of Object.entries(backup.settings)) {
    if (typeof value !== 'string') continue;
    let target: string | null = key;
    const scoped = SCOPED_SETTING_PREFIXES.find((prefix) => key.startsWith(prefix));
    if (scoped !== undefined) {
      const mapped = idMap.get(key.slice(scoped.length));
      target = mapped === undefined ? null : `${scoped}${mapped}`;
    } else if (!SETTING_KEYS.includes(key)) {
      target = null;
    }
    if (target === null) continue;
    await db.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [target, value],
    );
    result.settings += 1;
  }

  for (const entry of backup.watchlist) {
    const itemKey = remap(entry.itemKey);
    if (itemKey === null) continue;
    await db.runAsync('INSERT OR REPLACE INTO vod_watchlist (item_key, added_ms) VALUES (?, ?)', [
      itemKey,
      typeof entry.addedMs === 'number' ? entry.addedMs : Date.now(),
    ]);
    result.watchlist += 1;
  }
  for (const entry of backup.progress) {
    const itemKey = remap(entry.itemKey);
    if (itemKey === null || typeof entry.positionS !== 'number') continue;
    await db.runAsync(
      `INSERT OR REPLACE INTO vod_progress (item_key, position_s, duration_s, updated_ms)
       VALUES (?, ?, ?, ?)`,
      [
        itemKey,
        entry.positionS,
        typeof entry.durationS === 'number' ? entry.durationS : null,
        typeof entry.updatedMs === 'number' ? entry.updatedMs : Date.now(),
      ],
    );
    result.progress += 1;
  }

  return result;
}

function sameUrl(a: string, b: string): boolean {
  const norm = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}
