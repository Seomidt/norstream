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
  return { kind, countries: [], genres: [], yearFrom: null, yearTo: null, sort: 'newest' };
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
    };
  } catch {
    return defaultVodFilter(kind);
  }
}

export async function saveVodFilter(db: SqlDatabase, filter: VodFilter): Promise<void> {
  const { kind, ...rest } = filter;
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
  return [
    { label: 'Alle år', from: null, to: null },
    { label: String(y), from: y, to: y },
    { label: String(y - 1), from: y - 1, to: y - 1 },
    { label: String(y - 2), from: y - 2, to: y - 2 },
    { label: `${y - 6}–${y - 3}`, from: y - 6, to: y - 3 },
    { label: `${y - 16}–${y - 7}`, from: y - 16, to: y - 7 },
    { label: `Før ${y - 16}`, from: null, to: y - 17 },
  ];
}

export const SORT_LABELS: Record<VodSort, string> = {
  newest: 'Nyeste',
  rating: 'Bedst bedømt',
  year: 'Årstal',
  title: 'Titel',
};

export function yearLabel(filter: VodFilter, choices: YearChoice[] = yearChoices()): string {
  const match = choices.find((c) => c.from === filter.yearFrom && c.to === filter.yearTo);
  if (match !== undefined) return match.label;
  if (filter.yearFrom === null && filter.yearTo === null) return 'Alle år';
  if (filter.yearFrom !== null && filter.yearTo !== null) return filter.yearFrom === filter.yearTo ? String(filter.yearFrom) : `${filter.yearFrom}–${filter.yearTo}`;
  return filter.yearFrom !== null ? `Fra ${filter.yearFrom}` : `Til ${filter.yearTo}`;
}
