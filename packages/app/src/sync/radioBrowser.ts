import { countryFlag } from '@norstream/core';
import type { FetchLikeResponse } from '@norstream/core';
import { APP_USER_AGENT } from '../net/userAgent.js';
import type { StoredChannel } from '../storage/channels.js';

/**
 * Internetradio fra Radio Browser.
 *
 * radio-browser.info er et aabent, faelles register over internetradio:
 * omkring 50.000 stationer med stream-adresse, logo, land og stemmer,
 * uden noegle. Det er de rigtige stationers egne streams (DR, SR, NRK,
 * BBC, og alt det smaa), ikke panelets, saa de er ikke bundet af panelets
 * ene forbindelse og virker uanset hvad panelet goer.
 *
 * Stationerne hentes per land naar landet aabnes, og gemmes en uge.
 */

export type RadioFetch = (url: string) => Promise<FetchLikeResponse>;

const API = 'https://de1.api.radio-browser.info/json';
const TIMEOUT_MS = 15_000;
/** Hvor mange stationer der hentes per land. De flest stemte foerst. */
const STATIONS_PER_COUNTRY = 300;
/** Lande med faerre stationer end det vises ikke; listen er lang nok. */
const MIN_STATIONS = 15;
export const RADIO_SOURCE_ID = 'radio-browser';
/** Praefikset paa stationernes noegle, saa afspilleren kan kende dem som radio. */
export const RADIO_KEY_PREFIX = 'rb:';

export const radioFetch: RadioFetch = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': APP_USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json() as Promise<unknown>,
      text: () => response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
};

export interface RadioCountry {
  /** ISO 3166-1 alpha-2, store bogstaver. */
  code: string;
  name: string;
  flag: string;
  stations: number;
}

export interface RadioStation {
  /** Registrets uuid. */
  id: string;
  name: string;
  country: string;
  url: string;
  logoUrl: string | null;
  homepage: string | null;
  votes: number;
  codec: string;
  bitrate: number;
  tags: string[];
}

async function readJson(fetchImpl: RadioFetch, url: string): Promise<unknown> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** Danske navne paa de lande der er flest stationer i; resten faar koden. */
const COUNTRY_NAMES: Record<string, string> = {
  DK: 'Danmark', SE: 'Sverige', NO: 'Norge', FI: 'Finland', IS: 'Island', DE: 'Tyskland',
  GB: 'Storbritannien', US: 'USA', NL: 'Holland', BE: 'Belgien', FR: 'Frankrig', ES: 'Spanien',
  IT: 'Italien', PT: 'Portugal', AT: 'Østrig', CH: 'Schweiz', PL: 'Polen', CZ: 'Tjekkiet',
  GR: 'Grækenland', TR: 'Tyrkiet', RU: 'Rusland', UA: 'Ukraine', IE: 'Irland', CA: 'Canada',
  AU: 'Australien', BR: 'Brasilien', MX: 'Mexico', AR: 'Argentina', IN: 'Indien', JP: 'Japan',
  CN: 'Kina', HU: 'Ungarn', RO: 'Rumænien', HR: 'Kroatien', RS: 'Serbien', BG: 'Bulgarien',
  SK: 'Slovakiet', SI: 'Slovenien', EE: 'Estland', LV: 'Letland', LT: 'Litauen', LU: 'Luxembourg',
  ZA: 'Sydafrika', NZ: 'New Zealand', CO: 'Colombia', CL: 'Chile', PE: 'Peru', ID: 'Indonesien',
  PH: 'Filippinerne', KR: 'Sydkorea', TH: 'Thailand', VN: 'Vietnam', EG: 'Egypten', MA: 'Marokko',
  IL: 'Israel', SA: 'Saudi-Arabien', AE: 'Emiraterne', IR: 'Iran', PK: 'Pakistan', NG: 'Nigeria',
  KE: 'Kenya', CU: 'Cuba', VE: 'Venezuela', UY: 'Uruguay', EC: 'Ecuador', BY: 'Belarus', GE: 'Georgien',
  MT: 'Malta', CY: 'Cypern', MK: 'Nordmakedonien', BA: 'Bosnien', AL: 'Albanien', MD: 'Moldova',
};

