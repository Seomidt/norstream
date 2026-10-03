import { isValidSourceId } from '@norstream/core';
import type { Source, SourceKind } from '@norstream/core';
import { invalidateQueryCache } from './queryCache.js';
import type { SqlDatabase } from './types.js';
import { deleteVodForSource } from './vod.js';

interface SourceRow {
  id: string;
  kind: string;
  name: string;
  url: string;
  username: string | null;
  xmltv_url: string | null;
  enabled: number;
  sort_order: number;
}

function toSource(row: SourceRow): Source {
  return {
    id: row.id,
    // En ukendt art kan kun komme af en nyere udgave af appen. Xtream er det
    // sikre gaet: den fejler synligt ved foerste kald frem for at faa en
    // M3U-liste til at se ud som om den ikke har kanaler.
    kind: row.kind === 'm3u' ? 'm3u' : 'xtream',
    name: row.name,
    url: row.url,
    username: row.username,
    xmltvUrl: row.xmltv_url,
    enabled: row.enabled !== 0,
    sortOrder: row.sort_order,
  };
}

/**
 * Laver et id der ikke kan kollidere med et eksisterende, og som aldrig
 * indeholder skilletegnet fra `channelKey`.
 *
 * Tidsstempel plus et tilfaeldigt haleled: to kilder tilfoejet i samme
 * millisekund er ikke utaenkeligt naar de kommer fra en importeret liste.
 */
export function newSourceId(now: Date = new Date()): string {
  const random = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, '0');
  return `s${now.getTime().toString(36)}${random}`;
}

export interface NewSource {
  kind: SourceKind;
  name: string;
  url: string;
  username?: string | null;
  xmltvUrl?: string | null;
}

