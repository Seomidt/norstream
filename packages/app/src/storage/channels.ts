import {
  channelKey,
  deriveCountryLoose,
  logoCandidates,
  normaliseChannelName,
  originOf,
} from '@norstream/core';
import type { Category, Channel } from '@norstream/core';
import { deadLogoOrigins } from './logoHosts.js';
import { withTransaction } from './transaction.js';
import type { SqlDatabase, SqlValue } from './types.js';

export interface StoredChannel extends Channel {
  isFavorite: boolean;
  /** Kilden kanalen kom fra. */
  sourceId: string;
  /** Kanalens id hos kilden. `id` er den sammensatte noegle. */
  streamId: string;
  /** Kun M3U: den faerdige adresse. Xtream-kanaler bygger deres selv. */
  streamUrl: string | null;
  /**
   * Adresser at proeve for kanalens logo, i raekkefoelge.
   *
   * Mere end én fordi paneler tit oplyser logoer paa en anden vaert end deres
   * egen, og den vaert kan vaere uden for raekkevidde fra den forbindelse
   * telefonen sidder paa.
   */
  logoUrls: string[];
}

interface ChannelRow {
  id: string;
  source_id: string;
  source_url: string | null;
  override_logo_url: string | null;
  registry_logo_url: string | null;
  stream_id: string;
  stream_url: string | null;
  name: string;
  number: number | null;
  logo_url: string | null;
  category_id: string | null;
  epg_channel_id: string | null;
  has_archive: number;
  archive_days: number;
  is_favorite: number | null;
}

/**
 * Adresserne at proeve for kanalens logo, i den raekkefoelge de skal proeves.
 *
 * Vaerter der er maalt uden for raekkevidde tages **ud**. `Image` falder selv
 * tilbage naar en adresse fejler, men en vaert uden rute fejler ikke — den
 * svarer bare aldrig, og forsoeget staar og venter til det bliver afbrudt.
 * Saa laenge den staar foerst, naar de oevrige adresser aldrig at blive
 * proevet, og kanalen staar med en tom firkant selv om der ligger et brugbart
 * logo laengere nede i raekken. Brugerens panel oplyser netop saadan en vaert.
 */
function logoUrlsFor(row: ChannelRow, deadOrigins: ReadonlySet<string>): string[] {
  const candidates = [
    // Brugerens eget valg foerst. Det er det eneste led i raekken der ikke
    // er et gaet, og det maa intet andet kunne overtrumfe.
    ...(row.override_logo_url === null || row.override_logo_url === undefined
      ? []
      : [row.override_logo_url]),
    ...logoCandidates(row.logo_url, row.source_url ?? ''),
    // Registrets logo staar sidst: udbyderens eget forsoeges foerst, ogsaa
    // paa panelets egen vaert, og faerdigt register-logo er sidste udvej.
    ...(row.registry_logo_url === null || row.registry_logo_url === undefined
      ? []
      : [row.registry_logo_url]),
  ];
  if (deadOrigins.size === 0) return candidates;
  return candidates.filter((url) => {
    const origin = originOf(url);
    return origin === null || !deadOrigins.has(origin);
  });
}

