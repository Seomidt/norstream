import { deriveCountryLoose } from '@norstream/core';
import type { Country } from '@norstream/core';
import { cachedQuery } from './queryCache.js';
import type { SqlDatabase } from './types.js';

/**
 * Noeglen for kategorier hvis navn ikke rummer et genkendeligt land —
 * `4K UHD 3840P`, `RELAX 1920P`. De forsvinder ikke; de grupperes bare ikke.
 */
export const OTHER_COUNTRY_KEY = '__other__';
const OTHER_COUNTRY_NAME = 'Øvrige';

/**
 * Kloden staar hvor et flag ikke kan staa.
 *
 * Uden den var **Øvrige** den eneste raekke i listen uden ikon, og raekken
 * rykkede ind i forhold til alle andre. Et tegn der betyder "ikke et bestemt
 * land" er baade aerligere og pænere end en tom plads.
 */
export const OTHER_COUNTRY_FLAG = '🌐';

export interface CategorySummary {
  id: string;
  name: string;
  channelCount: number;
  /** Kilden (fil/panel) kategorien hoerer til. */
  sourceId: string;
  /** ISO-koden for landet, eller `OTHER_COUNTRY_KEY`. */
  countryKey: string;
  /** Landet med navn og flag, eller null naar det ikke kunne udledes. */
  country: Country | null;
}

/** Én kildes lande, til Browse grupperet efter fil. */
export interface SourceCountries {
  sourceId: string;
  sourceName: string;
  groups: CountryGroup[];
}

export interface CountryGroup {
  key: string;
  name: string;
  /** Klodens tegn for **Øvrige**; ellers landets flag. */
  flag: string;
  categoryCount: number;
  channelCount: number;
}

interface CategoryRow {
  id: string;
  name: string;
  source_id: string;
  channel_count: number;
}

/**
 * Hvor mange kanalnavne der kigges paa per kategori naar kategorinavnet selv
 * intet land rummer. Fem er nok til at et flertal kan afgoere sagen, og holder
 * opslaget paa under halvandet tusind raekker for alle 285 kategorier.
 */
const CHANNEL_SAMPLE = 5;

interface SampleRow {
  category_id: string;
  name: string;
}

/**
 * Udleder land per kategori ud fra dens **kanalnavne**.
 *
 * Panelet skriver landet paa kanalerne ogsaa — `DNK| DR1 HD` — og gør det
 * oftere end paa kategorierne. Er kategorien doebt `SPORT 1080P`, er den
 * eneste maade at finde landet paa at se hvad der ligger i den.
 *
 * Ét opslag for hele panelet, ikke ét per kategori: 285 rundture for at tegne
 * én skaerm er ikke en mulighed. Flertallet blandt stikproeven vinder; staar
 * det lige, vinder det foerst fundne, som er panelets egen raekkefoelge.
 */
