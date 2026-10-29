import { genresInText } from '../storage/genres.js';
import type { GenreKey } from '../storage/genres.js';
import type { TmdbFetch } from './tmdb.js';

/** Kun en bekraeftet IMDb-identitet maa udfylde manglende filmdata. */
export async function omdbMetadata(
  fetchImpl: TmdbFetch, key: string, imdbId: string, kind: 'movie' | 'series', expectedYear: number | null,
): Promise<{ genres: GenreKey[]; year: number | null } | null> {
  if (!/^tt\d{7,12}$/.test(imdbId) || key.trim().length === 0) return null;
  const response = await fetchImpl(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key.trim())}&i=${imdbId}&plot=short`);
  if (!response.ok) return null;
  const data = await response.json() as { Response?: string; imdbID?: string; Type?: string; Genre?: string; Year?: string };
  if (data.Response !== 'True' || data.imdbID !== imdbId || data.Type !== kind) return null;
  const parsed = typeof data.Year === 'string' && /^\d{4}(?:$|\D)/.test(data.Year) ? Number(data.Year.slice(0, 4)) : null;
  if (expectedYear !== null && parsed !== null && expectedYear !== parsed) return null;
  return { genres: genresInText(data.Genre), year: parsed };
}