export function radioCountryName(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

/** Landene, dem med flest stationer foerst. Norden foerst uanset antal. */
const NORDIC = ['DK', 'SE', 'NO', 'FI', 'IS'];

export async function fetchRadioCountries(fetchImpl: RadioFetch): Promise<RadioCountry[]> {
  const body = await readJson(fetchImpl, `${API}/countrycodes?order=stationcount&reverse=true&hidebroken=true`);
  if (!Array.isArray(body)) return [];
  const countries: RadioCountry[] = [];
  for (const raw of body as Array<Record<string, unknown>>) {
    const code = typeof raw.name === 'string' ? raw.name.trim().toUpperCase() : '';
    const stations = typeof raw.stationcount === 'number' ? raw.stationcount : 0;
    if (!/^[A-Z]{2}$/.test(code)) continue;
    if (stations < MIN_STATIONS && !NORDIC.includes(code)) continue;
    countries.push({ code, name: radioCountryName(code), flag: countryFlag(code), stations });
  }
  return sortCountries(countries);
}

export function sortCountries(countries: RadioCountry[]): RadioCountry[] {
  return [...countries].sort((a, b) => {
    const na = NORDIC.indexOf(a.code);
    const nb = NORDIC.indexOf(b.code);
    if (na !== -1 || nb !== -1) {
      if (na === -1) return 1;
      if (nb === -1) return -1;
      return na - nb;
    }
    return b.stations - a.stations || a.name.localeCompare(b.name);
  });
}

export function toRadioStation(raw: Record<string, unknown>): RadioStation | null {
  const id = typeof raw.stationuuid === 'string' ? raw.stationuuid : '';
  const name = typeof raw.name === 'string' ? displayName(raw.name.replace(/\s+/g, ' ').trim()) : '';
  const url = typeof raw.url_resolved === 'string' && raw.url_resolved.length > 0 ? raw.url_resolved : raw.url;
  if (id.length === 0 || name.length === 0 || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  const favicon = typeof raw.favicon === 'string' && /^https?:\/\//i.test(raw.favicon) ? raw.favicon : null;
  const homepage = typeof raw.homepage === 'string' && /^https?:\/\//i.test(raw.homepage) ? raw.homepage : null;
  const tags =
    typeof raw.tags === 'string'
      ? raw.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
          .slice(0, 6)
      : [];
  return {
    id,
    name,
    country: typeof raw.countrycode === 'string' ? raw.countrycode.toUpperCase() : '',
    url,
    logoUrl: favicon,
    homepage,
    votes: typeof raw.votes === 'number' ? raw.votes : 0,
    codec: typeof raw.codec === 'string' ? raw.codec : '',
    bitrate: typeof raw.bitrate === 'number' ? raw.bitrate : 0,
    tags,
  };
}

function stationsOf(body: unknown): RadioStation[] {
  if (!Array.isArray(body)) return [];
  const stations: RadioStation[] = [];
  const seen = new Set<string>();
  for (const raw of body as Array<Record<string, unknown>>) {
    const station = toRadioStation(raw);
    if (station === null || seen.has(station.id)) continue;
    seen.add(station.id);
    stations.push(station);
  }
  return preferBestQuality(stations);
}

/**
 * Ord der kun siger noget om streamen, ikke om stationen.
 * Deles af displayName og qualityKey; RadioBrowser.kt i bilen har den samme.
 */
const STREAM_WORDS = '(?:hq|lq|hd|high|low|aac|aacp|aacplus|aac\\s?plus|he-?aac|aac\\+|mp3|ogg|opus|flac|stereo|mono|kbps|kbit|kb/s|k|stream)';
const BITRATES = '(?:32|40|48|56|64|80|96|112|128|160|192|224|256|320)';

/**
 * Navnet som det vises: uden "(MP3)", "(AAC 96)", "[128 kbps]" og
 * " - 320 kbps" i slutningen. Det er registrets maade at skelne udgaver
 * paa, og appen vaelger selv udgaven; saa siger parentesen ikke andet end
 * "vi har flere". "(Danmark)" og andet der ikke handler om streamen bliver
 * staaende: det kan vaere en del af navnet.
 */
export function displayName(name: string): string {
  const inside = `\\s*(?:${STREAM_WORDS}|${BITRATES})(?:[\\s/,+-]*(?:${STREAM_WORDS}|${BITRATES}))*\\s*`;
  const trailingBracket = new RegExp(`\\s*[([]${inside}[)\\]]\\s*$`, 'i');
  const trailingWords = new RegExp(`(?:\\s+[-–|·]\\s*|\\s+)${BITRATES}\\s?(?:kbps|kbit|kb/s|k)\\b\\s*$`, 'i');
  const trailingCodec = new RegExp(`(?:\\s+[-–|·]\\s*|\\s+)(?:mp3|aac\\+?|aacplus|he-?aac|ogg|opus|flac)\\s*$`, 'i');
  let out = name.trim();
  for (;;) {
    const next = out.replace(trailingBracket, '').replace(trailingWords, '').replace(trailingCodec, '').trim();
    if (next === out || next.length === 0) break;
    out = next;
  }
  return out.length === 0 ? name.trim() : out;
}

/**
 * Det samme navn uden det der kun siger noget om streamen: bitrate, codec,
 * "HQ". "DR P3", "DR P3 192" og "DR P3 (AAC 96)" giver samme noegle.
 *
 * Kun de tal der er bitrates fjernes. Foer forsvandt alle tal, og saa
 * blev "Radio 100" og "Radio 208" til én station, og den ene manglede.
 */
export function qualityKey(name: string): string {
  return name
    .toLowerCase()
    // "(Danmark)", "[HQ]", "(AAC 96)" i slutningen siger ikke hvilken station det er.
    .replace(/(\s*[([][^)\]]*[)\]])+\s*$/g, '')
    .replace(/\b(32|40|48|56|64|80|96|112|128|160|192|224|256|320)\s?(k|kbps|kbit|kb\/s)?\b/g, ' ')
    .replace(/\b(hq|lq|hd|high|low|aac|aacp|aacplus|aac\s?plus|he-?aac|aac\+|mp3|ogg|opus|flac|stereo|mono|kbps)\b/g, ' ')
    .replace(/[^a-z0-9æøåäöüß]+/g, '');
}

