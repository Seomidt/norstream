import { deriveCountry } from '@norstream/core';
import type { SqlDatabase } from './types.js';

/**
 * Noeglen for kategorier hvis navn ikke rummer et genkendeligt land —
 * `4K UHD 3840P`, `RELAX 1920P`. De forsvinder ikke; de grupperes bare ikke.
 */
export const OTHER_COUNTRY_KEY = '__other__';
const OTHER_COUNTRY_NAME = 'Øvrige';

export interface CategorySummary {
  id: string;
  name: string;
  channelCount: number;
  /** ISO-koden for landet, eller `OTHER_COUNTRY_KEY`. */
  countryKey: string;
}

export interface CountryGroup {
  key: string;
  name: string;
  /** Tom streng for **Øvrige**, som ikke har et flag. */
  flag: string;
  categoryCount: number;
  channelCount: number;
}

interface CategoryRow {
  id: string;
  name: string;
  channel_count: number;
}

/**
 * Alle kategorier med deres kanalantal og udledte land, hentet i **ét** opslag.
 * Panelet har 285 kategorier; en forespoergsel per kategori ville vaere 285
 * rundture for at tegne én skaerm.
 *
 * Kanaler hvis `category_id` ikke peger paa en kendt kategori taelles ikke med.
 * De er ikke naabare via browse, men findes stadig via soegning — samme
 * garanti som spec'en giver for skjulte lande.
 */
export async function listCategorySummaries(db: SqlDatabase): Promise<CategorySummary[]> {
  const rows = await db.getAllAsync<CategoryRow>(
    `SELECT c.id, c.name, COUNT(ch.id) AS channel_count
     FROM categories c
     LEFT JOIN channels ch ON ch.category_id = c.id
     GROUP BY c.id, c.name
     ORDER BY c.name`,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    channelCount: row.channel_count,
    countryKey: deriveCountry(row.name)?.code ?? OTHER_COUNTRY_KEY,
  }));
}

export async function listHiddenCountries(db: SqlDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    'SELECT name FROM hidden_countries ORDER BY name',
  );
  return rows.map((row) => row.name);
}

export async function hideCountry(db: SqlDatabase, key: string): Promise<void> {
  await db.runAsync('INSERT OR IGNORE INTO hidden_countries (name) VALUES (?)', [key]);
}

export async function unhideCountry(db: SqlDatabase, key: string): Promise<void> {
  await db.runAsync('DELETE FROM hidden_countries WHERE name = ?', [key]);
}

/**
 * Landene brugeren kan browse i, med flag og antal.
 *
 * Skjulte lande udelades her, men deres kanaler bliver liggende i databasen og
 * kan stadig findes via soegning — spec sec.5.
 *
 * **Øvrige** sorteres altid nederst; resten sorteres efter dansk navn, saa
 * listen laeses som en dansk liste og ikke som panelets engelske.
 */
export async function listCountryGroups(db: SqlDatabase): Promise<CountryGroup[]> {
  const [summaries, hidden] = await Promise.all([
    listCategorySummaries(db),
    listHiddenCountries(db),
  ]);
  const hiddenSet = new Set(hidden);

  const groups = new Map<string, CountryGroup>();
  for (const summary of summaries) {
    if (hiddenSet.has(summary.countryKey)) continue;

    let group = groups.get(summary.countryKey);
    if (group === undefined) {
      const country = deriveCountry(summary.name);
      group = {
        key: summary.countryKey,
        name: country?.name ?? OTHER_COUNTRY_NAME,
        flag: country?.flag ?? '',
        categoryCount: 0,
        channelCount: 0,
      };
      groups.set(summary.countryKey, group);
    }
    group.categoryCount += 1;
    group.channelCount += summary.channelCount;
  }

  return [...groups.values()].sort((a, b) => {
    if (a.key === OTHER_COUNTRY_KEY) return 1;
    if (b.key === OTHER_COUNTRY_KEY) return -1;
    return a.name.localeCompare(b.name, 'da');
  });
}

export async function listCategoriesInCountry(
  db: SqlDatabase,
  countryKey: string,
): Promise<CategorySummary[]> {
  const summaries = await listCategorySummaries(db);
  return summaries.filter((summary) => summary.countryKey === countryKey);
}
