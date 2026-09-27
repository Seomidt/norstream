import type { AppSession } from '../../session.js';
import { getChannelsByIds } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import { addReminder, listReminders } from '../../storage/reminders.js';
import {
  getAutoReminded,
  getSportAutoRemind,
  getSportTeams,
  searchProgrammes,
  setAutoReminded,
  sportChannels,
} from '../../storage/sport.js';
import type { SportChannels } from '../../storage/sport.js';
import type { SqlDatabase } from '../../storage/types.js';
import { ensureFullEpg } from '../../sync/epgCache.js';
import { groupHits, queryTerms, todayEnd } from './sportSearch.js';
import type { SportHit } from './sportSearch.js';

/**
 * Limen bag "Find kampen" (v339): database, kanaler og programoversigt.
 * Reglerne er i sportSearch.ts og testet dér.
 */

/** Saa langt frem der soeges. */
export const SEARCH_DAYS = 7;
/** Hoejst saa mange kanaler vises per kamp. */
const CHANNELS_PER_MATCH = 6;

export interface Match extends SportHit {
  channels: StoredChannel[];
}

let cachedChannels: { at: number; value: SportChannels } | null = null;

/** Sportskanalerne, husket et kvarter (opslaget gaar over alle kanaler). */
export async function knownSportChannels(db: SqlDatabase, fresh = false): Promise<SportChannels> {
  if (!fresh && cachedChannels !== null && Date.now() - cachedChannels.at < 15 * 60_000) return cachedChannels.value;
  const value = await sportChannels(db);
  cachedChannels = { at: Date.now(), value };
  return value;
}

/** Kampe der matcher soegningen, fra nu og `days` frem (eller til `until`). */
export async function findMatches(
  db: SqlDatabase,
  query: string,
  options: { now?: number; until?: number; limit?: number } = {},
): Promise<Match[]> {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const now = options.now ?? Date.now();
  const until = options.until ?? now + SEARCH_DAYS * 86_400_000;
  const [rows, known] = await Promise.all([searchProgrammes(db, terms, now, until), knownSportChannels(db)]);
  // Skjulte lande findes stadig (skjult gaelder Kanaler, ikke soegning), men
  // deres kanaler staar sidst.
  const hits = groupHits(rows, terms, {
    now,
    channelRank: (id) => (known.rank.get(id) ?? Number.MAX_SAFE_INTEGER - 1) + (known.hidden.has(id) ? 1_000_000 : 0),
    descriptionChannels: known.sport,
  }).slice(0, options.limit ?? 80);
  const channels = await getChannelsByIds(
    db,
    hits.flatMap((hit) => hit.channelIds.slice(0, CHANNELS_PER_MATCH * 2)),
  );
  const matches: Match[] = [];
  for (const hit of hits) {
    const found = hit.channelIds
      .map((id) => channels.get(id))
      .filter((channel): channel is StoredChannel => channel !== undefined)
      .slice(0, CHANNELS_PER_MATCH);
    if (found.length > 0) matches.push({ ...hit, channels: found });
  }
  return matches;
}

/** Kampe for "Mine hold" fra nu til i nat (forsidens raekke). Samme kamp kun én gang. */
export async function teamMatchesToday(db: SqlDatabase, now = Date.now()): Promise<Array<Match & { team: string }>> {
  const teams = await getSportTeams(db);
  const seen = new Set<string>();
  const all: Array<Match & { team: string }> = [];
  for (const team of teams) {
    const found = await findMatches(db, team, { now, until: todayEnd(now), limit: 20 }).catch(() => []);
    for (const match of found) {
      // Hoejdepunkter og genudsendelser er ikke "dine hold spiller".
      if (match.replay || seen.has(match.key)) continue;
      seen.add(match.key);
      all.push({ ...match, team });
    }
  }
  return all.sort((a, b) => Number(b.live) - Number(a.live) || a.startMs - b.startMs);
}

/**
 * Automatisk paamindelse om "Mine hold"s kampe, naar det er slaaet til:
 * én per kamp, paa den bedste kanal. En paamindelse brugeren selv har
 * fjernet, saettes ikke igen (listen over dem appen har sat).
 */
export async function autoRemindTeams(db: SqlDatabase, now = Date.now()): Promise<number> {
  if (!(await getSportAutoRemind(db))) return 0;
  const matches = await teamMatchesToday(db, now);
  const [done, existing] = await Promise.all([getAutoReminded(db, now), listReminders(db)]);
  const set = new Set(existing.map((r) => `${r.channelId}@${r.startMs}`));
  let added = 0;
  for (const match of matches) {
    if (match.startMs <= now) continue;
    const channel = match.channels[0];
    if (channel === undefined) continue;
    const key = `${channel.id}@${match.startMs}`;
    if (done.has(key) || set.has(key)) continue;
    await addReminder(db, channel.id, {
      channelId: channel.id,
      title: match.title,
      description: match.description,
      start: new Date(match.startMs),
      stop: new Date(match.stopMs),
    });
    done.add(key);
    added += 1;
  }
  if (added > 0) await setAutoReminded(db, done);
  return added;
}

let lastRefresh = 0;
let running: Promise<number> | null = null;

/**
 * Henter programoversigt for sportskanalerne (favoritter foerst), saa der er
 * noget at soege i. `ensureFullEpg` springer selv friske kanaler over (seks
 * timer); her hoejst hvert tyvende minut, og aldrig to gange paa én gang.
 * Svarer med antal kanaler der blev hentet for.
 */
export async function refreshSportEpg(
  session: Pick<AppSession, 'db' | 'credsBySource' | 'fetchImpl'>,
  force = false,
): Promise<number> {
  if (running !== null) return running;
  if (!force && Date.now() - lastRefresh < 20 * 60_000) return 0;
  lastRefresh = Date.now();
  running = (async () => {
    try {
      const known = await knownSportChannels(session.db, true);
      const result = await ensureFullEpg(
        session.db,
        session.credsBySource,
        session.fetchImpl,
        known.refresh.map((id) => ({ id })),
      );
      return result.fetched;
    } catch {
      return 0;
    } finally {
      running = null;
    }
  })();
  return running;
}
