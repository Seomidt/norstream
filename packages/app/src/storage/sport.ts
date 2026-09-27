import { likePatterns, looksLikeSport } from '../features/sport/sportSearch.js';
import type { ProgrammeRow } from '../features/sport/sportSearch.js';
import { listCategorySummaries, listHiddenCountries } from './countries.js';
import { getSetting, setSetting } from './settings.js';
import type { SqlDatabase, SqlValue } from './types.js';

/**
 * Lagring bag "Find kampen" (v339): soegning i de gemte programmer, hvilke
 * kanaler der er sportskanaler, "Mine hold" og de automatiske paamindelser.
 */

/** Hvor mange programmer databasen hoejst giver til en soegning; JS-filteret tager resten. */
const SEARCH_LIMIT = 1500;

/**
 * Programmer i vinduet hvis titel eller beskrivelse groft ligner soegningen
 * (se `likePatterns`). Det endelige valg er `groupHits`.
 */
export async function searchProgrammes(
  db: SqlDatabase,
  terms: readonly string[],
  fromMs: number,
  toMs: number,
): Promise<ProgrammeRow[]> {
  const patterns = likePatterns(terms);
  if (terms.length === 0) return [];
  const where = ['stop_ms > ?', 'start_ms < ?'];
  const params: SqlValue[] = [fromMs, toMs];
  for (const pattern of patterns) {
    where.push("(title LIKE ? OR COALESCE(description, '') LIKE ?)");
    params.push(pattern, pattern);
  }
  params.push(SEARCH_LIMIT);
  const rows = await db.getAllAsync<{ channel_id: string; title: string; description: string | null; start_ms: number; stop_ms: number }>(
    `SELECT channel_id, title, description, start_ms, stop_ms FROM programmes
     WHERE ${where.join(' AND ')}
     ORDER BY start_ms
     LIMIT ?`,
    params,
  );
  return rows.map((row) => ({
    channelId: row.channel_id,
    title: row.title,
    description: row.description,
    startMs: row.start_ms,
    stopMs: row.stop_ms,
  }));
}

/** Groft SQL-filter for sportskanaler; `looksLikeSport` afgoer det. */
const SPORT_WORDS = [
  'sport', 'espn', 'dazn', 'bein', 'eleven', 'arena', 'golf', 'football', 'fodbold', 'premier',
  'liga', 'viaplay', 'f1', 'nfl', 'nba', 'nhl', 'ufc', 'tennis', 'racing', 'cricket', 'rugby',
];

/**
 * Hoejst saa mange kanaler faar appen selv til at hente programoversigt for.
 * Hver er en hel uges programmer i databasen; paa tv-boksen maa det ikke
 * blive tungt (se OVERDRAGELSE.md om XMLTV-sporet).
 */
export const SPORT_CHANNEL_CAP = 150;

export interface SportChannels {
  /** Kanalerne der skal have frisk programoversigt, bedste foerst (favoritter, saa sport fra favoritternes lande). */
  refresh: string[];
  /** Sportskanaler (ikke i skjulte lande): her taeller et fund i beskrivelsen. */
  sport: Set<string>;
  /** Rang: favoritternes plads, saa sportskanalerne; ukendte bagerst. */
  rank: Map<string, number>;
  /** Kanaler fra lande brugeren har skjult: vises ikke i resultaterne. */
  hidden: Set<string>;
}

