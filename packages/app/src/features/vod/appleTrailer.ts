/**
 * Trailere fra Apple TV (v336) — foerstevalg, brugerens eget valg.
 *
 * Brugeren fandt det: tv.apple.com viser trailerne uden login. Siden bruger
 * Apples "uts"-tjeneste. Maalt fra GitHubs maskine
 * (scripts/maal/appletv-trailer.mjs, appletv-struktur.mjs): soegningen svarer,
 * filmsiden har trailerne som almindelig HLS UDEN kopibeskyttelse (ingen
 * EXT-X-KEY / skd://), op til 4K; i fuld HD i biografformat (1918x802).
 *
 * Soegningen er upraecis ("Dune Part Two" gav Zero Dark Thirty, "Druk" gav
 * Argylle), og Apple kender filmene paa engelsk titel ("Another Round"). Derfor
 * soeges paa TMDB's engelske (og originale) titel, og en film bruges KUN naar
 * titel og aar passer. Ellers tager IMDb over.
 *
 * Parametrene er dem tv.apple.com selv sender. Aendrer Apple dem, svarer
 * soegningen ikke, og IMDb tager over — ret dem her (se maaleskripterne).
 */

export type GetJson = (url: string) => Promise<unknown>;

const BASE = 'https://tv.apple.com/api/uts/v3';
const PARAMS: Record<string, string> = {
  utscf: 'OjAAAAAAAAA~',
  utsk: '6e3013c6d6fae3c2::::::235656c069bb0efb',
  caller: 'web',
  sf: '143441',
  v: '68',
  pfm: 'web',
  locale: 'en-US',
};

/** Kortere end det er en teaser; laengere er ikke en trailer. */
const MIN_SECONDS = 60;
const MAX_SECONDS = 360;

export interface AppleTrailer {
  /** Apples id for traileren (umc.cmc.…). */
  id: string;
  name: string;
  seconds: number | null;
  /** HLS-hovedmanifestet. */
  url: string;
}

interface SearchItem {
  id?: string;
  type?: string;
  title?: string;
  releaseDate?: number;
}

interface CanvasItem {
  id?: string;
  title?: string;
  localizedType?: string;
  type?: string;
  playables?: Array<{ duration?: number; assets?: { hlsUrl?: string } }>;
}

function query(extra: Record<string, string> = {}): string {
  return Object.entries({ ...PARAMS, ...extra })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** Til sammenligning: smaa bogstaver, uden accenter, tegn og "the". */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9æøå]+/g, ' ')
    .replace(/^the /, '')
    .trim();
}

/** Den film/serie i soegesvaret der passer paa titel og aar (±1), eller null. */
export function matchSearch(
  data: unknown,
  kind: 'movie' | 'series',
  titles: readonly string[],
  year: number | null,
): SearchItem | null {
  const shelves = (data as { data?: { canvas?: { shelves?: Array<{ items?: SearchItem[] }> } } } | null)?.data?.canvas
    ?.shelves;
  if (!Array.isArray(shelves)) return null;
  const wanted = new Set(titles.map(normalizeTitle).filter((t) => t.length > 0));
  const type = kind === 'series' ? 'Show' : 'Movie';
  for (const shelf of shelves) {
    for (const item of shelf.items ?? []) {
      if (item.type !== type || typeof item.id !== 'string' || typeof item.title !== 'string') continue;
      if (!wanted.has(normalizeTitle(item.title))) continue;
      if (year !== null) {
        if (typeof item.releaseDate !== 'number') continue;
        const itemYear = new Date(item.releaseDate).getUTCFullYear();
        if (Math.abs(itemYear - year) > 1) continue;
      }
      return item;
    }
  }
  return null;
}

/** Trailerne paa en film-/serieside, bedste foerst (i Apples raekkefoelge, teasere fra). */
export function pickAppleTrailers(data: unknown): AppleTrailer[] {
  const shelves = (data as { data?: { canvas?: { shelves?: Array<{ items?: CanvasItem[] }> } } } | null)?.data?.canvas
    ?.shelves;
  if (!Array.isArray(shelves)) return [];
  const out: AppleTrailer[] = [];
  const seen = new Set<string>();
  for (const shelf of shelves) {
    for (const item of shelf.items ?? []) {
      if (item.localizedType !== 'Trailer' || typeof item.id !== 'string') continue;
      const playable = item.playables?.[0];
      const url = playable?.assets?.hlsUrl;
      if (typeof url !== 'string' || !url.startsWith('https://') || seen.has(url)) continue;
      const seconds = typeof playable?.duration === 'number' && playable.duration > 0 ? playable.duration : null;
      if (seconds !== null && (seconds < MIN_SECONDS || seconds > MAX_SECONDS)) continue;
      seen.add(url);
      out.push({ id: item.id, name: item.title ?? 'Trailer', seconds, url });
    }
  }
  return out;
}

/**
 * Apples trailere til titlen, eller en tom liste. `titles` er de titler der
 * soeges paa (engelsk foerst); `year` skal passe (±1) hvis den kendes.
 */
export async function findAppleTrailers(
  getJson: GetJson,
  kind: 'movie' | 'series',
  titles: readonly string[],
  year: number | null,
): Promise<AppleTrailer[]> {
  const unique = [...new Set(titles.map((t) => t.trim()).filter((t) => t.length > 0))];
  for (const term of unique) {
    let search: unknown;
    try {
      search = await getJson(`${BASE}/search?${query({ searchTerm: term })}`);
    } catch {
      continue;
    }
    const hit = matchSearch(search, kind, unique, year);
    if (hit === null || hit.id === undefined) continue;
    try {
      const page = await getJson(`${BASE}/${kind === 'series' ? 'shows' : 'movies'}/${encodeURIComponent(hit.id)}?${query()}`);
      return pickAppleTrailers(page);
    } catch {
      return [];
    }
  }
  return [];
}
