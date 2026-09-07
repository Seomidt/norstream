/**
 * Sammenligningsnavn for en kanal.
 *
 * Panelet skriver `DNK| DR1 HD`, `VIP DR1 HEVC`, `DR 1 FHD`. Det aabne
 * register skriver `DR1`. Uden en faelles form matcher intet, og de 22.000
 * kanaler ville staa uden logo selv om registret har dem.
 *
 * Der fjernes: landepraefiks, kvalitetsmaerker, landenavne, tegnsaetning og
 * mellemrum. Tallet bliver staaende — `DR1` og `DR2` er ikke den samme kanal,
 * og en normalisering der blandede dem ville give forkerte logoer paa kanaler
 * der ser rigtige ud.
 *
 * **Plus skrives ud som ordet.** Det blev foer fjernet som tegnsaetning, og saa
 * blev `TV3+` til `TV3`: to forskellige kanaler med samme noegle. Appen giver
 * med vilje op naar en noegle er flertydig, saa resultatet var at *hverken*
 * TV3 eller TV3+ fik et logo. Og det skal vaere ordet og ikke tegnet, fordi
 * de to skrivemaader begge findes i kilderne: registret skriver `TV3+`, mens
 * filnavnene i logo-arkivet skriver `tv3-plus`. Skrevet ud moedes de.
 */
const QUALITY = new Set([
  'HD',
  'FHD',
  'UHD',
  'SD',
  'HEVC',
  'H265',
  'H264',
  '4K',
  '8K',
  'VIP',
  '1080P',
  '1080',
  '720P',
  '720',
  '2160P',
  'RAW',
  'BACKUP',
  'ALT',
  // Panelet skriver tit sporene i navnet: `MULTI` for flere lydspor, `SUB`
  // for undertekster. Det er den samme kanal og det samme logo.
  'MULTI',
  'MULTIAUDIO',
  'SUB',
  'SUBS',
  'DUAL',
]);

/**
 * Landenavne panelet haenger paa, og registret ikke har med.
 *
 * Panelet skriver `TLC DANMARK`; registret skriver `TLC` med land `DK`. Uden
 * det her er de to forskellige navne, og kanalen staar uden logo selv om
 * registret har den. Landet ligger allerede i opslagsnoeglen, saa det er ikke
 * information der gaar tabt — det staar bare to steder.
 */
const COUNTRY_WORDS = new Set([
  'DANMARK',
  'DENMARK',
  'NORGE',
  'NORWAY',
  'SVERIGE',
  'SWEDEN',
  'SUOMI',
  'FINLAND',
  'ISLAND',
  'ICELAND',
  'DEUTSCHLAND',
  'GERMANY',
  'NEDERLAND',
  'NETHERLANDS',
  'ESPANA',
  'SPAIN',
  'ITALIA',
  'ITALY',
  'FRANCE',
  'POLSKA',
  'POLAND',
]);

/**
 * Navne der er skiftet, skrevet som (nutidigt navn, det panelerne stadig
 * bruger).
 *
 * Det er **ikke** gaet: det er omdoebninger der er sket i virkeligheden.
 * Viasats nordiske film- og seriekanaler hedder `V Film Action` og `V Series`
 * i dag, og det er dem logo-arkiverne har. Panelerne skriver stadig de gamle
 * navne, og saa staar kanalen uden logo selv om logoet ligger der.
 */
const RENAMED: ReadonlyArray<readonly [RegExp, string]> = [
  [/^VFILM/, 'VIASATFILM'],
  [/^VSERIES$/, 'VIASATSERIES'],
];

/**
 * De gamle navne en kanal ogsaa skal kunne slaas op paa.
 *
 * Bruges naar registret **bygges**, ikke naar der slaas op. Opslaget sker to
 * steder — i en SQL-sammenkobling og i en funktion — og de to maa ikke kunne
 * give hvert sit svar. Laegges de gamle navne ind som raekker for sig, er der
 * kun én vej, og begge steder foelger den.
 */
export function legacyNamesFor(normalised: string): string[] {
  const names: string[] = [];
  for (const [pattern, replacement] of RENAMED) {
    const legacy = normalised.replace(pattern, replacement);
    if (legacy !== normalised) names.push(legacy);
  }
  return names;
}

/**
 * Udgaven af normaliseringen.
 *
 * Noeglen gemmes paa hver kanalraekke naar kanalerne hentes. Aendres reglerne
 * her uden at kanalerne hentes igen, staar telefonen med noegler efter de
 * gamle regler og et register efter de nye — og logoer der virkede i gaar,
 * forsvinder. Det skete: `+` blev til `PLUS`, og TV3+ mistede sit logo.
 *
 * **Tael op hver gang reglerne aendres.** Appen sammenligner tallet med det
 * gemte ved opstart og henter kanalerne igen naar de er forskellige.
 */
export const MATCH_KEY_VERSION = 3;

export function normaliseChannelName(name: string): string {
  // Alt foer en lodret streg er panelets eget praefiks: `DNK|`, `DK |`.
  const withoutPrefix = name.includes('|') ? name.slice(name.lastIndexOf('|') + 1) : name;

  const words = withoutPrefix
    .toUpperCase()
    .replace(/\+/g, ' PLUS ')
    .replace(/[^A-Z0-9ÆØÅ]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0 && !QUALITY.has(word) && !COUNTRY_WORDS.has(word));

  return words.join('');
}

/** En kanal i det aabne register, reduceret til det der skal bruges. */
export interface RegistryChannel {
  /** Registrets eget id, fx `DR1.dk`. */
  id: string;
  name: string;
  altNames: string[];
  /** ISO 3166-1 alpha-2, store bogstaver. */
  country: string;
}

/**
 * Opslag fra normaliseret navn til registrets kanaler.
 *
 * Flere kanaler kan dele navn — `TV 2` findes i baade Danmark, Norge og
 * Sverige — saa opslaget giver en liste, og landet afgoer. Uden det ville en
 * dansk TV 2 lige saa godt kunne faa det norske logo.
 */
export function buildNameIndex(
  channels: readonly RegistryChannel[],
): Map<string, RegistryChannel[]> {
  const index = new Map<string, RegistryChannel[]>();
  const add = (key: string, channel: RegistryChannel): void => {
    if (key.length === 0) return;
    const existing = index.get(key);
    if (existing === undefined) index.set(key, [channel]);
    else if (!existing.includes(channel)) existing.push(channel);
  };

  for (const channel of channels) {
    add(normaliseChannelName(channel.name), channel);
    for (const alt of channel.altNames) add(normaliseChannelName(alt), channel);
  }
  return index;
}

/**
 * Finder registrets kanal for et panelnavn.
 *
 * `country` er landet udledt af kategorien. Er der flere kandidater, vinder
 * den fra samme land; er der ingen fra landet, gives der **op** frem for at
 * gaette. Et forkert logo paa en kanal der ser rigtig ud er vaerre end intet
 * logo — man opdager det aldrig.
 */
export function matchRegistryChannel(
  index: ReadonlyMap<string, RegistryChannel[]>,
  name: string,
  country: string | null,
): RegistryChannel | null {
  const candidates = index.get(normaliseChannelName(name));
  if (candidates === undefined || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;
  if (country === null) return null;

  const fromCountry = candidates.filter((c) => c.country === country.toUpperCase());
  return fromCountry.length === 1 ? (fromCountry[0] ?? null) : null;
}
