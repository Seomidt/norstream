/**
 * Udleder land ud af et Xtream-kategorinavn.
 *
 * Brugerens panel har 285 kategorier, alle med landepraefiks:
 * `DENMARK HD & HEVC`, `SWEDEN SPORT`, `4K UHD 3840P`. Uden gruppering er en
 * vandret raekke med 285 poster reelt unavigerbar.
 *
 * Modulet ligger i core, ikke i appen: det er ren tekstbehandling, det skal
 * testes eet sted, og TV-appen faar brug for praecis det samme.
 */

export interface Country {
  /** ISO 3166-1 alpha-2, altid store bogstaver. */
  code: string;
  /** Landets navn paa dansk. */
  name: string;
  /** Flaget som emoji, sammensat af regional indicator-symboler. */
  flag: string;
}

/** Foerste regional indicator-symbol, U+1F1E6, svarer til bogstavet A. */
const REGIONAL_INDICATOR_A = 0x1f1e6;
const LETTER_A = 'A'.charCodeAt(0);

/**
 * Bygger et flag-emoji ud af en landekode. To bogstaver bliver til to
 * regional indicator-symboler, som enhver moderne skrifttype tegner som et
 * flag. Ingen billedfiler, ingen afhaengighed, ingen 285 ikoner at vedligeholde.
 */
export function countryFlag(code: string): string {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '';
  return String.fromCodePoint(
    REGIONAL_INDICATOR_A + (upper.charCodeAt(0) - LETTER_A),
    REGIONAL_INDICATOR_A + (upper.charCodeAt(1) - LETTER_A),
  );
}

/** Landekode til dansk navn. Kun de lande paneler faktisk grupperer efter. */
const NAMES: Readonly<Record<string, string>> = {
  DK: 'Danmark',
  SE: 'Sverige',
  NO: 'Norge',
  FI: 'Finland',
  IS: 'Island',
  GB: 'Storbritannien',
  IE: 'Irland',
  DE: 'Tyskland',
  NL: 'Holland',
  BE: 'Belgien',
  FR: 'Frankrig',
  ES: 'Spanien',
  PT: 'Portugal',
  IT: 'Italien',
  AT: 'Østrig',
  CH: 'Schweiz',
  PL: 'Polen',
  CZ: 'Tjekkiet',
  SK: 'Slovakiet',
  HU: 'Ungarn',
  RO: 'Rumænien',
  BG: 'Bulgarien',
  GR: 'Grækenland',
  TR: 'Tyrkiet',
  RU: 'Rusland',
  UA: 'Ukraine',
  RS: 'Serbien',
  HR: 'Kroatien',
  SI: 'Slovenien',
  BA: 'Bosnien-Hercegovina',
  MK: 'Nordmakedonien',
  AL: 'Albanien',
  EE: 'Estland',
  LV: 'Letland',
  LT: 'Litauen',
  US: 'USA',
  CA: 'Canada',
  MX: 'Mexico',
  BR: 'Brasilien',
  AR: 'Argentina',
  AU: 'Australien',
  NZ: 'New Zealand',
  IN: 'Indien',
  PK: 'Pakistan',
  ZA: 'Sydafrika',
  MA: 'Marokko',
  EG: 'Egypten',
  SA: 'Saudi-Arabien',
  AE: 'Forenede Arabiske Emirater',
  IL: 'Israel',
  JP: 'Japan',
  KR: 'Sydkorea',
  CN: 'Kina',
  TH: 'Thailand',
  PH: 'Filippinerne',
  ID: 'Indonesien',
  MY: 'Malaysia',
  VN: 'Vietnam',
};

