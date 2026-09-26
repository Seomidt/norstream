/**
 * Trailere fra IMDb i stedet for YouTube (v335).
 *
 * YouTube udleverer kun det foerste ca. minut af videofilen til andre end
 * deres egen afspiller (se youtubeStream.ts og OVERDRAGELSE v331–v334), og
 * deres egen afspiller er langsom og uskarp paa tv-boksen. IMDb (Amazon) har
 * de officielle trailere til naesten alle film og serier og udleverer dem som
 * almindelige videofiler i op til 1080p til enhver browser — ingen
 * robot-bevis, ingen graense. Maalt fra GitHubs maskine
 * (scripts/maal/imdb-trailer.mjs): Dune: Part Two og Oppenheimer i 1080p,
 * hele filen hentet paa 1–4 s, alle svar 200/206.
 *
 * Opslaget er det IMDbs egen hjemmeside bruger (deres offentlige GraphQL).
 * IMDbs titelsider har en udfordring (svar 202) — dem bruger vi ikke, og vi
 * proever ikke at komme uden om den.
 */

/** POST af JSON; svarer null ved netfejl eller et svar der ikke er JSON. */
export type PostJson = (url: string, headers: Record<string, string>, body: string) => Promise<unknown>;

const GRAPHQL_URL = 'https://api.graphql.imdb.com/';
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-imdb-client-name': 'imdb-web-next',
  'Accept-Language': 'en-US',
};
const QUERY =
  'query T($id: ID!) { title(id: $id) { primaryVideos(first: 10) { edges { node { id name { value } runtime { value } ' +
  'contentType { displayName { value } } playbackURLs { displayName { value } videoMimeType url } } } } } }';

/** Kortere end det er en teaser; laengere er ikke en trailer. */
const MIN_SECONDS = 60;
const MAX_SECONDS = 360;
/** Fuld HD er loftet, som for YouTube. */
const MAX_HEIGHT = 1080;

export interface ImdbTrailer {
  /** IMDbs video-id (vi…). */
  videoId: string;
  name: string;
  seconds: number | null;
  /** MP4-filen, bedste op til 1080p. */
  url: string;
  height: number;
}

interface PlaybackUrl {
  displayName?: { value?: string };
  videoMimeType?: string;
  url?: string;
}

interface VideoNode {
  id?: string;
  name?: { value?: string };
  runtime?: { value?: number };
  contentType?: { displayName?: { value?: string } };
  playbackURLs?: PlaybackUrl[];
}

/** "1080p" -> 1080; "SD" -> 360; ukendt -> 0. */
function heightOf(label: string | undefined): number {
  const match = /^(\d{3,4})p$/i.exec(label ?? '');
  if (match !== null) return Number(match[1]);
  return (label ?? '').toUpperCase() === 'SD' ? 360 : 0;
}

/** Den bedste MP4 op til 1080p, eller null. */
export function pickImdbFile(urls: readonly PlaybackUrl[]): { url: string; height: number } | null {
  const files = urls
    .filter((u) => u.videoMimeType === 'MP4' && typeof u.url === 'string' && u.url.startsWith('https://'))
    .map((u) => ({ url: u.url as string, height: heightOf(u.displayName?.value) }))
    .filter((f) => f.height > 0 && f.height <= MAX_HEIGHT)
    .sort((a, b) => b.height - a.height);
  return files[0] ?? null;
}

/**
 * Titlens trailere hos IMDb, bedste foerst: kun "Trailer" (ikke klip), mellem
 * et og seks minutter, i IMDbs egen raekkefoelge — "Official Trailer" foer de
 * andre. Tom liste ved alt der ikke gaar.
 */
export function pickImdbTrailers(nodes: readonly VideoNode[]): ImdbTrailer[] {
  const out: Array<ImdbTrailer & { official: boolean; order: number }> = [];
  nodes.forEach((node, order) => {
    if (node.contentType?.displayName?.value !== 'Trailer') return;
    const seconds = typeof node.runtime?.value === 'number' ? node.runtime.value : null;
    if (seconds !== null && (seconds < MIN_SECONDS || seconds > MAX_SECONDS)) return;
    const file = pickImdbFile(node.playbackURLs ?? []);
    if (file === null || typeof node.id !== 'string' || !/^vi\d+$/.test(node.id)) return;
    const name = node.name?.value ?? 'Trailer';
    out.push({ videoId: node.id, name, seconds, url: file.url, height: file.height, official: /official/i.test(name), order });
  });
  out.sort((a, b) => Number(b.official) - Number(a.official) || a.order - b.order);
  return out.map(({ official: _official, order: _order, ...trailer }) => trailer);
}

/** Alle brugbare trailere for et IMDb-nummer (tt…). */
export async function findImdbTrailers(post: PostJson, imdbId: string): Promise<ImdbTrailer[]> {
  if (!/^tt\d{5,}$/.test(imdbId)) return [];
  let response: unknown;
  try {
    response = await post(GRAPHQL_URL, HEADERS, JSON.stringify({ query: QUERY, variables: { id: imdbId } }));
  } catch {
    return [];
  }
  const edges = (response as { data?: { title?: { primaryVideos?: { edges?: Array<{ node?: VideoNode }> } } } } | null)?.data
    ?.title?.primaryVideos?.edges;
  if (!Array.isArray(edges)) return [];
  return pickImdbTrailers(edges.map((edge) => edge.node ?? {}));
}
