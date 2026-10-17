import { listChannels } from './channels.js';
import type { SqlDatabase } from './types.js';

/**
 * Kopierer en kategoris kanaler ind i favoritterne, nederst i listen og i
 * panelets orden.
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
  const last = await db.getFirstAsync<{ n: number | null }>(
    'SELECT MAX(position) AS n FROM favorites',
  );
  // Numrene fortsaetter efter det sidste. Kanaler der allerede er favoritter
  // springes over af OR IGNORE og efterlader huller i numrene; det er uden
  // betydning, kun ordenen taeller.
  await db.runAsync(
    `INSERT OR IGNORE INTO favorites (channel_id, source_category_id, match_key, country, position)
     SELECT id, ?, match_key, country, ? + ROW_NUMBER() OVER (ORDER BY sort_order)
     FROM channels
     WHERE category_id = ?
       AND id NOT IN (SELECT channel_id FROM favorite_exclusions WHERE category_id = ?)`,
    [categoryId, last?.n ?? -1, categoryId, categoryId],
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

export interface FavoriteCategory {
  id: string;
  name: string;
  channels: number;
}

/**
 * Kategorierne favoritterne kom fra, til "opdatér": henter de kanaler
 * udbyderen har lagt i dem siden sidst. En kategori der er forsvundet fra
 * panelet kan ikke opdateres og staar ikke med.
 */
export async function favoriteCategories(db: SqlDatabase): Promise<FavoriteCategory[]> {
  return db.getAllAsync<FavoriteCategory>(
    `SELECT c.id, c.name, COUNT(*) AS channels
     FROM favorites f
     JOIN categories c ON c.id = f.source_category_id
     GROUP BY c.id, c.name
     ORDER BY c.name`,
  );
}

/**
 * Flytter én favorit til en plads i listen. `toIndex` er pladsen i den
 * raekkefoelge `listChannels` giver favoritterne — den brugeren ser.
 *
 * Alle numre skrives om bagefter. Tres opdateringer er ingenting, og saa er
 * der aldrig to kanaler med samme nummer eller huller der skal regnes med.
 */
/**
 * Flytter en favorit til plads `toIndex` i den liste brugeren ser.
 *
 * `visibleIds` er den liste sorteringen viser (en gruppe, eller alle).
 * Pladsen gaelder dén liste: kanalen laegges lige foer den kanal der staar
 * paa pladsen dér, i den faelles raekkefoelge. Uden det blev en plads i
 * gruppen brugt som plads i hele listen, og kanalen landede et tilfaeldigt
 * sted — typisk oeverst.
 */
export async function moveFavorite(
  db: SqlDatabase,
  channelId: string,
  toIndex: number,
  visibleIds?: readonly string[],
): Promise<void> {
  const ids = (await listChannels(db, { favouritesOnly: true })).map((channel) => channel.id);
  const from = ids.indexOf(channelId);
  if (from === -1) return;
  ids.splice(from, 1);
  const visible = (visibleIds ?? ids).filter((id) => id !== channelId && ids.includes(id));
  const index = Math.max(0, Math.min(visible.length, Math.trunc(toIndex)));
  let target: number;
  if (index < visible.length) {
    // Lige foer den kanal der staar paa pladsen i den viste liste.
    target = ids.indexOf(visible[index]!);
  } else {
    // Efter den sidste viste kanal, eller sidst i det hele.
    const last = visible[visible.length - 1];
    target = last === undefined ? ids.length : ids.indexOf(last) + 1;
  }
  ids.splice(target, 0, channelId);
  await writeOrder(db, ids);
}

async function writeOrder(db: SqlDatabase, ids: readonly string[]): Promise<void> {
  for (let index = 0; index < ids.length; index += 1) {
    await db.runAsync('UPDATE favorites SET position = ? WHERE channel_id = ?', [index, ids[index]!]);
  }
}