export async function sportChannels(db: SqlDatabase): Promise<SportChannels> {
  const [summaries, hiddenCountries] = await Promise.all([listCategorySummaries(db), listHiddenCountries(db)]);
  const hiddenSet = new Set(hiddenCountries);
  const countryOf = new Map(summaries.map((summary) => [summary.id, summary.countryKey]));

  const favourites = await db.getAllAsync<{ id: string; category_id: string | null }>(
    `SELECT c.id, c.category_id FROM favorites f JOIN channels c ON c.id = f.channel_id
     ORDER BY f.position IS NULL, f.position, c.sort_order`,
  );
  const likes = SPORT_WORDS.map(() => '(c.name LIKE ? OR cat.name LIKE ?)').join(' OR ');
  const likeParams = SPORT_WORDS.flatMap((word) => [`%${word}%`, `%${word}%`]);
  const candidates = await db.getAllAsync<{ id: string; name: string; category_id: string | null; category: string | null }>(
    `SELECT c.id, c.name, c.category_id, cat.name AS category
     FROM channels c LEFT JOIN categories cat ON cat.id = c.category_id
     WHERE ${likes}
     ORDER BY c.sort_order`,
    likeParams,
  );

  const favouriteCountries = new Set(
    favourites.map((f) => (f.category_id === null ? undefined : countryOf.get(f.category_id))).filter((c): c is string => c !== undefined),
  );
  const sport = new Set<string>();
  const near: string[] = [];
  const far: string[] = [];
  for (const channel of candidates) {
    if (!looksLikeSport(channel.name, channel.category)) continue;
    const country = channel.category_id === null ? undefined : countryOf.get(channel.category_id);
    if (country !== undefined && hiddenSet.has(country)) continue;
    sport.add(channel.id);
    (country !== undefined && favouriteCountries.has(country) ? near : far).push(channel.id);
  }

  const rank = new Map<string, number>();
  const refresh: string[] = [];
  const add = (id: string): void => {
    if (rank.has(id)) return;
    rank.set(id, rank.size);
    refresh.push(id);
  };
  for (const favourite of favourites) add(favourite.id);
  for (const id of near) add(id);
  for (const id of far) add(id);

  const hidden = new Set<string>();
  if (hiddenSet.size > 0) {
    const rows = await db.getAllAsync<{ id: string; category_id: string | null }>('SELECT id, category_id FROM channels WHERE category_id IS NOT NULL');
    for (const row of rows) {
      const country = row.category_id === null ? undefined : countryOf.get(row.category_id);
      if (country !== undefined && hiddenSet.has(country) && !rank.has(row.id)) hidden.add(row.id);
    }
  }
  return { refresh: refresh.slice(0, SPORT_CHANNEL_CAP), sport, rank, hidden };
}

// ---- Mine hold ----

/** Med i sikkerhedskopien (backup.ts). */
export const KEY_SPORT_TEAMS = 'sport_teams';
export const KEY_SPORT_AUTO_REMIND = 'sport_auto_remind';
/** Kampe appen allerede selv har sat en paamindelse for, saa en slettet ikke kommer igen. */
const KEY_SPORT_AUTO_DONE = 'sport_auto_done';

export async function getSportTeams(db: SqlDatabase): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse((await getSetting(db, KEY_SPORT_TEAMS)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string' && t.trim().length > 0) : [];
  } catch {
    return [];
  }
}

export async function setSportTeams(db: SqlDatabase, teams: readonly string[]): Promise<void> {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const team of teams) {
    const name = team.trim().replace(/\s+/g, ' ');
    const id = name.toLowerCase();
    if (name.length === 0 || seen.has(id)) continue;
    seen.add(id);
    clean.push(name);
  }
  await setSetting(db, KEY_SPORT_TEAMS, JSON.stringify(clean));
}

export async function getSportAutoRemind(db: SqlDatabase): Promise<boolean> {
  return (await getSetting(db, KEY_SPORT_AUTO_REMIND)) === '1';
}

export async function setSportAutoRemind(db: SqlDatabase, on: boolean): Promise<void> {
  await setSetting(db, KEY_SPORT_AUTO_REMIND, on ? '1' : '0');
}

/** Noeglerne (`kanal@start`) appen selv har mindet om; kun dem der ikke er udloebet. */
export async function getAutoReminded(db: SqlDatabase, now = Date.now()): Promise<Set<string>> {
  try {
    const parsed: unknown = JSON.parse((await getSetting(db, KEY_SPORT_AUTO_DONE)) ?? '[]');
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((key): key is string => typeof key === 'string' && Number(key.slice(key.lastIndexOf('@') + 1)) > now - 86_400_000),
    );
  } catch {
    return new Set();
  }
}

export async function setAutoReminded(db: SqlDatabase, keys: ReadonlySet<string>): Promise<void> {
  await setSetting(db, KEY_SPORT_AUTO_DONE, JSON.stringify([...keys]));
}
