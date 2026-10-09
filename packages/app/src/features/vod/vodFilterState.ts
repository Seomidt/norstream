import type { VodKind } from '@norstream/core';
import { isGenreKey } from '../../storage/genres.js';
import type { GenreKey } from '../../storage/genres.js';
import { getSetting, setSetting } from '../../storage/settings.js';
import type { SqlDatabase } from '../../storage/types.js';
import type { VodFilter, VodSort } from '../../storage/vod.js';

/**
 * Udvalget under Film/Serier huskes per slags (v367), saa "thriller, 2026,
 * DK + UK + US" staar der igen naeste gang. Gemt som JSON i settings.
 */
const KEY = (kind: VodKind): string => `vod_filter:${kind}`;

export function defaultVodFilter(kind: VodKind): VodFilter {
  return { kind, countries: [], genres: [], yearFrom: null, yearTo: null, sort: 'newest', providers: [] };
}

const SORTS: readonly VodSort[] = ['newest', 'rating', 'year', 'title'];

export async function loadVodFilter(db: SqlDatabase, kind: VodKind): Promise<VodFilter> {
  const raw = await getSetting(db, KEY(kind));
  if (raw === null) return defaultVodFilter(kind);
  try {
    const parsed = JSON.parse(raw) as Partial<VodFilter>;
    return {
      kind,
      countries: Array.isArray(parsed.countries) ? parsed.countries.filter((c): c is string => typeof c === 'string') : [],
      genres: Array.isArray(parsed.genres) ? parsed.genres.filter((g): g is GenreKey => typeof g === 'string' && isGenreKey(g)) : [],
      yearFrom: typeof parsed.yearFrom === 'number' ? parsed.yearFrom : null,
      yearTo: typeof parsed.yearTo === 'number' ? parsed.yearTo : null,
      sort: typeof parsed.sort === 'string' && SORTS.includes(parsed.sort) ? parsed.sort : 'newest',
      providers: Array.isArray(parsed.providers) ? parsed.providers.filter((p): p is number => typeof p === 'number') : [],
    };
  } catch {
    return defaultVodFilter(kind);
  }
}

export async function saveVodFilter(db: SqlDatabase, filter: VodFilter): Promise<void> {
  // `keys` er tjeneste-opslagets svar og huskes ikke; det slaas op igen.
  const { kind, keys: _keys, search: _search, ...rest } = filter;
  await setSetting(db, KEY(kind), JSON.stringify(rest));
}

export interface YearChoice {
  label: string;
  from: number | null;
  to: number | null;
}

/** Aarene som knapper: de tre seneste hver for sig, saa i spring. */
export function yearChoices(now: Date = new Date()): YearChoice[] {
  const y = now.getFullYear();
  const recent = Array.from({ length: 17 }, (_, index) => y - index);
  const firstDecade = Math.floor((recent[recent.length - 1]! - 1) / 10) * 10;
  const decades = Array.from({ length: Math.max(0, (firstDecade - 1900) / 10 + 1) }, (_, index) => firstDecade - index * 10);
  return [
    { label: 'Alle år', from: null, to: null },
    { label: `2020–${y}`, from: 2020, to: y },
    ...recent.map((year) => ({ label: String(year), from: year, to: year })),
    ...decades.map((year) => ({ label: `${year}–${year + 9}`, from: year, to: year + 9 })),
    { label: 'Før 1900', from: null, to: 1899 },
  ];
}

export const SORT_LABELS: Record<VodSort, string> = {
  newest: 'Nyeste tilføjet',
  rating: 'Bedst bedømt',
  year: 'Nyeste udgivelse',
  title: 'Titel',
};

export function yearLabel(filter: VodFilter, choices: YearChoice[] = yearChoices()): string {
  const match = choices.find((c) => c.from === filter.yearFrom && c.to === filter.yearTo);
  if (match !== undefined) return match.label;
  if (filter.yearFrom === null && filter.yearTo === null) return 'Alle år';
  if (filter.yearFrom !== null && filter.yearTo !== null) return filter.yearFrom === filter.yearTo ? String(filter.yearFrom) : `${filter.yearFrom}–${filter.yearTo}`;
  return filter.yearFrom !== null ? `Fra ${filter.yearFrom}` : `Til ${filter.yearTo}`;
}
