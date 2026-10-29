/**
 * "Find kampen" (v339): soeg i programoversigten paa tvaers af kanalerne efter
 * et hold, en liga eller en sport, og faa kampene samlet — hvilke kanaler der
 * viser dem, og om de koerer nu.
 *
 * Her er reglerne, uden database og uden React Native, saa de kan testes:
 *
 * - Tekst sammenlignes uden store/smaa bogstaver og uden accenter, og med
 *   ø→o, æ→ae, å→aa: "Brøndby" findes naar man skriver "brondby" (engelske
 *   programoversigter staver det saadan), og "Århus" som "aarhus".
 * - Alle ordene i soegningen skal findes, hvert som begyndelsen af et ord i
 *   titlen eller beskrivelsen: "fc kob" finder "FC København", men "liv" i
 *   "olive" taeller ikke.
 * - Samme kamp paa flere kanaler (samme titel, samme starttid) er én kamp
 *   med flere kanaler; favoritterne foerst.
 * - Kampe der koerer nu foerst, saa efter starttid.
 * - Genudsendelser og hoejdepunkter markeres, saa man kan se forskel.
 */

export interface ProgrammeRow {
  channelId: string;
  title: string;
  description: string | null;
  startMs: number;
  stopMs: number;
}

export interface SportHit {
  /** Stabil noegle: normaliseret titel + starttid. */
  key: string;
  title: string;
  description: string | null;
  startMs: number;
  stopMs: number;
  /** Kanalerne der viser den, bedste foerst. */
  channelIds: string[];
  live: boolean;
  /** Genudsendelse eller hoejdepunkter. */
  replay: boolean;
  /** Fundet i titlen (ikke kun i beskrivelsen). */
  inTitle: boolean;
}

/** Til sammenligning: smaa bogstaver, uden accenter, ø/æ/å skrevet ud. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/å/g, 'aa')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Smaaord der ikke siger noget om kampen ("Arsenal v Chelsea", "AGF - FCK"). */
const NOISE = new Set(['v', 'vs', 'mod', 'og', 'and', 'the']);

/** Soegningens ord, normaliseret. Tom liste: intet at soege paa. */
export function queryTerms(query: string): string[] {
  const words = normalizeText(query)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  const meaningful = words.filter((word) => !NOISE.has(word));
  // Skriver man kun et smaaord ("v"), soeges der alligevel paa det.
  return [...new Set(meaningful.length > 0 ? meaningful : words)];
}

