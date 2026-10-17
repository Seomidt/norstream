/**
 * Genrer paa tvaers af kilder (v367).
 *
 * Panelet har ingen genre paa listen, kun paa den enkelte titel naar den
 * aabnes. Men kategorinavnene baerer tit genren ("DNK| Thriller", "EN -
 * ACTION"), og TMDB giver genre-id'er ved samme opslag som plakaten. Her er
 * den ene liste de alle oversaettes til, saa filteret under Film kan sige
 * "thriller" uanset hvor ordet kom fra.
 */
export type GenreKey =
  | 'action'
  | 'eventyr'
  | 'animation'
  | 'komedie'
  | 'krimi'
  | 'dokumentar'
  | 'drama'
  | 'familie'
  | 'fantasy'
  | 'historie'
  | 'gyser'
  | 'musik'
  | 'mysterie'
  | 'romantik'
  | 'scifi'
  | 'thriller'
  | 'krig'
  | 'western'
  | 'boern';

export interface Genre {
  key: GenreKey;
  name: string;
  /** Smaa bogstaver; rammer som delstreng i kategorinavne og panelets genretekst. */
  patterns: readonly string[];
  /** TMDB's id'er, film og serier. */
  tmdb: readonly number[];
}

export const GENRES: readonly Genre[] = [
  { key: 'action', name: 'Action', patterns: ['action'], tmdb: [28, 10759] },
  { key: 'thriller', name: 'Thriller', patterns: ['thriller', 'spaending', 'spænding', 'suspense'], tmdb: [53] },
  { key: 'komedie', name: 'Komedie', patterns: ['komedie', 'comed', 'stand-up', 'standup', 'sitcom'], tmdb: [35] },
  { key: 'drama', name: 'Drama', patterns: ['drama'], tmdb: [18] },
  { key: 'krimi', name: 'Krimi', patterns: ['krimi', 'crime'], tmdb: [80] },
  { key: 'gyser', name: 'Gyser', patterns: ['gyser', 'horror', 'skraek', 'skræk'], tmdb: [27] },
  { key: 'romantik', name: 'Romantik', patterns: ['romantik', 'romantic', 'romance', 'kaerlighed', 'kærlighed'], tmdb: [10749] },
  { key: 'scifi', name: 'Science fiction', patterns: ['sci-fi', 'scifi', 'science fiction', 'science-fiction'], tmdb: [878, 10765] },
  { key: 'fantasy', name: 'Fantasy', patterns: ['fantasy'], tmdb: [14] },
  { key: 'eventyr', name: 'Eventyr', patterns: ['eventyr', 'adventure'], tmdb: [12] },
  { key: 'animation', name: 'Animation', patterns: ['animation', 'animeret', 'anime', 'tegnefilm', 'cartoon'], tmdb: [16] },
  { key: 'familie', name: 'Familie', patterns: ['familie', 'family'], tmdb: [10751] },
  { key: 'boern', name: 'Børn', patterns: ['boern', 'børn', 'kids', 'children', 'barn'], tmdb: [10762] },
  { key: 'dokumentar', name: 'Dokumentar', patterns: ['dokumentar', 'documentar', 'documentary', 'docu'], tmdb: [99] },
  { key: 'historie', name: 'Historie', patterns: ['histori', 'history'], tmdb: [36] },
  { key: 'krig', name: 'Krig', patterns: ['krig', 'war'], tmdb: [10752, 10768] },
  { key: 'western', name: 'Western', patterns: ['western'], tmdb: [37] },
  { key: 'mysterie', name: 'Mysterie', patterns: ['mysterie', 'mystery'], tmdb: [9648] },
  { key: 'musik', name: 'Musik', patterns: ['musik', 'music', 'musical', 'koncert', 'concert'], tmdb: [10402] },
];

const BY_KEY = new Map(GENRES.map((genre) => [genre.key, genre]));
const BY_TMDB = new Map<number, GenreKey>();
for (const genre of GENRES) for (const id of genre.tmdb) BY_TMDB.set(id, genre.key);

export function genreByKey(key: string): Genre | null {
  return BY_KEY.get(key as GenreKey) ?? null;
}

export function isGenreKey(value: string): value is GenreKey {
  return BY_KEY.has(value as GenreKey);
}

/**
 * Genrer naevnt i en tekst — et kategorinavn ("DNK| Action & Thriller") eller
 * panelets genrefelt ("Action, Thriller"). Ordgraenser er for loese paa
 * tvaers af sprog; delstrenge med nogle faa undtagelser er nok.
 */
export function genresInText(text: string | null | undefined): GenreKey[] {
  if (text === null || text === undefined) return [];
  const lower = text.toLowerCase();
  if (lower.length === 0) return [];
  const out: GenreKey[] = [];
  for (const genre of GENRES) {
    if (genre.patterns.some((pattern) => matches(lower, pattern))) out.push(genre.key);
  }
  return out;
}

function matches(lower: string, pattern: string): boolean {
  const at = lower.indexOf(pattern);
  if (at < 0) return false;
  // "war" rammer ellers "award" og "warner"; korte ord skal begynde et ord,
  // og de helt korte ogsaa slutte et. "Krigsfilm" og "Boernefilm" taeller.
  if (pattern.length <= 4) {
    const before = at === 0 ? ' ' : lower[at - 1] ?? ' ';
    if (/[a-zæøå0-9]/.test(before)) return false;
    if (pattern.length <= 3) {
      const after = lower[at + pattern.length] ?? ' ';
      if (/[a-zæøå0-9]/.test(after)) return false;
    }
  }
  return true;
}

/** TMDB's genre-id'er til appens noegler, uden gentagelser. */
export function genresFromTmdbIds(ids: readonly number[] | undefined): GenreKey[] {
  if (ids === undefined) return [];
  const out: GenreKey[] = [];
  for (const id of ids) {
    const key = BY_TMDB.get(id);
    if (key !== undefined && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Lagringsform: ",action,thriller," — med komma i begge ender, saa SQL kan
 * spoerge med LIKE '%,thriller,%' uden at "krig" rammer "krigsdrama".
 */
export function packGenres(keys: readonly GenreKey[]): string | null {
  if (keys.length === 0) return null;
  return `,${[...new Set(keys)].join(',')},`;
}

export function unpackGenres(packed: string | null | undefined): GenreKey[] {
  if (packed === null || packed === undefined) return [];
  return packed.split(',').filter(isGenreKey);
}