/**
 * Streams der er maalt doede, selv om registret siger de virker.
 *
 * DR's HLS-lister: hovedlisten svarer 200, men alle underlisterne svarer
 * 404 (maalt september 2026). Registrets tjek ser kun hovedlisten. DR har
 * en direkte MP3-stream til hver kanal, som staar i registret ved siden af.
 */
const DEAD_STREAM_HOSTS = [/^drliveradio\d*\.akamaized\.net$/i];

export function isKnownDeadUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return DEAD_STREAM_HOSTS.some((pattern) => pattern.test(host));
}

/** En HLS-afspilningsliste, ikke en direkte stream. */
export function isHlsUrl(url: string): boolean {
  return /\.m3u8?(\?|#|$)/i.test(url) || /\/hls\//i.test(url);
}

/**
 * Hvor god en stream er, til valget mellem udgaver af samme station.
 *
 * En direkte stream slaar altid en HLS-liste: maalt paa Danmark var DR's
 * HLS-udgaver dem der ikke kunne spilles, de sender aldrig titel, og
 * registret giver dem en hoej bitrate (324) der ellers ville vinde.
 * Derefter taeller bitraten.
 */
export function streamScore(station: Pick<RadioStation, 'url' | 'bitrate'>): number {
  return (isHlsUrl(station.url) ? 0 : 1_000_000) + Math.max(0, station.bitrate);
}

/**
 * Én station per navn, og den bedste stream af dem.
 *
 * Registret har samme station flere gange med hver sin bitrate, og den
 * mest stemte er tit den daarligste. Af dem med samme navn beholdes den
 * med bedst streamScore; staar de lige, beholdes den mest stemte (den
 * foerste). Stationen staar hvor den foerste af dem stod.
 */
export function preferBestQuality(stations: readonly RadioStation[]): RadioStation[] {
  const groups = new Map<string, RadioStation[]>();
  const order: string[] = [];
  for (const station of stations) {
    if (isKnownDeadUrl(station.url)) continue;
    const key = qualityKey(station.name);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [station]);
      order.push(key);
    } else {
      group.push(station);
    }
  }
  return order.map((key) => {
    const group = groups.get(key) ?? [];
    let best = group[0] as RadioStation;
    for (const candidate of group) {
      if (streamScore(candidate) > streamScore(best)) best = candidate;
    }
    return best;
  });
}

