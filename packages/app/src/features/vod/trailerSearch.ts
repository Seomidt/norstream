import type { FetchLike } from '@norstream/core';

/**
 * En trailer kortere end det er en teaser. Panelet oplyser ét YouTube-id per
 * titel, og det er ikke altid en trailer: Spider-Man kom med et klip paa otte
 * sekunder. Under graensen ledes der videre efter en rigtig.
 */
export const MIN_TRAILER_SECONDS = 60;

export interface TrailerCandidate {
  id: string;
  title: string;
  seconds: number;
  channel?: string;
}

/** ISO 8601-varighed som YouTube skriver den: PT1M30S, PT2H, PT45S. Ugyldig giver 0. */
export function parseIsoDuration(iso: string): number {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso.trim());
  if (match === null) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

/** Hvad der soeges efter. Aarstallet skiller nyindspilninger fra originalen. */
export function trailerQuery(title: string, year: number | null): string {
  const cleaned = title.replace(/\s+/g, ' ').trim();
  return year === null ? `${cleaned} trailer` : `${cleaned} ${year} trailer`;
}

/** YouTubes egen soegeside, til naar der ikke er en API-noegle at soege med. */
export function youtubeSearchUrl(title: string, year: number | null): string {
  return `https://m.youtube.com/results?search_query=${encodeURIComponent(trailerQuery(title, year))}`;
}

/**
 * Vaelger den bedste af kandidaterne: lang nok, ikke den vi kom fra, og
 * helst en der kalder sig trailer frem for teaser. Rangfoelgen fra
 * soegningen bevares inden for hver gruppe — YouTube sorterer selv efter
 * relevans, og det er ikke noget vi goer bedre her.
 */
export function pickTrailer(
  candidates: readonly TrailerCandidate[],
  minSeconds: number,
  excludeId: string | null,
): TrailerCandidate | null {
  const longEnough = candidates.filter(
    (candidate) => candidate.seconds >= minSeconds && candidate.id !== excludeId,
  );
  const score = (candidate: TrailerCandidate): number => {
    const title = candidate.title.toLowerCase();
    if (title.includes('teaser')) return 2;
    if (title.includes('trailer')) return 0;
    return 1;
  };
  let best: TrailerCandidate | null = null;
  for (const candidate of longEnough) {
    if (best === null || score(candidate) < score(best)) best = candidate;
  }
  return best;
}

interface SearchResponse {
  items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }>;
}

interface VideosResponse {
  items?: Array<{ id?: string; contentDetails?: { duration?: string } }>;
}

/**
 * Finder en trailer paa mindst `minSeconds` gennem YouTubes Data API.
 *
 * To opkald: en soegning paa titel og aar, kun videoer der maa indlejres, og
 * derefter varigheden paa dem den fandt — soegningen selv oplyser ikke
 * varighed. Alt der gaar galt giver null; kalderen har en soegeside som
 * naeste udvej, og en fejl her maa ikke blive til en fejl paa skaermen.
 */
export async function findLongerTrailer(
  fetchImpl: FetchLike,
  apiKey: string,
  title: string,
  year: number | null,
  excludeId: string | null,
  minSeconds = MIN_TRAILER_SECONDS,
): Promise<TrailerCandidate | null> {
  try {
    const query = encodeURIComponent(trailerQuery(title, year));
    const key = encodeURIComponent(apiKey);
    const search = await fetchImpl(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=8&q=${query}&key=${key}`,
    );
    if (!search.ok) return null;
    const found = (await search.json()) as SearchResponse;
    const titles = new Map<string, { title: string; channel?: string }>();
    for (const item of found.items ?? []) {
      const id = item.id?.videoId;
      if (id !== undefined && id.length > 0) titles.set(id, { title: item.snippet?.title ?? '', ...(item.snippet?.channelTitle ? { channel: item.snippet.channelTitle } : {}) });
    }
    if (titles.size === 0) return null;

    const ids = [...titles.keys()].map(encodeURIComponent).join(',');
    const videos = await fetchImpl(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${key}`,
    );
    if (!videos.ok) return null;
    const detailed = (await videos.json()) as VideosResponse;
    const candidates: TrailerCandidate[] = [];
    // Raekkefoelgen fra soegningen, ikke fra varighedsopslaget.
    const seconds = new Map<string, number>();
    for (const item of detailed.items ?? []) {
      if (item.id !== undefined) seconds.set(item.id, parseIsoDuration(item.contentDetails?.duration ?? ''));
    }
    for (const [id, name] of titles) {
      candidates.push({ id, ...name, seconds: seconds.get(id) ?? 0 });
    }
    return pickTrailer(rankYoutubeTrailers(candidates, title, 8, year), minSeconds, excludeId);
  } catch {
    return null;
  }
}

