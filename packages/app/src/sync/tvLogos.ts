import { normaliseChannelName } from '@norstream/core';

/**
 * Det andet aabne logo-arkiv: tv-logo/tv-logos.
 *
 * iptv-orgs register er stoerre og har baade land og XMLTV-id per kanal, saa
 * det bliver ved med at vaere det foerste opslag. Det her arkiv er en **liste
 * af filnavne** og intet andet — men det daekker 5.349 navne og lande som
 * iptv-org ikke har, og logoerne er lavet til moerk baggrund, som appen har.
 * Talt op i begge kilders egne filer, ikke skoennet.
 *
 * Blandt de 5.349: TV 2 Echo og hele V Film-familien, som panelet stadig
 * kalder Viasat Film.
 */
const BASE = 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries';

/**
 * Landet staar som endelsen paa filnavnet: `tv2-echo-dk`, `bbc-one-uk`.
 * `int` er de internationale, som ikke hoerer til ét land.
 */
const SUFFIX = /^(.*)-([a-z]{2,3})$/;

/** Hvad arkivet ved om ét logo. */
export interface TvLogoEntry {
  /** Kanalnavnet, normaliseret som alle andre navne i appen. */
  key: string;
  /** ISO-landekode med store bogstaver, eller '*' for de internationale. */
  country: string;
  url: string;
}

/**
 * Laeser listen af filnavne om til opslag.
 *
 * Listen ligger med i bundtet frem for at blive hentet. Arkivet har ingen
 * indeksfil, og GitHubs API har en graense paa tres kald i timen uden noegle —
 * ingen af delene kan en app paa en telefon leve med. Filen bygges af
 * `scripts/build-tv-logos-index.mjs` og er paa 302 kB.
 */
export function parseTvLogoPaths(paths: readonly string[]): TvLogoEntry[] {
  const entries: TvLogoEntry[] = [];
  for (const path of paths) {
    const stem = path.slice(path.lastIndexOf('/') + 1);
    const match = SUFFIX.exec(stem);
    if (match === null) continue;
    const [, slug, suffix] = match;
    if (slug === undefined || suffix === undefined) continue;

    // Bindestregerne er ordmellemrum i et filnavn, ikke tegnsaetning.
    const key = normaliseChannelName(slug.replace(/-/g, ' '));
    if (key.length === 0) continue;

    const country = suffix.toUpperCase();
    entries.push({
      key,
      country: country === 'INT' ? '*' : country,
      url: `${BASE}/${path}.png`,
    });
  }
  return entries;
}