/**
 * Kendte skrivemaader for hvert land. Nogle paneler skriver landet ud,
 * andre bruger to- eller trebogstavskoder — `DNK| DR1 HD` staar paa
 * kanalerne, `DENMARK HD & HEVC` paa kategorierne.
 *
 * Tobogstavsformer er med med vilje kun for lande der faktisk bruges som
 * praefiks i paneler. Rammer en af dem forkert, ender kategorien under et
 * forkert flag — derfor er listen kort, og alt uden for den bliver til
 * **Øvrige**, som spec'ens risikotabel foreskriver.
 */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  DK: ['DENMARK', 'DANMARK', 'DANISH', 'DK', 'DNK', 'DEN'],
  SE: ['SWEDEN', 'SVERIGE', 'SWEDISH', 'SE', 'SWE'],
  NO: ['NORWAY', 'NORGE', 'NORWEGIAN', 'NO', 'NOR'],
  FI: ['FINLAND', 'FINNISH', 'FI', 'FIN'],
  IS: ['ICELAND', 'ISLAND', 'ISL'],
  GB: ['UNITED KINGDOM', 'GREAT BRITAIN', 'ENGLAND', 'BRITISH', 'UK', 'GB', 'GBR'],
  IE: ['IRELAND', 'IRISH', 'IE', 'IRL'],
  DE: ['GERMANY', 'GERMAN', 'DEUTSCHLAND', 'DE', 'GER', 'DEU'],
  NL: ['NETHERLANDS', 'HOLLAND', 'DUTCH', 'NL', 'NED', 'NLD'],
  BE: ['BELGIUM', 'BELGIE', 'BE', 'BEL'],
  FR: ['FRANCE', 'FRENCH', 'FR', 'FRA'],
  ES: ['SPAIN', 'ESPANA', 'SPANISH', 'ES', 'ESP'],
  PT: ['PORTUGAL', 'PORTUGUESE', 'PT', 'POR', 'PRT'],
  IT: ['ITALY', 'ITALIA', 'ITALIAN', 'IT', 'ITA'],
  AT: ['AUSTRIA', 'OSTERREICH', 'AT', 'AUT'],
  CH: ['SWITZERLAND', 'SCHWEIZ', 'SUISSE', 'CH', 'SUI'],
  PL: ['POLAND', 'POLSKA', 'POLISH', 'PL', 'POL'],
  CZ: ['CZECH REPUBLIC', 'CZECHIA', 'CZECH', 'CZ', 'CZE'],
  SK: ['SLOVAKIA', 'SLOVAK', 'SK', 'SVK'],
  HU: ['HUNGARY', 'HUNGARIAN', 'HU', 'HUN'],
  RO: ['ROMANIA', 'ROMANIAN', 'RO', 'ROU'],
  BG: ['BULGARIA', 'BULGARIAN', 'BG', 'BGR'],
  GR: ['GREECE', 'GREEK', 'GR', 'GRE'],
  TR: ['TURKEY', 'TURKIYE', 'TURKISH', 'TR', 'TUR'],
  RU: ['RUSSIA', 'RUSSIAN', 'RU', 'RUS'],
  UA: ['UKRAINE', 'UKRAINIAN', 'UA', 'UKR'],
  RS: ['SERBIA', 'SRBIJA', 'RS', 'SRB'],
  HR: ['CROATIA', 'HRVATSKA', 'HR', 'CRO', 'HRV'],
  SI: ['SLOVENIA', 'SLOVENIJA', 'SI', 'SVN'],
  BA: ['BOSNIA', 'BOSNIA AND HERZEGOVINA', 'BIH', 'BA'],
  MK: ['MACEDONIA', 'NORTH MACEDONIA', 'MK', 'MKD'],
  AL: ['ALBANIA', 'SHQIP', 'AL', 'ALB'],
  EE: ['ESTONIA', 'EE', 'EST'],
  LV: ['LATVIA', 'LV', 'LVA'],
  LT: ['LITHUANIA', 'LT', 'LTU'],
  US: ['UNITED STATES', 'USA', 'AMERICA', 'US'],
  CA: ['CANADA', 'CANADIAN', 'CA', 'CAN'],
  MX: ['MEXICO', 'MX', 'MEX'],
  BR: ['BRAZIL', 'BRASIL', 'BR', 'BRA'],
  AR: ['ARGENTINA', 'ARG'],
  AU: ['AUSTRALIA', 'AU', 'AUS'],
  NZ: ['NEW ZEALAND', 'NZ', 'NZL'],
  IN: ['INDIA', 'INDIAN', 'IN', 'IND'],
  PK: ['PAKISTAN', 'PK', 'PAK'],
  ZA: ['SOUTH AFRICA', 'ZA', 'RSA'],
  MA: ['MOROCCO', 'MAROC', 'MA', 'MAR'],
  EG: ['EGYPT', 'EG', 'EGY'],
  SA: ['SAUDI ARABIA', 'SAUDI', 'KSA', 'SA'],
  AE: ['UNITED ARAB EMIRATES', 'EMIRATES', 'UAE', 'AE'],
  IL: ['ISRAEL', 'HEBREW', 'IS', 'IL', 'ISR'],
  JP: ['JAPAN', 'JP', 'JPN'],
  KR: ['SOUTH KOREA', 'KOREA', 'KR', 'KOR'],
  CN: ['CHINA', 'CN', 'CHN'],
  TH: ['THAILAND', 'TH', 'THA'],
  PH: ['PHILIPPINES', 'PH', 'PHL'],
  ID: ['INDONESIA', 'ID', 'IDN'],
  MY: ['MALAYSIA', 'MY', 'MYS'],
  VN: ['VIETNAM', 'VN', 'VNM'],
};

