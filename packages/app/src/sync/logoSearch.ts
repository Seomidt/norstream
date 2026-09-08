import { deriveCountry } from '@norstream/core';
import type { FetchLikeResponse } from '@norstream/core';

/**
 * Logoer fra nettet til de kanaler intet arkiv kender.
 *
 * Foerste kilde er Wikidata: naesten enhver tv- og radiokanal af betydning
 * har et opslag der, og opslaget peger paa logoet paa Wikimedia Commons
 * (egenskab P154). Det er gratis, kraever ingen noegle, og svarer med rene
 * logoer — ikke skaermbilleder eller programplakater. Commons leverer en
 * PNG-udgave i den bredde man beder om, ogsaa af SVG-filer, som telefonen
 * ellers ikke kan tegne.
 *
 * Anden kilde, valgfri, er Googles billedsoegning gennem en Custom Search
 * Engine. Den finder mere, men rammer ogsaa ved siden af oftere, og den
 * kraever brugerens egen noegle. Derfor kommer den efter Wikidata og kun
 * naar noeglen er sat.
 */

export type LogoSearchFetch = (url: string) => Promise<FetchLikeResponse>;

export interface LogoCandidate {
  url: string;
  /** Hvad kilden kaldte opslaget, saa man kan se om det er den rigtige. */
  label: string;
  source: 'wikidata' | 'google';
}

export interface GoogleSearchKeys {
  key: string;
  /** Soegemaskinens id (cx). */
  cx: string;
}

export interface LogoSearchOptions {
  /** Kanalens navn som panelet skriver det. Renses her. */
  name: string;
  /** ISO 3166-1 alpha-2, eller tom. Vaelger sproget der soeges paa. */
  country: string;
  google?: GoogleSearchKeys | null;
}

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_FILE_PATH = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const GOOGLE_SEARCH = 'https://www.googleapis.com/customsearch/v1';
/** Bredden Commons bedes om. Nok til en liste og et afspillerbanner. */
export const LOGO_WIDTH = 400;
/** Hvor mange opslag fra Wikidata der ses paa per soegning. */
const WIKIDATA_LIMIT = 7;
const GOOGLE_LIMIT = 5;

/** Maerker der ikke er en del af navnet: kvalitet, kodning, backup-linjer. */
const QUALITY_WORDS = new Set([
  'HD', 'FHD', 'UHD', 'SD', '4K', '8K', 'HEVC', 'H265', 'H264', 'RAW', 'VIP', 'BACKUP', 'BK',
  'LQ', 'HQ', 'FULLHD', '1080P', '1080I', '720P', '576P', '50FPS', '60FPS', 'OPT', 'MULTI',
]);

/**
 * Det navn man selv ville skrive i en soegemaskine.
 *
 * `DNK| TV 2 Fri HD` -> `TV 2 Fri`. `DK: DR P3 (RADIO)` -> `DR P3`. Praefikset
 * foer den lodrette streg er panelets, landekoden foran er panelets, og
 * parenteser rummer det panelet vil sige om linjen, ikke kanalens navn.
 */
export function searchNameFor(channelName: string): string {
  let name = channelName;
  if (name.includes('|')) name = name.slice(name.lastIndexOf('|') + 1);
  // `DK: `, `DK - `, `DNK – ` — men kun naar bogstaverne faktisk er et land,
  // saa `DR - P3` beholder sit DR.
  const prefixed = /^\s*([A-Za-z]{2,3})\s*[:\-–]\s*(.+)$/u.exec(name);
  if (prefixed !== null && prefixed[1] !== undefined && prefixed[2] !== undefined) {
    if (deriveCountry(prefixed[1]) !== null) name = prefixed[2];
  }
  name = name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  return name
    .split(/\s+/)
    .filter((word) => word.length > 0 && !QUALITY_WORDS.has(word.toUpperCase()))
    .join(' ')
    .trim();
}

/** Sproget Wikidata soeges paa for et land. Engelsk naar landet ikke er kendt. */
const LANGUAGE_BY_COUNTRY: Record<string, string> = {
  DK: 'da', SE: 'sv', NO: 'nb', FI: 'fi', IS: 'is', DE: 'de', AT: 'de', CH: 'de', NL: 'nl',
  BE: 'nl', FR: 'fr', ES: 'es', PT: 'pt', BR: 'pt', IT: 'it', PL: 'pl', CZ: 'cs', SK: 'sk',
  HU: 'hu', RO: 'ro', GR: 'el', TR: 'tr', RU: 'ru', UA: 'uk', HR: 'hr', RS: 'sr', BG: 'bg',
  AR: 'es', MX: 'es', CL: 'es', CO: 'es',
};

export function wikidataLanguageFor(country: string): string {
  return LANGUAGE_BY_COUNTRY[country.trim().toUpperCase()] ?? 'en';
}

/**
 * Om et Wikidata-opslags beskrivelse lyder som en kanal.
 *
 * "TV 2 Fri" giver ogsaa personer, byer og film. Beskrivelsen ("dansk
 * tv-kanal", "Danish television channel", "radiostation") skiller dem fra.
 */
export function looksLikeChannel(description: string | undefined | null): boolean {
  if (description === undefined || description === null) return false;
  return /\b(tv|television|televisi|fernseh|fjernsyn|channel|kanal|chaîne|cadena|canal|canale|radio|broadcast|station|sender|zender)/iu.test(
    description,
  );
}

/** Adressen paa en fil paa Commons, i den bredde telefonen skal bruge. */
export function commonsFileUrl(fileName: string, width = LOGO_WIDTH): string {
  const bare = fileName.replace(/^File:/i, '').trim().replace(/ /g, '_');
  return `${COMMONS_FILE_PATH}${encodeURIComponent(bare)}?width=${width}`;
}

