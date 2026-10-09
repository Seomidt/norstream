/**
 * Direkte Apple-trailere. Native-kataloget (pfm=appletv) indeholder lejefilm;
 * web-kataloget oversaa bl.a. Vores loefte og Oppenheimer 6. oktober 2026.
 * Danmark foerst, USA som reserve. Titel og aar skal altid passe.
 */

export type GetJson = (url: string) => Promise<unknown>;

const BASE = 'https://uts-api.itunes.apple.com/uts/v3';
const PARAMS: Record<string, string> = {
  utscf: 'OjAAAAEAAAAAAAMAEAAAACMAKwAtADgA',
  utsk: '6e3013c6d6fae3c2::::::235656c069bb0efb',
  caller: 'web',
  sf: '143458',
  v: '100',
  pfm: 'appletv',
  locale: 'da-DK',
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
  const out: AppleTrailer[] = [];
  const seen = new Set<string>();
  for (const shelf of Array.isArray(shelves) ? shelves : []) {
    for (const item of shelf.items ?? []) {
      if (item.localizedType !== 'Trailer' || typeof item.id !== 'string') continue;
      const playable = item.playables?.find((p) => p.assets?.hlsUrl?.startsWith('https://'));
      const url = playable?.assets?.hlsUrl;
      if (typeof url !== 'string' || !url.startsWith('https://') || seen.has(url)) continue;
      const seconds = typeof playable?.duration === 'number' && playable.duration > 0 ? playable.duration : null;
      if (seconds !== null && (seconds < MIN_SECONDS || seconds > MAX_SECONDS)) continue;
      seen.add(url);
      out.push({ id: item.id, name: item.title ?? 'Trailer', seconds, url });
    }
  }
  if (out.length > 0) return out;
  // Nogle filmsider har kun movieClips i playables, ingen Trailer-hylde.
  // Kun den allerede titel/aar-matchede side laeses; ikke relaterede film.
  const playables = (data as { data?: { playables?: Record<string, { itunesMediaApiData?: { movieClips?: Array<{ title?: string; hlsUrl?: string; durationInMilliseconds?: number }> } }> } } | null)?.data?.playables;
  for (const playable of Object.values(playables ?? {})) {
    for (const clip of playable.itunesMediaApiData?.movieClips ?? []) {
      const url = clip.hlsUrl;
      const seconds = typeof clip.durationInMilliseconds === 'number' ? clip.durationInMilliseconds / 1000 : null;
      if (typeof url !== 'string' || !url.startsWith('https://') || seen.has(url)) continue;
      if (!/trailer/i.test(clip.title ?? '') || (seconds !== null && (seconds < MIN_SECONDS || seconds > MAX_SECONDS))) continue;
      seen.add(url);
      out.push({ id: `clip-${out.length}`, name: clip.title ?? 'Trailer', seconds, url });
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
  for (const region of [{ sf: '143458', locale: 'da-DK' }, { sf: '143441', locale: 'en-US' }]) {
    // Alias-opslag er uafhaengige; et langsomt svar maa ikke give tre ventetider.
    const hits = await Promise.all(unique.map(async (term) => {
      try { return matchSearch(await getJson(`${BASE}/search?${query({ ...region, searchTerm: term })}`), kind, unique, year); }
      catch { return null; }
    }));
    const ids = [...new Set(hits.map((hit) => hit?.id).filter((id): id is string => typeof id === 'string'))];
    for (const id of ids) {
      try {
        const page = await getJson(`${BASE}/${kind === 'series' ? 'shows' : 'movies'}/${encodeURIComponent(id)}?${query(region)}`);
        const trailers = pickAppleTrailers(page);
        if (trailers.length > 0) return trailers;
      } catch { /* Naeste matchede titel eller region. */ }
    }
  }
  return [];
}
