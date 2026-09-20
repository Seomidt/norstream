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

/** Pakker CDATA ud og fjerner eventuelle indre elementer, saa der staar ren tekst. */
function plainText(raw: string): string {
  const withoutCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const withoutTags = withoutCdata.replace(/<[^>]*>/g, ' ');
  return decodeXmlEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

/**
 * Oversaetter en RSS- eller Atom-stroem til en liste af overskrifter.
 *
 * Tager titlen i hvert <item> (RSS) eller <entry> (Atom). Kanaltitlen oeverst i
 * dokumentet staar uden for de blokke og kommer derfor ikke med. Tomme og ens
 * overskrifter luges fra, og listen skaeres til et rimeligt antal, saa striben
 * ikke bliver uendelig. Kan intet laeses, er listen tom — aldrig en raa fejl.
 */
export function parseNewsHeadlines(xml: string): string[] {
  if (typeof xml !== 'string' || xml.length === 0) return [];
  const headlines: string[] = [];
  const seen = new Set<string>();
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    const match = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (match === null) continue;
    const title = plainText(match[1] ?? '');
    if (title.length === 0 || seen.has(title)) continue;
    seen.add(title);
    headlines.push(title);
    if (headlines.length >= MAX_HEADLINES) break;
  }
  return headlines;
}
