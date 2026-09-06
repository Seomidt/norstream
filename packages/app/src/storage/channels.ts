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
  opts: {
    categoryId?: string;
    search?: string;
    favouritesOnly?: boolean;
    /** Oevre graense paa antal raekker. Soegning paa tvaers af 22.142 kanaler skal have en. */
    limit?: number;
  } = {},
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

  let limitClause = '';
  if (opts.limit !== undefined) {
    limitClause = 'LIMIT ?';
    params.push(Math.max(1, Math.trunc(opts.limit)));
  }

  const rows = await db.getAllAsync<ChannelRow>(
    `SELECT c.id, c.name, c.number, c.logo_url, c.category_id, c.epg_channel_id,
            c.has_archive, c.archive_days, c.sort_order,
            CASE WHEN f.channel_id IS NOT NULL THEN 1 ELSE NULL END AS is_favorite
     FROM channels c
     LEFT JOIN favorites f ON f.channel_id = c.id
     ${clause}
     ORDER BY c.sort_order
     ${limitClause}`,
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

/**
 * `sourceCategoryId` husker hvilken kategori favoritten kom fra, saa
 * favoritskaermen kan gruppere i sammenklappelige sektioner. Uden det ville
 * eet tryk paa "Tilfoej alle" for Danmark give 979 kanaler i én flad liste.
 *
 * `INSERT OR IGNORE`: er kanalen allerede favorit, beholder den den kategori
 * den foerst kom fra. Et senere "tilfoej alle" fra en anden kategori maa ikke
 * flytte den under brugerens fingre.
 */
export async function setFavorite(
  db: SqlDatabase,
  id: string,
  favorite: boolean,
  sourceCategoryId: string | null = null,
): Promise<void> {
  if (favorite) {
    await db.runAsync(
      'INSERT OR IGNORE INTO favorites (channel_id, source_category_id) VALUES (?, ?)',
      [id, sourceCategoryId],
    );
    // Brugeren vil have den igen; en tidligere fravalgt kanal skal ikke blive
    // ved med at vaere udelukket fra kategoriens opdatering.
    await db.runAsync('DELETE FROM favorite_exclusions WHERE channel_id = ?', [id]);
    return;
  }

  // Kom favoritten fra en kategori, huskes fravalget. Ellers ville "opdatér"
  // paa kategorien haente kanalen tilbage, og brugerens oprydning i 979
  // danske kanaler skulle laves forfra efter hvert tryk.
  const row = await db.getFirstAsync<{ source_category_id: string | null }>(
    'SELECT source_category_id FROM favorites WHERE channel_id = ?',
    [id],
  );
  if (row?.source_category_id != null) {
    await db.runAsync(
      `INSERT INTO favorite_exclusions (channel_id, category_id) VALUES (?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET category_id = excluded.category_id`,
      [id, row.source_category_id],
    );
  }
  await db.runAsync('DELETE FROM favorites WHERE channel_id = ?', [id]);
}

/**
 * Den laengste arkivperiode blandt kanalerne, i dage. 0 hvis ingen kanal har
 * arkiv.
 *
 * Bruges til at afgoere hvor langt tilbage programdata er *brugbare*: et
 * program der ligger uden for panelets arkiv kan ikke startes, saa der er
 * ingen grund til at gemme det.
 */
export async function maxArchiveDays(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ days: number | null }>(
    'SELECT MAX(archive_days) AS days FROM channels WHERE has_archive = 1',
  );
  const days = row?.days;
  return typeof days === 'number' && Number.isFinite(days) && days > 0 ? days : 0;
}

/**
 * Hvor mange kanaler panelet har givet et logo, og hvor mange der er i alt.
 *
 * Findes fordi "logoerne mangler" kan betyde to helt forskellige ting: at
 * panelet ikke sender `stream_icon`, eller at appen ikke faar dem tegnet. De
 * to ser ens ud paa skaermen og kraever hver sin rettelse, og uden et tal er
 * der ingen maade at se forskel paa dem fra den anden side af en telefon.
 */
export async function logoCoverage(
  db: SqlDatabase,
): Promise<{ withLogo: number; total: number }> {
  const row = await db.getFirstAsync<{ with_logo: number; total: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN logo_url IS NOT NULL AND logo_url <> '' THEN 1 ELSE 0 END) AS with_logo
     FROM channels`,
  );
  return { withLogo: row?.with_logo ?? 0, total: row?.total ?? 0 };
}
