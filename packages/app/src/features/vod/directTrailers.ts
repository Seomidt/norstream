import { findAppleTrailers, normalizeTitle, type GetJson } from './appleTrailer.js';
import { findImdbTrailers, type PostJson } from './imdbTrailer.js';
import { buildHlsMaster } from './trailerHls.js';

interface Requests {
  getJson: GetJson;
  getText: (url: string) => Promise<string | null>;
  postJson: PostJson;
}
export interface DirectTrailer {
  id: string;
  url: string;
  playlist: string | null;
  seconds: number | null;
  contentType: 'hls' | 'progressive';
  provider: 'Apple TV' | 'IMDb';
  height: number;
  imdbTitleId?: string;
}

/** Panelet kan have en slut-r for meget (Vores loefter). Kun et helt titelmatch bruges. */
export function directTitleAliases(titles: readonly string[]): string[] {
  return [...new Set(titles.flatMap((title) => {
    const words = title.trim().split(/\s+/);
    const last = words.at(-1) ?? '';
    return words.length >= 2 && last.length >= 5 && /r$/i.test(last)
      ? [title.trim(), [...words.slice(0, -1), last.slice(0, -1)].join(' ')] : [title.trim()];
  }).filter(Boolean))].slice(0, 6);
}

/** IMDb-nummer uden TMDB-noegle. Personer, forkert aar og tvetydige titler afvises. */
export async function findImdbTitle(getJson: GetJson, kind: 'movie' | 'series', titles: readonly string[], year: number | null): Promise<string | null> {
  const wanted = new Set(titles.map(normalizeTitle));
  const results = await Promise.all(titles.map(async (title) => {
    try {
      const response = await getJson(`https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(title[0]?.toLowerCase() ?? '_')}/${encodeURIComponent(title)}.json`);
      const items = (response as { d?: Array<{ id?: string; l?: string; y?: number; qid?: string }> } | null)?.d;
      if (!Array.isArray(items)) return null;
      const ids = [...new Set(items.filter((item) => typeof item.id === 'string' && /^tt\d{5,}$/.test(item.id) &&
        typeof item.l === 'string' && wanted.has(normalizeTitle(item.l)) &&
        (kind === 'movie' ? item.qid === 'movie' : item.qid === 'tvSeries' || item.qid === 'tvMiniSeries') &&
        (year === null || item.y === year)).map((item) => item.id!))];
      if (ids.length === 1) return ids[0]!;
    } catch { /* Fejl i et alias maa ikke blokere de andre. */ }
    return null;
  }));
  return results.find((id) => id !== null) ?? null;
}

function hasEncryption(text: string): boolean {
  return text.split(/\r?\n/).filter((line) => /^#EXT-X-(?:SESSION-)?KEY:/.test(line))
    .some((line) => !/(?:^|[:,])METHOD=NONE(?:,|$)/.test(line));
}

/** Kun en komplet, ubeskyttet trailer paa 1-6 minutter. Ingen DRM-omgaaelse. */
export function hlsTrailerSeconds(text: string): number | null {
  if (!text.trimStart().startsWith('#EXTM3U') || !text.includes('#EXT-X-ENDLIST')) return null;
  if (hasEncryption(text)) return null;
  const seconds = [...text.matchAll(/^#EXTINF:([\d.]+)/gm)].reduce((sum, match) => sum + Number(match[1]), 0);
  return Number.isFinite(seconds) && seconds >= 60 && seconds <= 360 ? seconds : null;
}

export async function prepareDirectHls(getText: Requests['getText'], url: string): Promise<{ playlist: string; height: number; seconds: number } | null> {
  try {
    const master = await getText(url);
    if (master !== null && hasEncryption(master)) return null;
    const built = master === null ? null : buildHlsMaster(master, url, 1080, true);
    if (built === null) return null;
    const audioUrls = [...built.playlist.matchAll(/^#EXT-X-MEDIA:.*URI="([^"]+)"/gm)].map((match) => match[1]!);
    // Apple sender lyd separat. Et valgt separat lydspor skal ogsaa kunne hentes.
    const media = await Promise.all([built.firstUri, ...audioUrls].map(getText));
    if (media.some((text) => text === null || hlsTrailerSeconds(text) === null)) return null;
    const seconds = hlsTrailerSeconds(media[0]!);
    if (seconds === null) return null;
    if (media.slice(1).some((text) => Math.abs(hlsTrailerSeconds(text!)! - seconds) > 2)) return null;
    return { playlist: built.playlist, height: built.height, seconds };
  } catch { return null; }
}

/** En afgraenset koe af direkte HD-kilder; ingen YouTube-kald eller webafspiller. */
export async function findDirectTrailers(requests: Requests, kind: 'movie' | 'series', titles: readonly string[], year: number | null, knownImdbId: string | null): Promise<DirectTrailer[]> {
  const aliases = directTitleAliases(titles);
  const [apple, imdb] = await Promise.all([
    findAppleTrailers(requests.getJson, kind, aliases, year),
    (async () => {
      const id = knownImdbId ?? await findImdbTitle(requests.getJson, kind, aliases, year);
      return { id, trailers: id === null ? [] : await findImdbTrailers(requests.postJson, id) };
    })(),
  ]);
  const prepared = await Promise.all(apple.slice(0, 3).map(async (video): Promise<DirectTrailer | null> => {
    const hls = await prepareDirectHls(requests.getText, video.url);
    return hls === null ? null : { id: video.id, url: video.url, ...hls, provider: 'Apple TV', contentType: 'hls' };
  }));
  const out = prepared.filter((trailer): trailer is DirectTrailer => trailer !== null);
  for (const video of imdb.trailers.filter((video) => video.contentType === 'progressive' && video.height >= 720).slice(0, 3)) {
    out.push({ id: video.videoId, url: video.url, playlist: null, seconds: video.seconds, height: video.height,
      provider: 'IMDb', contentType: 'progressive', imdbTitleId: imdb.id ?? undefined });
  }
  return out;
}
