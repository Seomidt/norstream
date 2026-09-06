/**
 * Et sted mere at lede efter et kanallogo.
 *
 * Paneler oplyser tit logo-adresser paa en helt anden vaert end panelets egen —
 * en billed-server der engang stod der, og som ikke noedvendigvis kan naas fra
 * den forbindelse telefonen sidder paa. Maalt paa brugerens panel svarer
 * telefonen `NoRouteToHostException: Host unreachable` paa logo-vaerten, mens
 * selve panelet virker fint.
 *
 * Naar de to vaerter er forskellige, er der en rimelig chance for at panelet
 * selv serverer den samme sti — det er ofte den samme maskine bag et andet
 * navn eller en anden port. Det koster ét forsoeg at finde ud af, og
 * alternativet er en tom firkant.
 *
 * Returnerer altid den oprindelige adresse foerst. Der gaettes ikke paa noget
 * naar vaerterne er ens, og der laves ingen adresse ud af ingenting.
 */
export function logoCandidates(logoUrl: string | null, sourceUrl: string): string[] {
  if (logoUrl === null || logoUrl.length === 0) return [];
  const logo = splitUrl(logoUrl);
  const source = splitUrl(sourceUrl);
  if (logo === null || source === null) return [logoUrl];
  if (logo.origin === source.origin) return [logoUrl];
  return [logoUrl, `${source.origin}${logo.path}`];
}

interface UrlParts {
  /** Skema, vaert og eventuel port — alt foer stien. */
  origin: string;
  /** Stien med eventuel forespoergsel. Begynder med '/'. */
  path: string;
}

/**
 * Deler en adresse uden `URL`.
 *
 * Hermes har `URL`, men den kaster paa adresser der ikke er helt korrekte, og
 * panel-data er fulde af dem. En regex der enten passer eller ikke passer, er
 * her det stabile valg.
 */
function splitUrl(url: string): UrlParts | null {
  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)([/?#].*)?$/i.exec(url.trim());
  if (match === null) return null;
  const origin = match[1];
  if (origin === undefined) return null;
  const rest = match[2] ?? '/';
  return { origin, path: rest.startsWith('/') ? rest : `/${rest}` };
}
