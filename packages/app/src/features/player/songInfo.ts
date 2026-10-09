import { useEffect, useState } from 'react';

/**
 * Lidt om sangen der spiller: album, aar og genre fra iTunes, og et par
 * linjer fra Wikipedia om sangen, ellers om kunstneren. Ingen noegler.
 * Svar huskes per sang, ogsaa "intet fundet", saa den samme sang ikke
 * koster flere opslag. Alt er ren beregning her ud over de to hentninger.
 */
export interface SongInfo {
  album: string | null;
  year: number | null;
  genre: string | null;
  /** Et par linjer fra Wikipedia. */
  about: string | null;
  /** Om linjerne handler om sangen eller om kunstneren. */
  aboutOf: 'song' | 'artist' | null;
}

export const EMPTY_INFO: SongInfo = { album: null, year: null, genre: null, about: null, aboutOf: null };

const USER_AGENT = 'NorStream/1.0 (Android; +https://github.com/Seomidt/norstream)';
const cache = new Map<string, SongInfo>();

/** "(Remastered)" og "[Radio Edit]" forstyrrer soegningen. */
export function cleanTrack(track: string): string {
  const cleaned = track.replace(/\s*[([].*?[)\]]/g, '').trim();
  return cleaned.length > 0 ? cleaned : track;
}

export function itunesUrl(artist: string, track: string): string {
  const term = encodeURIComponent(`${artist} ${cleanTrack(track)}`);
  return `https://itunes.apple.com/search?term=${term}&entity=song&limit=3&country=dk`;
}

/** Album, aar og genre ud af iTunes' svar; null-felter naar de mangler. */
export function parseItunes(body: string): Pick<SongInfo, 'album' | 'year' | 'genre'> {
  try {
    const parsed = JSON.parse(body) as {
      results?: Array<{ collectionName?: unknown; releaseDate?: unknown; primaryGenreName?: unknown }>;
    };
    const first = (parsed.results ?? [])[0];
    if (first === undefined) return { album: null, year: null, genre: null };
    const year = typeof first.releaseDate === 'string' ? Number.parseInt(first.releaseDate.slice(0, 4), 10) : Number.NaN;
    return {
      album: typeof first.collectionName === 'string' && first.collectionName.length > 0 ? first.collectionName : null,
      year: Number.isFinite(year) && year > 1900 ? year : null,
      genre: typeof first.primaryGenreName === 'string' && first.primaryGenreName.length > 0 ? first.primaryGenreName : null,
    };
  } catch {
    return { album: null, year: null, genre: null };
  }
}

export function wikiSearchUrl(lang: string, query: string): string {
  return `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${encodeURIComponent(query)}`;
}

export function wikiSummaryUrl(lang: string, title: string): string {
  return `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/**
 * Den foerste artikel i soegningen hvis titel ligner det vi leder efter.
 * Wikipedias soegning giver gerne noget der bare deler et ord; artiklen
 * om sangen skal have sangens titel i navnet, og om kunstneren
 * kunstnerens navn.
 */
export function pickWikiTitle(body: string, mustContain: string): string | null {
  try {
    const parsed = JSON.parse(body) as { query?: { search?: Array<{ title?: unknown }> } };
    const needle = mustContain.toLowerCase();
    for (const hit of parsed.query?.search ?? []) {
      if (typeof hit.title === 'string' && hit.title.toLowerCase().includes(needle)) return hit.title;
    }
  } catch {
    // Ikke JSON.
  }
  return null;
}

/** Resumeet af en artikel, kortet til et par saetninger; null for flertydige sider og tomme svar. */
export function parseWikiSummary(body: string, maxChars = 420): string | null {
  try {
    const parsed = JSON.parse(body) as { type?: unknown; extract?: unknown };
    if (parsed.type === 'disambiguation') return null;
    if (typeof parsed.extract !== 'string') return null;
    const text = parsed.extract.replace(/\s+/g, ' ').trim();
    if (text.length === 0) return null;
    if (text.length <= maxChars) return text;
    const cut = text.slice(0, maxChars);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    return (end > 120 ? cut.slice(0, end + 1) : `${cut.trim()} …`).trim();
  } catch {
    return null;
  }
}

async function getText(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/** Foerst dansk, saa engelsk; foerst sangen, saa kunstneren. */
async function aboutFor(artist: string, track: string, signal: AbortSignal): Promise<Pick<SongInfo, 'about' | 'aboutOf'>> {
  const song = cleanTrack(track);
  const attempts: Array<{ lang: string; query: string; mustContain: string; of: 'song' | 'artist' }> = [
    { lang: 'da', query: `${song} ${artist} sang`, mustContain: song, of: 'song' },
    { lang: 'en', query: `${song} ${artist} song`, mustContain: song, of: 'song' },
    { lang: 'da', query: artist, mustContain: artist, of: 'artist' },
    { lang: 'en', query: artist, mustContain: artist, of: 'artist' },
  ];
  for (const attempt of attempts) {
    const search = await getText(wikiSearchUrl(attempt.lang, attempt.query), signal);
    if (search === null) continue;
    const title = pickWikiTitle(search, attempt.mustContain);
    if (title === null) continue;
    const summary = await getText(wikiSummaryUrl(attempt.lang, title), signal);
    const about = summary === null ? null : parseWikiSummary(summary);
    if (about !== null) return { about, aboutOf: attempt.of };
  }
  return { about: null, aboutOf: null };
}

export async function lookupSongInfo(artist: string, track: string, signal: AbortSignal): Promise<SongInfo> {
  const key = `${artist.toLowerCase()}|${track.toLowerCase()}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  const itunesBody = await getText(itunesUrl(artist, track), signal);
  const meta = itunesBody === null ? { album: null, year: null, genre: null } : parseItunes(itunesBody);
  const about = await aboutFor(artist, track, signal);
  const info: SongInfo = { ...meta, ...about };
  if (cache.size > 200) cache.clear();
  cache.set(key, info);
  return info;
}

/** Oplysningerne for den sang der spiller; EMPTY_INFO indtil de er hentet, og naar intet spiller. */
export function useSongInfo(artist: string | null, track: string | null): SongInfo {
  const [info, setInfo] = useState<SongInfo>(EMPTY_INFO);
  useEffect(() => {
    setInfo(EMPTY_INFO);
    if (artist === null || track === null) return;
    const controller = new AbortController();
    let cancelled = false;
    void lookupSongInfo(artist, track, controller.signal).then((found) => {
      if (!cancelled) setInfo(found);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [artist, track]);
  return info;
}
