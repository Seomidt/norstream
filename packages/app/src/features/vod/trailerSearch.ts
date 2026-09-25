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
  items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string } }>;
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
    const titles = new Map<string, string>();
    for (const item of found.items ?? []) {
      const id = item.id?.videoId;
      if (id !== undefined && id.length > 0) titles.set(id, item.snippet?.title ?? '');
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
      candidates.push({ id, title: name, seconds: seconds.get(id) ?? 0 });
    }
    return pickTrailer(candidates, minSeconds, excludeId);
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

interface Renderer {
  videoId?: unknown;
  title?: { runs?: Array<{ text?: unknown }>; simpleText?: unknown };
  lengthText?: { simpleText?: unknown };
}

/**
 * Videoerne paa YouTubes soegeside, i YouTubes egen raekkefoelge.
 *
 * Siden bygges af et stort JSON-objekt (`ytInitialData`); hver video ligger
 * som en `videoRenderer`. Kan det ikke findes eller laeses, er svaret tomt —
 * soegningen er en reserve, og den maa aldrig blive til en fejl paa skaermen.
 */
export function parseYoutubeSearch(html: string): TrailerCandidate[] {
  const match = /ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(html);
  if (match === null) return [];
  let data: unknown;
  try {
    data = JSON.parse(match[1] ?? '');
  } catch {
    return [];
  }
  const out: TrailerCandidate[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > 40 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const renderer = record.videoRenderer as Renderer | undefined;
    if (renderer !== undefined && typeof renderer === 'object') {
      const id = typeof renderer.videoId === 'string' ? renderer.videoId : '';
      if (/^[A-Za-z0-9_-]{11}$/.test(id) && !seen.has(id)) {
        seen.add(id);
        const runs = renderer.title?.runs ?? [];
        const title =
          runs.map((run) => (typeof run.text === 'string' ? run.text : '')).join('') ||
          (typeof renderer.title?.simpleText === 'string' ? renderer.title.simpleText : '');
        const length = typeof renderer.lengthText?.simpleText === 'string' ? renderer.lengthText.simpleText : '';
        out.push({ id, title, seconds: parseClock(length) });
      }
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  walk(data, 0);
  return out;
}

/** Ord der betyder at videoen handler OM filmen, ikke er dens trailer. */
const NOT_A_TRAILER = /reaction|review|anmeldelse|explained|breakdown|fan ?made|parody|parodi|recap|ending|behind the scenes|full movie|hele filmen/i;

/**
 * De rigtige trailere blandt soegeresultaterne, bedste foerst: den rette
 * laengde (et til seks minutter), intet der ligner en anmeldelse eller en
 * reaktion, helst "trailer" i titlen og helst filmens eget navn i den.
 * YouTubes relevans-raekkefoelge bevares inden for hver gruppe.
 */
export function rankYoutubeTrailers(candidates: readonly TrailerCandidate[], title: string, limit = 5): TrailerCandidate[] {
  const name = title.toLowerCase().replace(/\s+/g, ' ').trim();
  const score = (candidate: TrailerCandidate): number => {
    const lower = candidate.title.toLowerCase();
    let value = lower.includes('trailer') ? 0 : lower.includes('teaser') ? 2 : 1;
    if (name.length > 0 && !lower.includes(name)) value += 3;
    return value;
  };
  return candidates
    .filter(
      (candidate) =>
        candidate.seconds >= MIN_TRAILER_SECONDS &&
        candidate.seconds <= MAX_TRAILER_SECONDS &&
        !NOT_A_TRAILER.test(candidate.title),
    )
    .map((candidate, index) => ({ candidate, index, score: score(candidate) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.candidate);
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
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(trailerQuery(title, year))}&hl=da&gl=DK`;
  let html: string | null;
  try {
    html = await fetchText(url, {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'da,en;q=0.8',
      Cookie: 'SOCS=CAI; CONSENT=YES+1',
    });
  } catch {
    return [];
  }
  if (html === null) return [];
  return rankYoutubeTrailers(parseYoutubeSearch(html), title);
}
