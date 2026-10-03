/**
 * Google TV's "Fortsaet med at se" (v338): film og serier man er i gang med,
 * vist paa Google TV's egen forside, saa man kan fortsaette uden at aabne
 * appen foerst. Selve indlaegningen er native (modules/watch-next,
 * Googles Watch Next-kanal); her er reglerne for hvad og hvornaar.
 *
 * - Én post per film, og én per serie (paa det afsnit man er naaet).
 * - Kun naar man er kommet i gang (mindst et minut) og ikke er ved
 *   slutningen (de sidste tre minutter — rulletekster regnes som set).
 * - Set faerdig: posten fjernes.
 * - Hoejst én opdatering per titel i minuttet; fremdriften gemmes oftere.
 * - Linket (`norstream://vod/<titel>?episode=<afsnit>`) aabner titlen i
 *   appen og fortsaetter afspilningen (App.tsx).
 *
 * Testene koerer uden React Native; det native modul registreres fra App.tsx.
 */

export interface WatchNextNative {
  upsert(json: string): Promise<boolean>;
  remove(key: string): Promise<boolean>;
}

let registered: WatchNextNative | null = null;

export function registerWatchNextNative(native: WatchNextNative | null): void {
  registered = native;
}

export const WATCH_NEXT_SCHEME = 'norstream';
/** Foer det er man ikke rigtig i gang. */
const MIN_POSITION_S = 60;
/** De sidste minutter regnes som set til ende. */
const END_MARGIN_S = 180;
const MIN_INTERVAL_MS = 60_000;

export interface WatchNextEntry {
  /** Filmens eller seriens noegle. */
  key: string;
  title: string;
  posterUrl: string | null;
  positionS: number;
  durationS: number | null;
  /** Kun afsnit. */
  episode?: { key: string; season: number; number: number; title: string } | null;
}

/** Linket posten aabner. */
export function watchNextUri(key: string, episodeKey: string | null): string {
  const base = `${WATCH_NEXT_SCHEME}://vod/${encodeURIComponent(key)}`;
  return episodeKey === null ? base : `${base}?episode=${encodeURIComponent(episodeKey)}`;
}

/** Laeser et link tilbage; null hvis det ikke er et af vores. */
export function parseWatchNextUri(url: string): { itemKey: string; episodeKey: string | null } | null {
  const match = /^norstream:\/\/vod\/([^?#]+)(?:\?([^#]*))?/.exec(url.trim());
  if (match === null) return null;
  let itemKey: string;
  try {
    itemKey = decodeURIComponent(match[1] as string);
  } catch {
    return null;
  }
  if (itemKey.length === 0) return null;
  let episodeKey: string | null = null;
  for (const part of (match[2] ?? '').split('&')) {
    const [name, value] = part.split('=');
    if (name === 'episode' && value !== undefined && value.length > 0) {
      try {
        episodeKey = decodeURIComponent(value);
      } catch {
        episodeKey = null;
      }
    }
  }
  return { itemKey, episodeKey };
}

/** Hvad der skal ske med posten ved denne position: laeg ind, fjern, eller intet. */
export function watchNextAction(positionS: number, durationS: number | null): 'upsert' | 'remove' | 'none' {
  if (!Number.isFinite(positionS) || positionS < MIN_POSITION_S) return 'none';
  if (durationS !== null && durationS > 0 && positionS >= durationS - END_MARGIN_S) return 'remove';
  return 'upsert';
}

/** Posten som det native modul vil have den. */
export function watchNextJson(entry: WatchNextEntry): string {
  const episode = entry.episode ?? null;
  return JSON.stringify({
    key: entry.key,
    title: entry.title,
    posterUrl: entry.posterUrl ?? '',
    positionMs: Math.round(entry.positionS * 1000),
    durationMs: entry.durationS === null ? 0 : Math.round(entry.durationS * 1000),
    uri: watchNextUri(entry.key, episode?.key ?? null),
    episode: episode !== null,
    ...(episode === null
      ? {}
      : { season: episode.season, episodeNumber: episode.number, episodeTitle: episode.title }),
  });
}

const lastSent = new Map<string, number>();

/**
 * Opdaterer posten for titlen. `force`: ved afgang fra afspilleren, uden
 * minut-graensen. Stille ved fejl.
 */
export async function updateWatchNext(entry: WatchNextEntry, force = false, now = Date.now()): Promise<void> {
  const native = registered;
  if (native === null) return;
  const action = watchNextAction(entry.positionS, entry.durationS);
  try {
    if (action === 'remove') {
      lastSent.delete(entry.key);
      await native.remove(entry.key);
      return;
    }
    if (action === 'none') return;
    const previous = lastSent.get(entry.key) ?? 0;
    if (!force && now - previous < MIN_INTERVAL_MS) return;
    lastSent.set(entry.key, now);
    await native.upsert(watchNextJson(entry));
  } catch {
    // Google TV er et tilvalg.
  }
}

/** Set faerdig (film) — posten fjernes. */
export async function removeWatchNext(key: string): Promise<void> {
  lastSent.delete(key);
  try {
    await registered?.remove(key);
  } catch {
    // Stille.
  }
}