/**
 * Opslagstabel fra normaliseret udtryk til landekode, plus laengden af det
 * laengste udtryk. Laengste match vinder, saa `UNITED KINGDOM` ikke taber til
 * et kortere `UNITED` — der er ingen, men reglen skal holde uanset raekkefoelgen
 * i tabellen ovenfor.
 */
const { phrases, maxTokens } = (() => {
  const map = new Map<string, string>();
  let longest = 1;
  for (const [code, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      map.set(alias, code);
      longest = Math.max(longest, alias.split(' ').length);
    }
  }
  return { phrases: map, maxTokens: longest };
})();

/**
 * Ord der optraeder foran landet i praksis. Kun eet af dem springes over, og
 * kun fra denne liste: jo mere gaetteri, jo stoerre risiko for at gruppere
 * forkert, og **Øvrige** er et bedre svar end et forkert flag.
 */
const MARKERS: ReadonlySet<string> = new Set(['VIP', 'HD', 'FHD', 'SD', 'UHD', '4K']);

function tokenise(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 0);
}

function matchAt(
  tokens: readonly string[],
  start: number,
  minLength = 1,
): string | null {
  const limit = Math.min(maxTokens, tokens.length - start);
  for (let length = limit; length >= 1; length -= 1) {
    const phrase = tokens.slice(start, start + length).join(' ');
    if (phrase.length < minLength) continue;
    const code = phrases.get(phrase);
    if (code !== undefined) return code;
  }
  return null;
}

function toCountry(code: string): Country {
  // NAMES og ALIASES holdes i takt; en kode uden navn ville vaere en fejl her,
  // ikke i data, saa koden selv er et bedre fallback end en tom streng.
  return { code, name: NAMES[code] ?? code, flag: countryFlag(code) };
}

/**
 * Udleder landet af et kategorinavns praefiks. Returnerer `null` naar
 * praefikset ikke er et land vi kender — `4K UHD 3840P`, `RELAX 1920P` —
 * hvorefter kalderen viser kategorien under **Øvrige**. Ingen kategori maa
 * forsvinde fordi udledningen ikke genkendte den.
 */
export function deriveCountry(categoryName: string): Country | null {
  const tokens = tokenise(categoryName);
  if (tokens.length === 0) return null;

  const direct = matchAt(tokens, 0);
  if (direct !== null) return toCountry(direct);

  const first = tokens[0];
  if (first !== undefined && MARKERS.has(first) && tokens.length > 1) {
    const afterMarker = matchAt(tokens, 1);
    if (afterMarker !== null) return toCountry(afterMarker);
  }

  return null;
}

/**
 * Korteste udtryk der maa genkendes midt i et navn.
 *
 * Tobogstavskoderne er kun sikre foerst i navnet. `IT`, `IN` og `SE` er
 * almindelige ord- og forkortelsesstumper, og et `IT` midt i `SPORT IT NEWS`
 * ville laegge kategorien under italiensk flag paa et tilfaeldigt sammenfald.
 * Tre bogstaver er nok til at `DNK`, `SWE` og `DENMARK` slipper igennem, og
 * det er dem panelerne faktisk skriver.
 */
const MIN_LOOSE_LENGTH = 3;

/**
 * Som `deriveCountry`, men leder ogsaa efter landet **inde i** navnet.
 *
 * Panelerne er ikke enige med sig selv: ved siden af `DENMARK HD & HEVC`
 * staar `SPORT | DENMARK` og `VIP DNK NEWS`. Den strenge praefiksregel
 * sender de sidste to i **Øvrige**, hvor de ikke hoerer hjemme.
 *
 * Praefikset vinder altid, saa `DENMARK SWEDEN MIX` bliver dansk og ikke
 * svensk. Foerste fund derefter vinder — der er ingen rimelig maade at vaelge
 * mellem to lande midt i et navn, og foerste naevnte er panelets egen
 * raekkefoelge.
 */
export function deriveCountryLoose(categoryName: string): Country | null {
  const strict = deriveCountry(categoryName);
  if (strict !== null) return strict;

  const tokens = tokenise(categoryName);
  for (let index = 1; index < tokens.length; index += 1) {
    const code = matchAt(tokens, index, MIN_LOOSE_LENGTH);
    if (code !== null) return toCountry(code);
  }
  return null;
}