async function countriesFromChannels(db: SqlDatabase): Promise<Map<string, Country>> {
  const rows = await db.getAllAsync<SampleRow>(
    `SELECT category_id, name FROM (
       SELECT category_id, name,
              ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY sort_order, id) AS rn
       FROM channels
       WHERE category_id IS NOT NULL
     ) WHERE rn <= ?`,
    [CHANNEL_SAMPLE],
  );

  const votes = new Map<string, Map<string, { country: Country; count: number }>>();
  for (const row of rows) {
    const country = deriveCountryLoose(row.name);
    if (country === null) continue;
    let perCategory = votes.get(row.category_id);
    if (perCategory === undefined) {
      perCategory = new Map();
      votes.set(row.category_id, perCategory);
    }
    const entry = perCategory.get(country.code);
    if (entry === undefined) perCategory.set(country.code, { country, count: 1 });
    else entry.count += 1;
  }

  const winners = new Map<string, Country>();
  for (const [categoryId, perCategory] of votes) {
    let best: { country: Country; count: number } | null = null;
    for (const entry of perCategory.values()) {
      if (best === null || entry.count > best.count) best = entry;
    }
    if (best !== null) winners.set(categoryId, best.country);
  }
  return winners;
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
  // Cachet: det er appens tungeste opslag (vindues-scan over ALLE kanaler +
  // landeudledning), og det kaldes baade af landelisten og kategorilisten, ved
  // hvert fane-skift til Browse. Dataene aendrer sig kun ved en synk, saa
  // invalidateQueryCache i replaceChannels rydder det naar kanalerne skifter.
  return cachedQuery('categorySummaries', async () => {
    const rows = await db.getAllAsync<CategoryRow>(
      `SELECT c.id, c.name, c.source_id, COUNT(ch.id) AS channel_count
       FROM categories c
       LEFT JOIN channels ch ON ch.category_id = c.id
       GROUP BY c.id, c.name, c.source_id
       ORDER BY c.name`,
    );

    // Kanalnavnene bruges kun som anden udvej: kategorinavnet er panelets egen
    // gruppering, og en enkelt fejlmaerket kanal maa ikke kunne flytte hele
    // kategorien under et andet flag.
    const fromChannels = await countriesFromChannels(db);

    return rows.map((row) => {
      const country = deriveCountryLoose(row.name) ?? fromChannels.get(row.id) ?? null;
      return {
        id: row.id,
        name: row.name,
        sourceId: row.source_id,
        channelCount: row.channel_count,
        countryKey: country?.code ?? OTHER_COUNTRY_KEY,
        country,
      };
    });
  });
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
      group = {
        key: summary.countryKey,
        name: summary.country?.name ?? OTHER_COUNTRY_NAME,
        flag: summary.country?.flag ?? OTHER_COUNTRY_FLAG,
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
  sourceId?: string,
): Promise<CategorySummary[]> {
  const summaries = await listCategorySummaries(db);
  return summaries.filter(
    (summary) =>
      summary.countryKey === countryKey &&
      (sourceId === undefined || summary.sourceId === sourceId),
  );
}

/** Øvrige nederst; ellers dansk navnerraekkefoelge. */
function sortCountryGroups(a: CountryGroup, b: CountryGroup): number {
  if (a.key === OTHER_COUNTRY_KEY) return 1;
  if (b.key === OTHER_COUNTRY_KEY) return -1;
  return a.name.localeCompare(b.name, 'da');
}

/**
 * Landene grupperet efter KILDE (fil/panel): hver kilde med sit navn og sine
 * egne lande nedenunder, i kildernes egen raekkefoelge. Saa kan man se hvilken
 * fil kanalerne kommer fra — "Hakuna" med sine flag, og under den "Test" med
 * sine. Skjulte lande udelades her, men findes stadig via soegning.
 */
export async function listSourceCountryGroups(db: SqlDatabase): Promise<SourceCountries[]> {
  const [summaries, hidden, sources] = await Promise.all([
    listCategorySummaries(db),
    listHiddenCountries(db),
    db.getAllAsync<{ id: string; name: string }>(
      'SELECT id, name FROM sources ORDER BY sort_order, created_at',
    ),
  ]);
  const hiddenSet = new Set(hidden);

  // kilde -> land -> gruppe
  const perSource = new Map<string, Map<string, CountryGroup>>();
  for (const summary of summaries) {
    if (hiddenSet.has(summary.countryKey)) continue;
    let byCountry = perSource.get(summary.sourceId);
    if (byCountry === undefined) {
      byCountry = new Map();
      perSource.set(summary.sourceId, byCountry);
    }
    let group = byCountry.get(summary.countryKey);
    if (group === undefined) {
      group = {
        key: summary.countryKey,
        name: summary.country?.name ?? OTHER_COUNTRY_NAME,
        flag: summary.country?.flag ?? OTHER_COUNTRY_FLAG,
        categoryCount: 0,
        channelCount: 0,
      };
      byCountry.set(summary.countryKey, group);
    }
    group.categoryCount += 1;
    group.channelCount += summary.channelCount;
  }

  return sources
    .filter((source) => perSource.has(source.id))
    .map((source) => ({
      sourceId: source.id,
      sourceName: source.name,
      groups: [...perSource.get(source.id)!.values()].sort(sortCountryGroups),
    }));
}
