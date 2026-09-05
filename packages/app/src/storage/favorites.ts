import { listChannels } from './channels.js';
import type { StoredChannel } from './channels.js';
import type { SqlDatabase } from './types.js';

export interface FavoriteGroup {
  /** Kategorien favoritterne kom fra, eller null for dem brugeren tilfoejede enkeltvis. */
  categoryId: string | null;
  categoryName: string;
  channels: StoredChannel[];
}

const LOOSE_GROUP_NAME = 'Egne favoritter';

/**
 * Kopierer en kategoris kanaler ind i favoritterne.
 *
 * Spec sec.6: favoritterne er derefter brugerens egne, og enkelte kan fjernes
 * frit. Alternativet — at favorisere selve kategorien og beregne listen
 * loebende — blev fravalgt fordi "fjern denne ene kanal" saa bliver tvetydigt.
 *
 * Det er ogsaa "opdatér": `INSERT OR IGNORE` tilfoejer kun kanaler der ikke
 * allerede er favoritter, saa et gentaget kald henter de kanaler udbyderen har
 * lagt i kategorien siden sidst. Kanaler brugeren selv har fjernet staar i
 * `favorite_exclusions` og kommer ikke tilbage — ellers ville opdater-knappen
 * fortryde hans oprydning hver gang han bruger den.
 *
 * Returnerer antallet der faktisk blev tilfoejet.
 */
export async function addCategoryToFavorites(
  db: SqlDatabase,
  categoryId: string,
): Promise<number> {
  const before = await countFavorites(db);
  await db.runAsync(
    `INSERT OR IGNORE INTO favorites (channel_id, source_category_id)
     SELECT id, ? FROM channels
     WHERE category_id = ?
       AND id NOT IN (SELECT channel_id FROM favorite_exclusions WHERE category_id = ?)`,
    [categoryId, categoryId, categoryId],
  );
  return (await countFavorites(db)) - before;
}

async function countFavorites(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM favorites');
  return row?.n ?? 0;
}

/**
 * Fjerner hele kategoriens bidrag igen, uden at roere brugerens enkeltvise
 * favoritter. Fravalgene nulstilles med: fjerner man hele gruppen og tilfoejer
 * den igen, forventer man den hel, ikke med huller fra sidste gang.
 */
export async function removeCategoryFromFavorites(
  db: SqlDatabase,
  categoryId: string,
): Promise<void> {
  await db.runAsync('DELETE FROM favorites WHERE source_category_id = ?', [categoryId]);
  await db.runAsync('DELETE FROM favorite_exclusions WHERE category_id = ?', [categoryId]);
}

interface GroupRow {
  channel_id: string;
  source_category_id: string | null;
  category_name: string | null;
}

/**
 * Favoritterne grupperet efter den kategori de kom fra.
 *
 * Uden grupperingen ville ét tryk paa "Tilfoej alle" for Danmark give 979
 * kanaler i én flad liste — praecis det problem skaermen findes for at loese.
 *
 * Kanalerne hentes gennem `listChannels`, saa de baerer det samme
 * `StoredChannel`-indhold som resten af appen og sorteres i panelets orden.
 */
export async function listFavoriteGroups(db: SqlDatabase): Promise<FavoriteGroup[]> {
  const [channels, rows] = await Promise.all([
    listChannels(db, { favouritesOnly: true }),
    db.getAllAsync<GroupRow>(
      `SELECT f.channel_id, f.source_category_id, c.name AS category_name
       FROM favorites f
       LEFT JOIN categories c ON c.id = f.source_category_id`,
    ),
  ]);

  const sources = new Map(rows.map((row) => [row.channel_id, row]));
  const groups = new Map<string, FavoriteGroup>();

  for (const channel of channels) {
    const source = sources.get(channel.id);
    // En kategori der er forsvundet fra panelet efterlader sit id uden navn.
    // Favoritterne skal stadig kunne vises, saa de falder i den loese gruppe.
    const categoryId =
      source?.source_category_id != null && source.category_name != null
        ? source.source_category_id
        : null;
    const key = categoryId ?? '';

    let group = groups.get(key);
    if (group === undefined) {
      group = {
        categoryId,
        categoryName: categoryId === null ? LOOSE_GROUP_NAME : (source?.category_name ?? ''),
        channels: [],
      };
      groups.set(key, group);
    }
    group.channels.push(channel);
  }

  // De loese favoritter oeverst — det er dem brugeren har valgt én ad gangen —
  // og kategorierne derefter i alfabetisk orden.
  return [...groups.values()].sort((a, b) => {
    if (a.categoryId === null) return -1;
    if (b.categoryId === null) return 1;
    return a.categoryName.localeCompare(b.categoryName, 'da');
  });
}
