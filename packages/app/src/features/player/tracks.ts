import type { SubtitlePreference } from '../../storage/settings.js';

/**
 * Spor — undertekster og lyd — som begge afspillere ser dem.
 *
 * Reglerne for hvilket undertekstspor der vaelges af sig selv ligger her,
 * ét sted, saa film og live-kanaler opfoerer sig ens: det foretrukne sprog
 * fra Indstillinger, ellers engelsk, ellers intet.
 */
export interface TrackLike {
  id?: string;
  language: string;
  label: string;
  name?: string;
}

/** Telefonens sprog som en kort kode — `da`, `en`. Falder tilbage paa dansk. */
export function deviceLanguage(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.split(/[-_]/)[0]?.toLowerCase() ?? 'da';
  } catch {
    return 'da';
  }
}

/** `da` og `dan` er samme sprog; filerne skriver begge dele. */
export function sameLanguage(a: string, b: string): boolean {
  const norm = (code: string): string => {
    const lower = code.toLowerCase();
    return THREE_TO_TWO[lower] ?? lower;
  };
  return norm(a) === norm(b);
}

const THREE_TO_TWO: Record<string, string> = {
  dan: 'da', eng: 'en', swe: 'sv', nor: 'no', nob: 'no', fin: 'fi', ger: 'de', deu: 'de',
  fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', dut: 'nl', nld: 'nl', pol: 'pl', ara: 'ar', tur: 'tr',
};

/**
 * Sporet der skal vaelges af sig selv, eller null for intet.
 *
 * `off` betyder ingen undertekster, `auto` telefonens sprog. Findes det
 * oenskede ikke, proeves engelsk — det er der naesten altid, og det er
 * bedre end ingenting for de fleste. Live-kanaler maerker tit deres spor
 * som `und` (ukendt); dem tages der ikke stilling til, for man kan ikke se
 * hvad de er foer de tegnes.
 */
export function pickPreferredSubtitle<T extends TrackLike>(
  tracks: readonly T[],
  preference: SubtitlePreference,
): T | null {
  if (preference === 'off' || tracks.length === 0) return null;
  const wanted = preference === 'auto' ? [deviceLanguage(), 'en'] : [preference, 'en'];
  for (const language of wanted) {
    const track = tracks.find((candidate) => sameLanguage(candidate.language, language));
    if (track !== undefined) return track;
  }
  return null;
}

/** Sporets navn til visning: sprog, og navnet fra filen naar det siger mere. */
export function trackName(track: TrackLike): string {
  const language = LANGUAGES[track.language.toLowerCase()] ?? track.label ?? track.language;
  const name = track.name?.trim() ?? '';
  return name.length > 0 && name.toLowerCase() !== language.toLowerCase()
    ? `${language} (${name})`
    : language;
}

export function sameTrack(a: TrackLike, b: TrackLike): boolean {
  if (a.id !== undefined && b.id !== undefined) return a.id === b.id;
  return a.language === b.language && a.label === b.label;
}

/** De sprog der er almindelige paa et nordisk panel, paa dansk. Resten viser sin kode. */
const LANGUAGES: Record<string, string> = {
  da: 'Dansk',
  dan: 'Dansk',
  en: 'Engelsk',
  eng: 'Engelsk',
  sv: 'Svensk',
  swe: 'Svensk',
  no: 'Norsk',
  nor: 'Norsk',
  nb: 'Norsk',
  fi: 'Finsk',
  fin: 'Finsk',
  de: 'Tysk',
  ger: 'Tysk',
  deu: 'Tysk',
  fr: 'Fransk',
  fre: 'Fransk',
  fra: 'Fransk',
  es: 'Spansk',
  spa: 'Spansk',
  it: 'Italiensk',
  ita: 'Italiensk',
  nl: 'Hollandsk',
  dut: 'Hollandsk',
  nld: 'Hollandsk',
  pl: 'Polsk',
  pol: 'Polsk',
  ar: 'Arabisk',
  ara: 'Arabisk',
  tr: 'Tyrkisk',
  tur: 'Tyrkisk',
  und: 'Ukendt sprog',
};
