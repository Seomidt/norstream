import { getSetting, setSetting } from '../storage/settings.js';
import type { SqlDatabase } from '../storage/types.js';
import type { TmdbTitle } from './tmdbHome.js';

/**
 * TMDB-hylderne huskes i appens levetid, saa et skift af fane ikke koster
 * et opslag per tjeneste hver gang. Seks timer: det der er "populaert paa
 * Netflix" skifter ikke i loebet af en aften.
 */
const SHELF_TTL_MS = 6 * 60 * 60_000;
const shelfCache = new Map<string, { at: number; titles: TmdbTitle[] }>();

/**
 * Hylderne fra TMDB, i hukommelsen og i databasen: saa staar de der med
 * det samme naeste gang appen aabnes, i stedet for at forsiden venter paa
 * TMDB ved hver start. Efter seks timer hentes de igen, men det gamle
 * vises imens, saa forsiden aldrig staar tom.
 */
export async function cachedShelf(db: SqlDatabase, key: string, load: () => Promise<TmdbTitle[]>): Promise<TmdbTitle[]> {
  const known = shelfCache.get(key) ?? (await storedShelf(db, key));
  if (known !== undefined) {
    shelfCache.set(key, known);
    if (Date.now() - known.at < SHELF_TTL_MS) return known.titles;
  }
  let titles: TmdbTitle[];
  try {
    titles = await load();
  } catch (cause) {
    if (known !== undefined) return known.titles;
    throw cause;
  }
  if (titles.length > 0) {
    const entry = { at: Date.now(), titles };
    shelfCache.set(key, entry);
    void setSetting(db, `shelf:${key}`, JSON.stringify(entry)).catch(() => undefined);
  }
  return titles.length > 0 ? titles : (known?.titles ?? titles);
}

async function storedShelf(db: SqlDatabase, key: string): Promise<{ at: number; titles: TmdbTitle[] } | undefined> {
  const raw = await getSetting(db, `shelf:${key}`).catch(() => null);
  if (raw === null) return undefined;
  try {
    const parsed = JSON.parse(raw) as { at?: unknown; titles?: unknown };
    if (typeof parsed.at === 'number' && Array.isArray(parsed.titles)) return { at: parsed.at, titles: parsed.titles as TmdbTitle[] };
  } catch {
    // Ugyldigt; hentes igen.
  }
  return undefined;
}

