import { listVodItems } from '../../storage/vod.js';
import type { StoredVodItem } from '../../storage/vod.js';
import type { SqlDatabase } from '../../storage/types.js';
import { cleanVodTitle } from '../../sync/tmdb.js';
import type { TmdbTitle } from '../../sync/tmdbHome.js';

/**
 * Findes en titel fra TMDB i brugerens egen pakke?
 *
 * Forsiden viser hvad tjenesterne har; men har panelet den samme film,
 * skal den spilles herfra, ikke i Netflix. Panelet skriver navnene med
 * praefiks og maerker, saa de renses paa samme maade som ved plakater, og
 * sammenlignes uden tegnsaetning og store bogstaver. Aarstallet skal
 * passe naar begge har ét — ellers rammer "Dune" (1984) for "Dune" (2021).
 */

/** Titlen reduceret til det der kan sammenlignes: smaa bogstaver, kun bogstaver og tal. */
export function comparableTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, ' og ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function pickPanelMatch(items: readonly StoredVodItem[], title: string, year: number | null): StoredVodItem | null {
  const wanted = comparableTitle(title);
  if (wanted.length === 0) return null;
  let loose: StoredVodItem | null = null;
  for (const item of items) {
    const cleaned = cleanVodTitle(item.name);
    if (comparableTitle(cleaned.title) !== wanted) continue;
    if (year !== null && cleaned.year !== null && cleaned.year !== year) continue;
    if (year !== null && cleaned.year === year) return item;
    if (loose === null) loose = item;
  }
  return loose;
}

/** Hvor mange af panelets titler der ses paa. Soegningen er LIKE paa navnet, saa listen er kort. */
const SEARCH_LIMIT = 40;

export async function findInPanel(db: SqlDatabase, title: TmdbTitle): Promise<StoredVodItem | null> {
  // Soeg paa den del af titlen der staar foer et kolon: panelet skriver
  // tit "Dune Part Two" hvor TMDB skriver "Dune: Part Two", og LIKE skal
  // ramme begge.
  const needle = title.title.split(/[:(]/)[0]?.trim() ?? title.title;
  if (needle.length === 0) return null;
  const items = await listVodItems(db, { kind: title.kind, search: needle, limit: SEARCH_LIMIT });
  return pickPanelMatch(items, title.title, title.year);
}