function toStoredChannel(row: ChannelRow, deadOrigins: ReadonlySet<string>): StoredChannel {
  return {
    id: row.id,
    sourceId: row.source_id,
    streamId: row.stream_id,
    streamUrl: row.stream_url,
    logoUrls: logoUrlsFor(row, deadOrigins),
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

/**
 * Erstatter **denne kildes** kategorier. De andres bliver staaende.
 *
 * Kategori-id'et er sammensat af kilde og kategoriens eget id, af samme grund
 * som kanalernes: to paneler har begge en kategori 1.
 */
export async function replaceCategories(
  db: SqlDatabase,
  sourceId: string,
  categories: Category[],
): Promise<void> {
  await withTransaction(db, async () => {
    await db.runAsync('DELETE FROM categories WHERE source_id = ?', [sourceId]);
    for (const category of categories) {
      await db.runAsync('INSERT INTO categories (id, source_id, name) VALUES (?, ?, ?)', [
        channelKey(sourceId, category.id),
        sourceId,
        category.name,
      ]);
    }
  });
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
  sourceId: string,
  channels: Channel[],
  /** Kun M3U: kanalens faerdige adresse, slaaet op paa kanalens eget id. */
  streamUrls?: ReadonlyMap<string, string>,
  /** Landet for hver kategori, saa kanalen kan slaas op i logo-registret. */
  countryByCategory?: ReadonlyMap<string, string>,
): Promise<void> {
  // Én transaktion om det hele: 22.000 raekker som én skrivning, og et
  // afbrudt sync efterlader den gamle liste hel.
  await withTransaction(db, async () => {
  // Trin 1: Mark denne kildes kanaler som stale. De andre kilders roeres ikke.
  await db.runAsync('UPDATE channels SET is_stale = 1 WHERE source_id = ?', [sourceId]);

  // Trin 2: Upsert hver kanal fra kilden, marker som ikke-stale
  const base = await nextSortOrderFor(db, sourceId);
  let order = 0;
  for (const channel of channels) {
    await db.runAsync(
      `INSERT INTO channels
         (id, source_id, stream_id, stream_url, match_key, country, name, number,
          logo_url, category_id, epg_channel_id, has_archive, archive_days,
          is_stale, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         stream_url     = excluded.stream_url,
         match_key      = excluded.match_key,
         country        = excluded.country,
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
        channelKey(sourceId, channel.id),
        sourceId,
        channel.id,
        streamUrls?.get(channel.id) ?? null,
        normaliseChannelName(channel.name),
        // Kanalens eget praefiks foerst — `DNK| DR1 HD` siger landet selv —
        // og kategoriens land som anden udvej. Kategorier som `SPORT 1080P`
        // blander lande, og der er kanalens eget navn det eneste der ved det.
        // Uden landet slaas logoet kun op paa navne der er entydige i hele
        // verden, og det er de faerreste.
        deriveCountryLoose(channel.name)?.code ??
          (channel.categoryId === null
            ? undefined
            : countryByCategory?.get(channel.categoryId)) ??
          '',
        channel.name,
        channel.number,
        channel.logoUrl,
        channel.categoryId === null ? null : channelKey(sourceId, channel.categoryId),
        channel.epgChannelId,
        channel.hasArchive ? 1 : 0,
        channel.archiveDays,
        base + order++,
      ],
    );
  }

  // Trin 3: Slet denne kildes kanaler der stadig er stale — de fandtes ikke i
  // den nye liste. En anden kildes kanaler maa ikke ryge med.
  await db.runAsync('DELETE FROM channels WHERE is_stale = 1 AND source_id = ?', [sourceId]);
  });
}

/**
 * Hvor denne kildes kanaler skal begynde i den samlede raekkefoelge.
 *
 * Kilderne staar efter hinanden frem for blandet imellem hinanden: rakte de
 * ind over hinanden, ville en synkronisering af den ene flytte rundt paa den
 * andens kanaler midt i listen.
 */
async function nextSortOrderFor(db: SqlDatabase, sourceId: string): Promise<number> {
  const row = await db.getFirstAsync<{ base: number | null }>(
    'SELECT MIN(sort_order) AS base FROM channels WHERE source_id = ?',
    [sourceId],
  );
  if (row?.base !== null && row?.base !== undefined) return row.base;
  const max = await db.getFirstAsync<{ next: number | null }>(
    'SELECT MAX(sort_order) + 1 AS next FROM channels',
  );
  return max?.next ?? 0;
}

export async function listChannels(
  db: SqlDatabase,
  opts: {
    categoryId?: string;
    search?: string;
    favouritesOnly?: boolean;
    /** Kun favoritter i denne gruppe (se favoriteGroups.ts). Kraever favouritesOnly. */
    groupId?: string | null;
    /** Kun radio: kanaler hvis navn eller kategori siger radio, typisk "(RADIO)". */
    radioOnly?: boolean;
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
    if (opts.groupId !== undefined && opts.groupId !== null) {
      where.push('c.id IN (SELECT channel_id FROM favorite_group_members WHERE group_id = ?)');
      params.push(opts.groupId);
    }
  }
  if (opts.radioOnly === true) {
    where.push("(c.name LIKE '%radio%' OR cat.name LIKE '%radio%')");
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  let limitClause = '';
  if (opts.limit !== undefined) {
    limitClause = 'LIMIT ?';
    params.push(Math.max(1, Math.trunc(opts.limit)));
  }

  const rows = await db.getAllAsync<ChannelRow>(
    `SELECT c.id, c.source_id, c.stream_id, c.stream_url, c.name, c.number, c.logo_url,
            c.category_id, c.epg_channel_id, c.has_archive, c.archive_days, c.sort_order,
            s.url AS source_url,
            lo.url AS override_logo_url,
            COALESCE(xl.url, ri.url, rc.url, ra.url) AS registry_logo_url,
            CASE WHEN f.channel_id IS NOT NULL THEN 1 ELSE NULL END AS is_favorite
     FROM channels c
     LEFT JOIN favorites f ON f.channel_id = c.id
     LEFT JOIN sources s ON s.id = c.source_id
     LEFT JOIN categories cat ON cat.id = c.category_id
     LEFT JOIN logo_overrides lo ON lo.channel_key = c.id
     -- Udbyderens egen XMLTV-fil foerst: det er dens logo, for dens kanal.
     LEFT JOIN xmltv_logos xl ON xl.channel_key = c.id
     -- Saa id'et: registrets id er XMLTV-id'et, det samme som en M3U-listes
     -- tvg-id og et panels epg_channel_id. Et opslag, ikke et gaet.
     LEFT JOIN registry_logos ri ON ri.key = 'id:' || LOWER(TRIM(c.epg_channel_id))
     LEFT JOIN registry_logos rc ON rc.key = c.match_key || ':' || c.country
     LEFT JOIN registry_logos ra ON ra.key = c.match_key || ':*'
     ${clause}
     ORDER BY ${opts.favouritesOnly === true ? 'f.position IS NULL, f.position, ' : ''}c.sort_order
     ${limitClause}`,
    params,
  );
  const dead = await deadLogoOrigins(db);
  return rows.map((row) => toStoredChannel(row, dead));
}

/**
 * Selve opslaget bag getChannel/getChannelsByIds: samme kolonner og joins,
 * kun WHERE skifter. Ét sted, saa de to ikke kan komme til at drive fra
 * hinanden.
 */
const CHANNEL_SELECT = `SELECT c.id, c.source_id, c.stream_id, c.stream_url, c.name, c.number, c.logo_url,
            c.category_id, c.epg_channel_id, c.has_archive, c.archive_days, c.sort_order,
            s.url AS source_url,
            lo.url AS override_logo_url,
            COALESCE(xl.url, ri.url, rc.url, ra.url) AS registry_logo_url,
            CASE WHEN f.channel_id IS NOT NULL THEN 1 ELSE NULL END AS is_favorite
     FROM channels c
     LEFT JOIN favorites f ON f.channel_id = c.id
     LEFT JOIN sources s ON s.id = c.source_id
     LEFT JOIN categories cat ON cat.id = c.category_id
     LEFT JOIN logo_overrides lo ON lo.channel_key = c.id
     -- Udbyderens egen XMLTV-fil foerst: det er dens logo, for dens kanal.
     LEFT JOIN xmltv_logos xl ON xl.channel_key = c.id
     -- Saa id'et: registrets id er XMLTV-id'et, det samme som en M3U-listes
     -- tvg-id og et panels epg_channel_id. Et opslag, ikke et gaet.
     LEFT JOIN registry_logos ri ON ri.key = 'id:' || LOWER(TRIM(c.epg_channel_id))
     LEFT JOIN registry_logos rc ON rc.key = c.match_key || ':' || c.country
     LEFT JOIN registry_logos ra ON ra.key = c.match_key || ':*'`;

export async function getChannel(
  db: SqlDatabase,
  id: string,
): Promise<StoredChannel | null> {
  const row = await db.getFirstAsync<ChannelRow>(`${CHANNEL_SELECT}\n     WHERE c.id = ?`, [id]);
  if (row === null || row === undefined) return null;
  return toStoredChannel(row, await deadLogoOrigins(db));
}

/**
 * Slaar flere kanaler op i ét opslag, med doede logo-vaerter regnet ud én gang.
 *
 * Forsidens "Sidst sete" og "Fortsaet" slog foer hver kanal op for sig med den
 * fulde seks-join-forespoergsel OG regnede doede logo-vaerter ud per kald —
 * femten-tyve tunge opslag serielt ved hver hjemaabning. Nu er det ét opslag
 * (delt i klumper under SQLites variabel-loft) plus én doede-udregning.
 * Resultatet er en opslagstabel, saa kalderen selv kan holde sin raekkefoelge.
 */
export async function getChannelsByIds(
  db: SqlDatabase,
  ids: readonly string[],
): Promise<Map<string, StoredChannel>> {
  const found = new Map<string, StoredChannel>();
  if (ids.length === 0) return found;
  const dead = await deadLogoOrigins(db);
  const unique = [...new Set(ids)];
  const CHUNK = 400;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '?').join(', ');
    const rows = await db.getAllAsync<ChannelRow>(
      `${CHANNEL_SELECT}\n     WHERE c.id IN (${placeholders})`,
      slice,
    );
    for (const row of rows) found.set(row.id, toStoredChannel(row, dead));
  }
  return found;
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
    // Nederst i listen. Raekkefoelgen er brugerens egen, og en ny favorit
    // skal ikke dukke op midt i den.
    await db.runAsync(
      `INSERT OR IGNORE INTO favorites (channel_id, source_category_id, position)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM favorites))`,
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
 * Hvor mange af panelets kanaler der er radio.
 *
 * Xtream skiller ikke radio ud som en egen slags i listen appen henter;
 * det er kategorien eller navnet der siger det. Tallet findes fordi
 * brugeren spurgte om filen indeholder radio, og det kan kun maales paa
 * telefonen — panelet laaser linjen til dens adresse.
 */
export async function countRadioChannels(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n
     FROM channels c
     LEFT JOIN categories cat ON cat.id = c.category_id
     WHERE cat.name LIKE '%radio%' OR c.name LIKE '%radio%'`,
  );
  return row?.n ?? 0;
}