/** Hent en side som tekst; null ved fejl. Gives med udefra, saa soegningen kan testes. */
export type FetchText = (url: string, headers: Record<string, string>) => Promise<string | null>;

/** Laengere end det er ikke en trailer, men et klip, en anmeldelse eller hele filmen. */
export const MAX_TRAILER_SECONDS = 6 * 60;

/** "2:31" eller "1:02:03" til sekunder. Ugyldig giver 0. */
export function parseClock(text: string): number {
  const parts = text.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return 0;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

interface YoutubeText { simpleText?: unknown; content?: unknown; runs?: Array<{ text?: unknown }> }
function youtubeText(value?: YoutubeText): string {
  if (typeof value?.simpleText === 'string') return value.simpleText;
  if (typeof value?.content === 'string') return value.content;
  return value?.runs?.map((run) => typeof run.text === 'string' ? run.text : '').join('') ?? '';
}
interface Renderer {
  videoId?: unknown;
  title?: { runs?: Array<{ text?: unknown }>; simpleText?: unknown };
  lengthText?: YoutubeText;
  headline?: YoutubeText;
  shortBylineText?: YoutubeText;
  ownerText?: YoutubeText;
  thumbnailOverlays?: Array<{ thumbnailOverlayTimeStatusRenderer?: { text?: YoutubeText } }>;
}

/**
 * Videoerne paa YouTubes soegeside, i YouTubes egen raekkefoelge.
 *
 * Siden bygges af et stort JSON-objekt (`ytInitialData`); hver video ligger
 * som en `videoRenderer`. Kan det ikke findes eller laeses, er svaret tomt —
 * soegningen er en reserve, og den maa aldrig blive til en fejl paa skaermen.
 */
export function parseYoutubeSearch(html: string): TrailerCandidate[] {
  const match = /(?:\bytInitialData|window\[['"]ytInitialData['"]\])\s*=\s*(\{)/.exec(html);
  if (match === null) return [];
  const start = match.index + match[0].length - 1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) { end = i + 1; break; }
  }
  if (end < 0) return [];
  let data: unknown;
  try {
    data = JSON.parse(html.slice(start, end));
  } catch {
    return [];
  }
  const out: TrailerCandidate[] = [];
  const seen = new Map<string, TrailerCandidate>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > 40 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const renderer = (record.videoRenderer ?? record.videoWithContextRenderer) as Renderer | undefined;
    if (renderer !== undefined && typeof renderer === 'object') {
      const id = typeof renderer.videoId === 'string' ? renderer.videoId : '';
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) {
        const title = youtubeText(renderer.title ?? renderer.headline);
        const length = youtubeText(renderer.lengthText) || renderer.thumbnailOverlays?.map((o) => youtubeText(o.thumbnailOverlayTimeStatusRenderer?.text)).find((t) => parseClock(t) > 0) || '';
        const channel = youtubeText(renderer.shortBylineText ?? renderer.ownerText);
        const prior = seen.get(id);
        if (prior === undefined) {
          const candidate = { id, title, seconds: parseClock(length), ...(channel ? { channel } : {}) };
          seen.set(id, candidate); out.push(candidate);
        } else {
          if (!prior.title) prior.title = title;
          if (!prior.seconds) prior.seconds = parseClock(length);
          if (!prior.channel && channel) prior.channel = channel;
        }
      }
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  walk(data, 0);
  return out;
}

/** Ord der betyder at videoen handler OM filmen, ikke er dens trailer. */
const NOT_A_TRAILER = /reaction|review|anmeldelse|explained|breakdown|fan ?made|parody|parodi|recap|ending|behind the scenes|full movie|hele filmen|\b(?:interview|scene|scenes|filmklip)\b/i;

/**
 * De rigtige trailere blandt soegeresultaterne, bedste foerst: den rette
 * laengde (et til seks minutter), intet der ligner en anmeldelse eller en
 * reaktion, helst "trailer" i titlen og helst filmens eget navn i den.
 * YouTubes relevans-raekkefoelge bevares inden for hver gruppe.
 */
/** Danske bogstaver og ASCII-titler skal kunne sammenlignes. */
function normalizeTitle(text: string): string {
  return text.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Et forsigtigt boejningsmatch: mindst to ord, kun eet afviger med slut-r/s. */
function titleMatch(name: string, candidate: string): 'exact' | 'ending' | null {
  const words = name.split(' ').filter((word) => word && word !== 'the');
  const found = candidate.split(' ');
  if (!words.length) return null;
  const missing = words.filter((word) => !found.includes(word));
  if (!missing.length) return 'exact';
  if (words.length < 2 || missing.length !== 1) return null;
  const word = missing[0]!;
  return word.length >= 5 && found.some((other) => other.length >= 4 &&
    (word === other + 'r' || other === word + 'r' || word === other + 's' || other === word + 's')) ? 'ending' : null;
}

/** Officielle distributoerer prioriteres; resten kan stadig have traileren. */
const DISTRIBUTOR = /^(?:nordisk film(?: distribution)?|sf studios|scanbox(?: entertainment)?|angel films|universal pictures|warner bros(?: pictures)?|sony pictures(?: entertainment)?|paramount pictures|walt disney studios|20th century studios|a24|lionsgate)$/;

export function rankYoutubeTrailers(candidates: readonly TrailerCandidate[], title: string, limit = 5, year: number | null = null): TrailerCandidate[] {
  const name = normalizeTitle(title);
  return candidates.flatMap((candidate, index) => {
    const normalized = normalizeTitle(candidate.title);
    const match = titleMatch(name, normalized);
    const trailer = /\btrailer\b/.test(normalized);
    // Ukendt laengde afgoeres af afspilleren. Titlen skal da sige trailer.
    if (match === null || (match === 'ending' && !trailer) || NOT_A_TRAILER.test(normalized.replace(name, '')) ||
      candidate.seconds < 0 || (candidate.seconds > 0 && candidate.seconds < MIN_TRAILER_SECONDS) ||
      candidate.seconds > MAX_TRAILER_SECONDS || (candidate.seconds === 0 && !trailer)) return [];
    // Undgaa efterfoelgere og en anden nyindspilning. "Trailer 2" er tilladt.
    const installment = /\b(?:part|chapter|del|episode) (?:one|two|three|four|five|six|seven|eight|nine|ten|i|ii|iii|iv|v|vi|vii|viii|ix|x|\d+)\b/.exec(normalized)?.[0];
    if (installment && !name.includes(installment)) return [];
    const identity = normalized.replace(/\b(?:teaser )?trailer(?: #?\d+)?\b/g, '');
    const numbers = identity.match(/\b\d+\b/g) ?? [];
    const nameNumbers: readonly string[] = name.match(/\b\d+\b/g) ?? [];
    if (numbers.some((n) => n.length === 4 ? year !== null && Number(n) !== year : !nameNumbers.includes(n))) return [];
    const official = DISTRIBUTOR.test(normalizeTitle(candidate.channel ?? ''));
    const score = (trailer ? 0 : 4) + (normalized.includes('teaser') ? 2 : 0) +
      (match === 'ending' ? 2 : 0) + (official ? -2 : 0) + (candidate.seconds === 0 ? 2 : 0);
    return [{ candidate, index, score }];
  }).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, limit).map((entry) => entry.candidate);
}

/** Aarstal kan skjule lokale trailere; boejningen fra panelet kan vaere forkert. */
export function trailerQueries(title: string, year: number | null): string[] {
  const cleaned = title.replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ');
  const last = words[words.length - 1] ?? '';
  const singular = words.length >= 2 && last.length >= 5 && /r$/i.test(last)
    ? [...words.slice(0, -1), last.slice(0, -1)].join(' ') : null;
  return [...new Set([trailerQuery(cleaned, year), trailerQuery(cleaned, null),
    ...(singular ? [trailerQuery(singular, null)] : [])])];
}

/**
 * Soeger trailere direkte paa YouTube — uden API-noegle.
 *
 * Til naar TMDB ikke kender titlen, eller dens trailere ikke kan vises her.
 * Samtykke-siden (EU) springes over med YouTubes eget samtykke-cookie, saa
 * svaret er soegesiden og ikke "Foer du fortsaetter til YouTube".
 */
export async function searchYoutubeTrailers(
  fetchText: FetchText,
  title: string,
  year: number | null,
): Promise<TrailerCandidate[]> {
  for (const query of trailerQueries(title, year)) {
    try {
      const html = await fetchText(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&gl=DK`, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'da,en;q=0.8',
        Cookie: 'SOCS=CAI; CONSENT=YES+1',
      });
      if (html === null) continue;
      const ranked = rankYoutubeTrailers(parseYoutubeSearch(html), title, 5, year);
      if (ranked.length > 0) return ranked;
    } catch { /* Naeste titelvariant kan stadig virke. */ }
  }
  return [];
}