/** Et lands stationer, flest stemmer foerst. Doede stationer er sorteret fra af registret. */
export async function fetchRadioStations(fetchImpl: RadioFetch, countryCode: string): Promise<RadioStation[]> {
  const code = encodeURIComponent(countryCode.toUpperCase());
  const body = await readJson(
    fetchImpl,
    `${API}/stations/bycountrycodeexact/${code}?order=votes&reverse=true&hidebroken=true&limit=${STATIONS_PER_COUNTRY}`,
  );
  return stationsOf(body);
}

/** Soegning paa navn paa tvaers af alle lande. */
export async function searchRadioStations(fetchImpl: RadioFetch, query: string, limit = 60): Promise<RadioStation[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const body = await readJson(
    fetchImpl,
    `${API}/stations/search?name=${encodeURIComponent(trimmed)}&order=votes&reverse=true&hidebroken=true&limit=${limit}`,
  );
  return stationsOf(body);
}

/**
 * Stationen som en kanal afspilleren kan spille: adressen er stationens
 * egen, saa der bygges ingen panel-URL, og noeglen begynder med `rb:`,
 * saa afspilleren ved at det er radio uanset hvad stationen hedder.
 */
export function toRadioChannel(station: RadioStation): StoredChannel {
  const logoUrls = radioLogoUrls(station);
  return {
    id: `${RADIO_KEY_PREFIX}${station.id}`,
    sourceId: RADIO_SOURCE_ID,
    streamId: station.id,
    streamUrl: station.url,
    logoUrls,
    name: station.name,
    number: null,
    logoUrl: logoUrls[0] ?? null,
    categoryId: null,
    epgChannelId: null,
    hasArchive: false,
    archiveDays: 0,
    isFavorite: false,
  };
}

export function isRadioKey(channelKey: string): boolean {
  return channelKey.startsWith(RADIO_KEY_PREFIX);
}

/**
 * Hjemmesidens ikon fra Googles ikontjeneste, naar registret intet logo
 * har. Maalt paa 32 stationer uden favicon: 27 fik et rigtigt ikon, og de
 * andre et rent 404, saa listen falder videre til initialerne i stedet for
 * at vise en graa klode. Op til 128 px; mindre naar siden ikke har stoerre.
 */
export function homepageIconUrl(homepage: string | null): string | null {
  if (homepage === null) return null;
  let host: string;
  try {
    host = new URL(homepage).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
  if (host.length === 0 || !host.includes('.')) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
}

/** Logoerne at proeve i raekkefoelge: registrets favicon foerst, saa hjemmesidens ikon. */
export function radioLogoUrls(station: Pick<RadioStation, 'logoUrl' | 'homepage'>): string[] {
  const urls: string[] = [];
  if (station.logoUrl !== null) urls.push(station.logoUrl);
  const icon = homepageIconUrl(station.homepage);
  if (icon !== null && !urls.includes(icon)) urls.push(icon);
  return urls;
}