export async function addSource(
  db: SqlDatabase,
  source: NewSource,
  now: Date = new Date(),
): Promise<Source> {
  let id = newSourceId(now);
  // Skulle generatoren mod forventning give noget ubrugeligt, er en kilde med
  // et id der braekker alle kanalnoegler vaerre end ingen kilde.
  if (!isValidSourceId(id)) id = `s${now.getTime()}`;

  const order = await nextSortOrder(db);
  await db.runAsync(
    `INSERT INTO sources (id, kind, name, url, username, xmltv_url, enabled, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      source.kind,
      source.name,
      source.url,
      source.username ?? null,
      source.xmltvUrl ?? null,
      order,
      now.getTime(),
    ],
  );

  return {
    id,
    kind: source.kind,
    name: source.name,
    url: source.url,
    username: source.username ?? null,
    xmltvUrl: source.xmltvUrl ?? null,
    enabled: true,
    sortOrder: order,
  };
}

async function nextSortOrder(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ next: number | null }>(
    'SELECT MAX(sort_order) + 1 AS next FROM sources',
  );
  return row?.next ?? 0;
}

export async function listSources(db: SqlDatabase): Promise<Source[]> {
  const rows = await db.getAllAsync<SourceRow>(
    'SELECT * FROM sources ORDER BY sort_order, created_at',
  );
  return rows.map(toSource);
}

/** Kun de kilder der skal bruges. En slaaet fra beholder sine kanaler. */
export async function listEnabledSources(db: SqlDatabase): Promise<Source[]> {
  return (await listSources(db)).filter((source) => source.enabled);
}

/**
 * Rydder kanaler, kategorier og film/serier for **fravalgte** kilder.
 *
 * Slaar man en fil fra (fx en testfil), skal dens kanaler forsvinde fra
 * Kanaler ved naeste hentning — ikke blive staaende og rode. Kilden selv bliver
 * i `sources`, saa man kan slaa den til igen; favoritter og programoversigt
 * for dens kanaler er harmloese (de peger bare paa intet) og ryddes ad deres
 * egne veje. Slaar man kilden til igen, hentes kanalerne forfra.
 *
 * Koeres ved hver synkronisering, lige som `deleteOrphanedChannelData`, saa en
 * fravalgt fil ikke kan blive ved med at fylde i listen.
 */
export async function purgeDisabledSourceData(db: SqlDatabase): Promise<void> {
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM sources WHERE enabled = 0',
  );
  if (rows.length === 0) return;
  for (const row of rows) {
    await db.runAsync('DELETE FROM channels WHERE source_id = ?', [row.id]);
    await db.runAsync('DELETE FROM categories WHERE source_id = ?', [row.id]);
    await deleteVodForSource(db, row.id);
  }
  invalidateQueryCache();
}

export async function getSource(db: SqlDatabase, id: string): Promise<Source | null> {
  const row = await db.getFirstAsync<SourceRow>('SELECT * FROM sources WHERE id = ?', [id]);
  return row ? toSource(row) : null;
}

export async function setSourceEnabled(
  db: SqlDatabase,
  id: string,
  enabled: boolean,
): Promise<void> {
  await db.runAsync('UPDATE sources SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

export async function renameSource(db: SqlDatabase, id: string, name: string): Promise<void> {
  await db.runAsync('UPDATE sources SET name = ? WHERE id = ?', [name, id]);
}

/**
 * Retter en kildes adresse, navn, brugernavn og XMLTV — til "Redigér panel",
 * naar man har faaet en anden server. Kilde-**id'et beholdes**, saa favoritter,
 * grupper og egne logoer bliver haengende paa panelet; kun det man har rettet
 * skiftes. Selve kanalerne hentes forfra bagefter (se sources/connect.editXtream).
 */
export async function updateSourceDetails(
  db: SqlDatabase,
  id: string,
  fields: { name: string; url: string; username?: string | null; xmltvUrl?: string | null },
): Promise<void> {
  await db.runAsync(
    'UPDATE sources SET name = ?, url = ?, username = ?, xmltv_url = ? WHERE id = ?',
    [fields.name, fields.url, fields.username ?? null, fields.xmltvUrl ?? null, id],
  );
}

/**
 * Fjerner kilden og alt der kom fra den.
 *
 * Ogsaa favoritter og optagelser: de peger paa kanaler der ikke laengere
 * findes, og en favorit der ikke kan aabnes er ikke en favorit. Optagelser der
 * allerede ligger som filer paa enheden slettes af kalderen foerst — her
 * fjernes kun raekkerne.
 */
export async function deleteSource(db: SqlDatabase, id: string): Promise<void> {
  const prefix = `${id}:%`;
  await db.runAsync('DELETE FROM favorites WHERE channel_id LIKE ?', [prefix]);
  await db.runAsync('DELETE FROM favorite_exclusions WHERE channel_id LIKE ?', [prefix]);
  await db.runAsync('DELETE FROM recordings WHERE channel_id LIKE ?', [prefix]);
  await db.runAsync('DELETE FROM programmes WHERE channel_id LIKE ?', [prefix]);
  await db.runAsync('DELETE FROM epg_fetch WHERE stream_id LIKE ?', [prefix]);
  await db.runAsync('DELETE FROM epg_archive_fetch WHERE stream_id LIKE ?', [prefix]);
  await db.runAsync('DELETE FROM channels WHERE source_id = ?', [id]);
  await db.runAsync('DELETE FROM categories WHERE source_id = ?', [id]);
  await deleteVodForSource(db, id);
  await db.runAsync('DELETE FROM sources WHERE id = ?', [id]);
}

/**
 * Giver det brugeren har skabt foer kilderne fandtes den noegle de nu skal
 * have.
 *
 * Favoritter og optagelser fra tiden med ét panel staar med panelets eget
 * kanal-id. De skal have kildens id foran for at pege paa noget igen. Kun
 * raekker **uden** skilletegn roeres, saa den kan koeres igen uden skade.
 */
export async function adoptLegacyKeys(db: SqlDatabase, sourceId: string): Promise<void> {
  const tables: [string, string][] = [
    ['favorites', 'channel_id'],
    ['favorite_exclusions', 'channel_id'],
    ['recordings', 'channel_id'],
  ];
  for (const [table, column] of tables) {
    await db.runAsync(
      `UPDATE OR IGNORE ${table} SET ${column} = ? || ':' || ${column}
       WHERE ${column} NOT LIKE '%:%'`,
      [sourceId],
    );
  }

  // Optagelsernes id er kanal + starttidspunkt, og kanaldelen skiftede lige.
  await db.runAsync(
    "UPDATE OR IGNORE recordings SET id = channel_id || ':' || start_ms WHERE id NOT LIKE ? ",
    [`${sourceId}:%`],
  );
}
