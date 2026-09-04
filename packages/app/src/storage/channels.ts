import type { Category, Channel } from '@uhf-play/core';
import type { SqlDatabase } from './types.js';

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
  is_favorite: number;
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
 * UPSERT frem for slet-og-indsaet, fordi is_favorite er brugerens egne data
 * og ikke maa gaa tabt naar kanallisten synkroniseres igen.
 */
export async function replaceChannels(
  db: SqlDatabase,
  channels: Channel[],
): Promise<void> {
  if (channels.length === 0) {
    await db.runAsync('DELETE FROM channels');
    return;
  }

  let order = 0;
  for (const channel of channels) {
    await db.runAsync(
      `INSERT INTO channels
         (id, name, number, logo_url, category_id, epg_channel_id,
          has_archive, archive_days, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name           = excluded.name,
         number         = excluded.number,
         logo_url       = excluded.logo_url,
         category_id    = excluded.category_id,
         epg_channel_id = excluded.epg_channel_id,
         has_archive    = excluded.has_archive,
         archive_days   = excluded.archive_days,
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

  const placeholders = channels.map(() => '?').join(',');
  await db.runAsync(
    `DELETE FROM channels WHERE id NOT IN (${placeholders})`,
    channels.map((c) => c.id),
  );
}

export async function listChannels(
  db: SqlDatabase,
  opts: { categoryId?: string; search?: string; favouritesOnly?: boolean } = {},
): Promise<StoredChannel[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.categoryId !== undefined) {
    where.push('category_id = ?');
    params.push(opts.categoryId);
  }

  const search = opts.search?.trim() ?? '';
  if (search.length > 0) {
    // ESCAPE er noedvendigt: uden det ville en soegning paa % matche alt.
    where.push("name LIKE ? ESCAPE '\\'");
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  if (opts.favouritesOnly === true) {
    where.push('is_favorite = 1');
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.getAllAsync<ChannelRow>(
    `SELECT * FROM channels ${clause} ORDER BY sort_order`,
    params,
  );
  return rows.map(toStoredChannel);
}

export async function getChannel(
  db: SqlDatabase,
  id: string,
): Promise<StoredChannel | null> {
  const row = await db.getFirstAsync<ChannelRow>(
    'SELECT * FROM channels WHERE id = ?',
    [id],
  );
  return row ? toStoredChannel(row) : null;
}

export async function setFavorite(
  db: SqlDatabase,
  id: string,
  favorite: boolean,
): Promise<void> {
  await db.runAsync('UPDATE channels SET is_favorite = ? WHERE id = ?', [
    favorite ? 1 : 0,
    id,
  ]);
}
