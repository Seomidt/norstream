import type { Category, Channel } from '@norstream/core';
import type { SqlDatabase, SqlValue } from './types.js';

export interface StoredChannel extends Channel {
  isFavorite: boolean;
}

interface ChannelRow {
  id: string;
  name: string;
  number: number | null;
  logo_url: string | null;
  category_id: string | null;
  epg_channel_id: string | null;
  has_archive: number;
  archive_days: number;
  is_favorite: number | null;
}

function toStoredChannel(row: ChannelRow): StoredChannel {
  return {
    id: row.id,
    name: row.name,
    number: row.number,
    logoUrl: row.logo_url,
    categoryId: row.category_id,
    epgChannelId: row.epg_channel_id,
    hasArchive: row.has_archive === 1,
    archiveDays: row.archive_days,
    isFavorite: row.is_favorite === 1,
  };
}

export async function replaceCategories(
  db: SqlDatabase,
  categories: Category[],
): Promise<void> {
  await db.runAsync('DELETE FROM categories');
  for (const category of categories) {
    await db.runAsync('INSERT INTO categories (id, name) VALUES (?, ?)', [
      category.id,
      category.name,
    ]);
  }
}

export async function listCategories(db: SqlDatabase): Promise<Category[]> {
  return db.getAllAsync<Category>('SELECT id, name FROM categories ORDER BY name');
}

/**
 * Skriver panelets kanaler ind og fjerner dem panelet ikke laengere har.
 * Bruger stale-marking i stedet for NOT IN, fordi panel-lister kan have 10.000+ kanaler
 * og SQLite_MAX_VARIABLE_NUMBER er 999 paa mange builds.
 * Favoritter gemmes i en separat tabel og gaar ikke tabt naar listen synkroniseres.
 */
export async function replaceChannels(
  db: SqlDatabase,
  channels: Channel[],
): Promise<void> {
  // Trin 1: Mark alle kanaler som stale
  await db.runAsync('UPDATE channels SET is_stale = 1');

  // Trin 2: Upsert hver kanal fra panelet, marker som ikke-stale
  let order = 0;
  for (const channel of channels) {
    await db.runAsync(
      `INSERT INTO channels
         (id, name, number, logo_url, category_id, epg_channel_id,
          has_archive, archive_days, is_stale, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         name           = excluded.name,
         number         = excluded.number,
         logo_url       = excluded.logo_url,
         category_id    = excluded.category_id,
         epg_channel_id = excluded.epg_channel_id,
         has_archive    = excluded.has_archive,
         archive_days   = excluded.archive_days,
         is_stale       = 0,
         sort_order     = excluded.sort_order`,
      [
        channel.id,
        channel.name,
        channel.number,
        channel.logoUrl,
        channel.categoryId,
        channel.epgChannelId,
        channel.hasArchive ? 1 : 0,
        channel.archiveDays,
        order++,
      ],
    );
  }

  // Trin 3: Slet kanaler der stadig er marked som stale (fandtes ikke i det nye panel)
  await db.runAsync('DELETE FROM channels WHERE is_stale = 1');
}

export async function listChannels(
  db: SqlDatabase,
  opts: { categoryId?: string; search?: string; favouritesOnly?: boolean } = {},
): Promise<StoredChannel[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];

  if (opts.categoryId !== undefined) {
    where.push('c.category_id = ?');
    params.push(opts.categoryId);
  }

  const search = opts.search?.trim() ?? '';
  if (search.length > 0) {
    // ESCAPE er noedvendigt: uden det ville en soegning paa % matche alt.
    where.push("c.name LIKE ? ESCAPE '\\'");
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  if (opts.favouritesOnly === true) {
    where.push('f.channel_id IS NOT NULL');
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.getAllAsync<ChannelRow>(
    `SELECT c.id, c.name, c.number, c.logo_url, c.category_id, c.epg_channel_id,
            c.has_archive, c.archive_days, c.sort_order,
            CASE WHEN f.channel_id IS NOT NULL THEN 1 ELSE NULL END AS is_favorite
     FROM channels c
     LEFT JOIN favorites f ON f.channel_id = c.id
     ${clause}
     ORDER BY c.sort_order`,
    params,
  );
  return rows.map(toStoredChannel);
}

export async function getChannel(
  db: SqlDatabase,
  id: string,
): Promise<StoredChannel | null> {
  const row = await db.getFirstAsync<ChannelRow>(
    `SELECT c.id, c.name, c.number, c.logo_url, c.category_id, c.epg_channel_id,
            c.has_archive, c.archive_days, c.sort_order,
            CASE WHEN f.channel_id IS NOT NULL THEN 1 ELSE NULL END AS is_favorite
     FROM channels c
     LEFT JOIN favorites f ON f.channel_id = c.id
     WHERE c.id = ?`,
    [id],
  );
  return row ? toStoredChannel(row) : null;
}

export async function setFavorite(
  db: SqlDatabase,
  id: string,
  favorite: boolean,
): Promise<void> {
  if (favorite) {
    await db.runAsync('INSERT OR IGNORE INTO favorites (channel_id) VALUES (?)', [id]);
  } else {
    await db.runAsync('DELETE FROM favorites WHERE channel_id = ?', [id]);
  }
}
