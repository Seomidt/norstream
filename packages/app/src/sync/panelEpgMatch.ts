import { deriveCountry, deriveCountryLoose, normaliseChannelName } from '@norstream/core';

/** En af appens kanaler der mangler EPG: noeglen, navnet og landet (ISO-kode eller ''). */
export interface WantedChannel {
  key: string;
  name: string;
  country: string;
  /** Kanalens EPG-id fra panelet, hvis den har et. Matches direkte, foer navnet. */
  epgId?: string | null;
}

/** En kanal i panelets XMLTV-fil, som PanelEpgModule giver den. */
export interface FeedChannel {
  id: string;
  /** display-name'erne. */
  n: string[];
}

/**
 * Er der flere kanaler end det med samme navn i samme land, er navnet
 * generisk ("Sport", "News") og ikke én kanal. Saa gaettes der ikke.
 */
const MAX_SAME_COUNTRY = 3;

/**
 * Landet for en kanal i filen: id'ets endelse (`BBCOne.uk`), ellers et
 * landepraefiks i navnet (`UK: BBC One`). '' naar det ikke kan siges.
 */
export function feedCountry(channel: FeedChannel): string {
  const suffix = /\.([a-z]{2})$/i.exec(channel.id.trim());
  if (suffix !== null) {
    const code = deriveCountry(`${(suffix[1] ?? '').toUpperCase()}| x`)?.code;
    if (code !== undefined) return code.toUpperCase();
  }
  for (const name of channel.n) {
    const code = deriveCountryLoose(name)?.code;
    if (code !== undefined) return code.toUpperCase();
  }
  return '';
}

interface FeedRef {
  id: string;
  country: string;
}

/**
 * Hvilke af filens kanaler appens kanaler skal have programmer fra.
 *
 * Paa navn — panelets kanaler uden EPG-id har intet andet — men altid med
 * **landet**: det rensede navn rummer det ikke ("UK| BBC ONE HD" og en tysk
 * "BBC One" bliver begge "bbc one"), og en dansk eller britisk kanal maa
 * aldrig faa et andet lands programmer. Kan det ikke afgoeres entydigt,
 * springes kanalen over. Hellere ingen EPG end forkert EPG.
 *
 * Svarer med filens id -> appens noegler (flere kvalitets-varianter kan
 * dele samme kanal i filen).
 */
export function matchPanelEpg(wanted: readonly WantedChannel[], feed: readonly FeedChannel[]): Map<string, string[]> {
  const byName = new Map<string, FeedRef[]>();
  for (const channel of feed) {
    if (channel.id.length === 0) continue;
    const ref: FeedRef = { id: channel.id, country: feedCountry(channel) };
    // Id'et uden landeendelse er ogsaa et navn: `BBCOne.uk` -> `BBCOne`.
    const names = [...channel.n, channel.id.replace(/\.[a-z]{2}$/i, '')];
    const seen = new Set<string>();
    for (const name of names) {
      const key = normaliseChannelName(name);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      const list = byName.get(key);
      if (list === undefined) byName.set(key, [ref]);
      else list.push(ref);
    }
  }

  // Filens id'er uden hensyn til store/smaa bogstaver: panelets EPG-id og
  // filens kanal-id er det samme id, saa det er et opslag, ikke et gaet.
  const byId = new Map<string, string>();
  for (const channel of feed) if (channel.id.length > 0) byId.set(channel.id.toLowerCase(), channel.id);

  const result = new Map<string, string[]>();
  const add = (feedId: string, key: string): void => {
    const keys = result.get(feedId);
    if (keys === undefined) result.set(feedId, [key]);
    else keys.push(key);
  };
  for (const channel of wanted) {
    const direct = channel.epgId === null || channel.epgId === undefined ? undefined : byId.get(channel.epgId.trim().toLowerCase());
    if (direct !== undefined) {
      add(direct, channel.key);
      continue;
    }
    const key = normaliseChannelName(channel.name);
    if (key.length === 0) continue;
    const candidates = byName.get(key);
    if (candidates === undefined || candidates.length === 0) continue;
    const country = channel.country.toUpperCase();
    let pick: FeedRef | undefined;
    if (country.length > 0) {
      const same = candidates.filter((ref) => ref.country === country);
      if (same.length > 0 && same.length <= MAX_SAME_COUNTRY) {
        pick = same[0];
      } else if (same.length === 0) {
        // Kun kanaler uden kendt land i filen: tag den, hvis den er den eneste med navnet.
        const unknown = candidates.filter((ref) => ref.country === '');
        if (unknown.length === 1 && candidates.length === 1) pick = unknown[0];
      }
    } else if (candidates.length === 1) {
      // Appens kanal har intet land: kun hvis navnet er entydigt i hele filen.
      pick = candidates[0];
    }
    if (pick === undefined) continue;
    add(pick.id, channel.key);
  }
  return result;
}