function words(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

function allTermsIn(terms: readonly string[], textWords: readonly string[]): boolean {
  return terms.every((term) => textWords.some((word) => word.startsWith(term)));
}

/**
 * Hvordan programmet matcher: i titlen, kun naar titel og beskrivelse laeses
 * sammen, eller slet ikke.
 */
export function matchProgramme(
  terms: readonly string[],
  title: string,
  description: string | null,
): 'title' | 'description' | null {
  if (terms.length === 0) return null;
  const titleWords = words(title);
  if (allTermsIn(terms, titleWords)) return 'title';
  if (description === null || description.length === 0) return null;
  return allTermsIn(terms, titleWords.concat(words(description))) ? 'description' : null;
}

const REPLAY = /(^|[^a-z])(replay|reprise|genudsendelse|gentagelse|highlights|hoejdepunkter|hojdepunkter|hoydepunkter|hoejdepunkt|hojdepunkt)([^a-z]|$)/;

export function isReplay(title: string): boolean {
  const text = normalizeText(title);
  return /\(r\)/.test(text) || REPLAY.test(text);
}

/**
 * Moenstre til databasens forsortering (SQLite LIKE): ét per ord, med
 * vokalerne som joker (%), saa "brondby" ogsaa rammer "Brøndby" og "aarhus"
 * ogsaa "Århus". Kun et groft filter; `matchProgramme` afgoer det.
 * Ord uden en eneste medlyd kan ikke forsorteres og springes over.
 */
export function likePatterns(terms: readonly string[]): string[] {
  const patterns: string[] = [];
  for (const term of terms) {
    const pattern = `%${term.replace(/[aeiouy]+/g, '%')}%`.replace(/%+/g, '%');
    if (pattern !== '%') patterns.push(pattern);
  }
  return patterns;
}

export interface GroupOptions {
  now: number;
  /** Rangorden for kanaler: lavere foerst (favoritternes plads). Ukendte bagerst. */
  channelRank?: (channelId: string) => number;
  /**
   * Kanaler hvor et fund kun i beskrivelsen ogsaa taeller. Uden den taeller
   * de overalt; med den kun her (sportskanaler), saa en nyhedsudsendelse der
   * naevner holdet ikke ligner en kamp.
   */
  descriptionChannels?: ReadonlySet<string>;
}

/** Programmerne der matcher, samlet per kamp og sorteret. */
export function groupHits(rows: readonly ProgrammeRow[], terms: readonly string[], options: GroupOptions): SportHit[] {
  const { now } = options;
  const rank = options.channelRank ?? (() => 0);
  const groups = new Map<string, SportHit & { ranks: Map<string, number> }>();
  for (const row of rows) {
    if (row.stopMs <= now) continue;
    const how = matchProgramme(terms, row.title, row.description);
    if (how === null) continue;
    if (how === 'description' && options.descriptionChannels !== undefined && !options.descriptionChannels.has(row.channelId)) {
      continue;
    }
    const key = `${words(row.title).join(' ')}@${row.startMs}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        key,
        title: row.title,
        description: row.description,
        startMs: row.startMs,
        stopMs: row.stopMs,
        channelIds: [],
        live: row.startMs <= now && now < row.stopMs,
        replay: isReplay(row.title),
        inTitle: how === 'title',
        ranks: new Map(),
      };
      groups.set(key, group);
    }
    if (!group.ranks.has(row.channelId)) {
      group.ranks.set(row.channelId, rank(row.channelId));
      group.channelIds.push(row.channelId);
    }
    if (group.description === null && row.description !== null) group.description = row.description;
    group.inTitle = group.inTitle || how === 'title';
  }
  const hits: SportHit[] = [];
  for (const { ranks, ...hit } of groups.values()) {
    // Stabil sortering: samme rang beholder databasens raekkefoelge.
    hit.channelIds = hit.channelIds
      .map((id, index) => ({ id, index, rank: ranks.get(id) ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((entry) => entry.id);
    hits.push(hit);
  }
  return hits.sort(
    (a, b) =>
      Number(b.live) - Number(a.live) ||
      a.startMs - b.startMs ||
      Number(a.replay) - Number(b.replay) ||
      Number(b.inTitle) - Number(a.inTitle) ||
      a.title.localeCompare(b.title),
  );
}

/**
 * Er kanalen en sportskanal? Paa navnet eller kategorien. Bruges til hvilke
 * kanaler appen selv henter programoversigt for, og hvor et fund i
 * beskrivelsen taeller.
 */
export function looksLikeSport(channelName: string, categoryName: string | null): boolean {
  const text = normalizeText(`${channelName} ${categoryName ?? ''}`);
  return /sport|espn|dazn|bein|eleven|arena|golf|football|fodbold|fotball|fotboll|premier league|laliga|serie a|bundesliga|nfl|nba|nhl|ufc|motorsport|f1|racing|tennis|cricket|rugby|viaplay|supersport|canal\+ ?sport|tv ?2 ?sport/.test(
    text,
  );
}

/** Kort tid for en kamp: "LIVE NU", "Kl. 21.00", "I morgen 13.30", "Lør. 18.00". */
export function whenLabel(startMs: number, stopMs: number, now: number): string {
  if (startMs <= now && now < stopMs) return 'LIVE NU';
  const start = new Date(startMs);
  const clock = `${String(start.getHours()).padStart(2, '0')}.${String(start.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(startMs);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (days <= 0) return `Kl. ${clock}`;
  if (days === 1) return `I morgen ${clock}`;
  const names = ['Søn.', 'Man.', 'Tir.', 'Ons.', 'Tor.', 'Fre.', 'Lør.'];
  return days < 7 ? `${names[start.getDay()]} ${clock}` : `${start.getDate()}/${start.getMonth() + 1} ${clock}`;
}

/** Hvornaar "i dag" slutter for forsidens raekke: midnat, men mindst seks timer frem (en kamp kl. 00.30 efter aftenens). */
export function todayEnd(now: number): number {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(midnight.getTime(), now + 6 * 3_600_000);
}