interface WikidataHit {
  id: string;
  label: string;
  description: string | undefined;
}

async function readJson(fetchImpl: LogoSearchFetch, url: string): Promise<unknown> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function searchEntities(fetchImpl: LogoSearchFetch, name: string, language: string): Promise<WikidataHit[]> {
  const url =
    `${WIKIDATA_API}?action=wbsearchentities&format=json&type=item&limit=${WIKIDATA_LIMIT}` +
    `&language=${encodeURIComponent(language)}&uselang=${encodeURIComponent(language)}` +
    `&search=${encodeURIComponent(name)}`;
  const body = (await readJson(fetchImpl, url)) as { search?: unknown } | null;
  if (body === null || !Array.isArray(body.search)) return [];
  const hits: WikidataHit[] = [];
  for (const entry of body.search as Array<Record<string, unknown>>) {
    if (typeof entry.id !== 'string') continue;
    hits.push({
      id: entry.id,
      label: typeof entry.label === 'string' ? entry.label : entry.id,
      description: typeof entry.description === 'string' ? entry.description : undefined,
    });
  }
  return hits;
}

/** Logofilen (P154) for hvert opslag der har én. Ét opkald for dem alle. */
async function logoClaims(fetchImpl: LogoSearchFetch, ids: string[]): Promise<Map<string, string>> {
  const url = `${WIKIDATA_API}?action=wbgetentities&format=json&props=claims&ids=${ids.join('|')}`;
  const body = (await readJson(fetchImpl, url)) as { entities?: Record<string, unknown> } | null;
  const files = new Map<string, string>();
  if (body === null || typeof body.entities !== 'object' || body.entities === null) return files;
  for (const [id, entity] of Object.entries(body.entities)) {
    const claims = (entity as { claims?: Record<string, unknown> }).claims;
    const logos = claims?.P154;
    if (!Array.isArray(logos)) continue;
    let chosen: string | null = null;
    for (const claim of logos as Array<Record<string, unknown>>) {
      if (claim.rank === 'deprecated') continue;
      const value = (claim.mainsnak as { datavalue?: { value?: unknown } } | undefined)?.datavalue?.value;
      if (typeof value !== 'string' || value.length === 0) continue;
      if (chosen === null || claim.rank === 'preferred') chosen = value;
      if (claim.rank === 'preferred') break;
    }
    if (chosen !== null) files.set(id, chosen);
  }
  return files;
}

/**
 * Wikidata: soeg paa navnet i kanalens eget sprog, saa paa engelsk; behold
 * de opslag der lyder som en kanal; tag det foerste der har et logo.
 */
export async function findWikidataLogo(
  fetchImpl: LogoSearchFetch,
  name: string,
  language: string,
): Promise<LogoCandidate | null> {
  if (name.trim().length === 0) return null;
  const languages = language === 'en' ? ['en'] : [language, 'en'];
  const seen = new Set<string>();
  for (const lang of languages) {
    const hits = (await searchEntities(fetchImpl, name, lang)).filter(
      (hit) => looksLikeChannel(hit.description) && !seen.has(hit.id),
    );
    if (hits.length === 0) continue;
    for (const hit of hits) seen.add(hit.id);
    const files = await logoClaims(
      fetchImpl,
      hits.map((hit) => hit.id),
    );
    for (const hit of hits) {
      const file = files.get(hit.id);
      if (file !== undefined) return { url: commonsFileUrl(file), label: hit.label, source: 'wikidata' };
    }
  }
  return null;
}

/** Billedtyper telefonen kan tegne. SVG og GIF er ude. */
const USABLE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Googles billedsoegning, med brugerens egen noegle. */
export async function findGoogleLogos(
  fetchImpl: LogoSearchFetch,
  keys: GoogleSearchKeys,
  name: string,
  limit = GOOGLE_LIMIT,
): Promise<LogoCandidate[]> {
  if (name.trim().length === 0 || keys.key.trim().length === 0 || keys.cx.trim().length === 0) return [];
  const url =
    `${GOOGLE_SEARCH}?key=${encodeURIComponent(keys.key.trim())}&cx=${encodeURIComponent(keys.cx.trim())}` +
    `&searchType=image&num=${limit}&q=${encodeURIComponent(`${name} logo`)}`;
  const body = (await readJson(fetchImpl, url)) as { items?: unknown } | null;
  if (body === null || !Array.isArray(body.items)) return [];
  const candidates: LogoCandidate[] = [];
  for (const item of body.items as Array<Record<string, unknown>>) {
    if (typeof item.link !== 'string' || !/^https?:\/\//i.test(item.link)) continue;
    if (typeof item.mime === 'string' && !USABLE_MIME.has(item.mime)) continue;
    candidates.push({
      url: item.link,
      label: typeof item.title === 'string' ? item.title : name,
      source: 'google',
    });
  }
  return candidates;
}

/**
 * Alle bud paa et logo, bedste foerst: Wikidata, saa Google naar noeglen er
 * sat. Den automatiske soegning tager det foerste; vaelgeren viser dem alle.
 */
export async function findLogoCandidates(
  fetchImpl: LogoSearchFetch,
  options: LogoSearchOptions,
): Promise<LogoCandidate[]> {
  const name = searchNameFor(options.name);
  if (name.length === 0) return [];
  const candidates: LogoCandidate[] = [];
  const fromWikidata = await findWikidataLogo(fetchImpl, name, wikidataLanguageFor(options.country));
  if (fromWikidata !== null) candidates.push(fromWikidata);
  if (options.google !== undefined && options.google !== null) {
    candidates.push(...(await findGoogleLogos(fetchImpl, options.google, name)));
  }
  return candidates;
}
