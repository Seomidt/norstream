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
