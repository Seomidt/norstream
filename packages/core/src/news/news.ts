/**
 * Nyhedsoverskrifter til guidens nyhedsstribe — rene funktioner uden IO.
 *
 * Appen henter en RSS-stroem (DR's, gratis og uden noegle); denne oversaetter
 * den til en liste af overskrifter. At holde parsningen her betyder at den kan
 * testes uden netvaerk, og at `packages/app` kun staar for selve hentningen.
 *
 * Der er ingen XML-parser i React Native, saa stroemmen laeses med udtryk. Det
 * er nok: vi skal kun bruge titlen i hvert <item>, ikke hele dokumentet.
 */

import { decodeXmlEntities } from '../epg/entities.js';

/** Hvor mange overskrifter en enkelt hentning hoejst giver videre. */
const MAX_HEADLINES = 15;

/** Én nyhed: overskriften, en eventuel kategori (fx "INDLAND", "SPORT") og et breaking-flag. */
export interface NewsItem {
  title: string;
  /** Kategorien stroemmen selv angav, renset og med store bogstaver — ellers null. */
  category: string | null;
  /** Sandt naar kilden selv signalerer at nyheden er breaking / opdateres lige nu. */
  breaking: boolean;
}

/**
 * Kendetegn paa at en nyhed er breaking. RSS har ingen paalidelig markering, saa
 * det er et bedste-bud: staar der "breaking", "seneste nyt" eller "opdateres" i
 * titlen eller kategorien, taeller den. Fanger det meste, lover ingen realtid.
 */
const BREAKING = /\b(breaking|seneste nyt|sidste nyt|opdateres)\b/i;

/** Pakker CDATA ud og fjerner eventuelle indre elementer, saa der staar ren tekst. */
function plainText(raw: string): string {
  const withoutCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const withoutTags = withoutCdata.replace(/<[^>]*>/g, ' ');
  return decodeXmlEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

/**
 * En kort, praesentabel kategori fra et <category>-felt, eller null.
 *
 * Holdes kort (ét ord, store bogstaver) saa den kan staa som et lille maerke
 * foran overskriften i striben. Tomme og alenlange kategorier droppes frem for
 * at fylde striben — saa staar der bare kildens standardmaerke i stedet.
 */
function tidyCategory(raw: string): string | null {
  const text = plainText(raw);
  if (text.length === 0 || text.length > 18 || text.includes(' ')) return null;
  return text.toUpperCase();
}

/**
 * Oversaetter en RSS- eller Atom-stroem til en liste af nyheder.
 *
 * Tager titlen (og en eventuel <category>) i hvert <item> (RSS) eller <entry>
 * (Atom). Kanaltitlen oeverst i dokumentet staar uden for de blokke og kommer
 * derfor ikke med. Tomme og ens overskrifter luges fra, og listen skaeres til
 * et rimeligt antal. Kan intet laeses, er listen tom — aldrig en raa fejl.
 */
export function parseNewsItems(xml: string): NewsItem[] {
  if (typeof xml !== 'string' || xml.length === 0) return [];
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    const match = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (match === null) continue;
    const title = plainText(match[1] ?? '');
    if (title.length === 0 || seen.has(title)) continue;
    seen.add(title);
    const categoryMatch = block.match(/<category\b[^>]*>([\s\S]*?)<\/category>/i);
    const categoryRaw = categoryMatch === null ? '' : plainText(categoryMatch[1] ?? '');
    const category = tidyCategory(categoryRaw);
    const breaking = BREAKING.test(title) || BREAKING.test(categoryRaw);
    items.push({ title, category, breaking });
    if (items.length >= MAX_HEADLINES) break;
  }
  return items;
}

/** Kun overskrifterne, uden kategori. Bevaret for kald der ikke bruger kategorien. */
export function parseNewsHeadlines(xml: string): string[] {
  return parseNewsItems(xml).map((item) => item.title);
}
