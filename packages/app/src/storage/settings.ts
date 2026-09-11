import type { TimeshiftDialect } from '@norstream/core';
import type { SqlDatabase } from './types.js';

const KEY_DIALECT = 'timeshift_dialect';
const KEY_OFFSET = 'panel_offset_minutes';
const KEY_LAST_SYNC = 'last_sync_ms';
const KEY_PREVIEW = 'mini_preview_enabled';
const KEY_STREAM_FORMAT = 'stream_format';
const KEY_LAST_XMLTV = 'last_xmltv_ms';
const KEY_REGISTRY_ERROR = 'registry_error';
const KEY_REGISTRY_ENABLED = 'logo_registry_enabled';
const KEY_YOUTUBE_API_KEY = 'youtube_api_key';
const KEY_SUBTITLE_LANGUAGE = 'subtitle_language';
const KEY_TMDB_API_KEY = 'tmdb_api_key';
const KEY_GOOGLE_SEARCH_KEY = 'google_search_key';
const KEY_GOOGLE_SEARCH_CX = 'google_search_cx';
const KEY_LAST_CHANNEL = 'last_channel_id';
const KEY_HOME_PROVIDERS = 'home_providers';

export async function getSetting(
  db: SqlDatabase,
  key: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export async function setSetting(
  db: SqlDatabase,
  key: string,
  value: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/**
 * Dialekt og tidszone hoerer til **kilden**, ikke til appen.
 *
 * To paneler taler ikke noedvendigvis samme timeshift-dialekt og staar ikke i
 * samme tidszone. Med én faelles vaerdi ville det ene panels probing slaa det
 * andets start-forfra fra, uden at nogen kunne se hvorfor.
 */
function scopedKey(key: string, sourceId?: string): string {
  return sourceId === undefined ? key : `${key}:${sourceId}`;
}

/**
 * Kilden er **paakraevet**, og det er den af en grund.
 *
 * Den var valgfri, og saa laeste to skaerme den faelles noegle der ikke staar
 * noget paa: afspilleren meldte "Start forfra er ikke klar" hver gang man
 * aabnede en kanal, og guiden viste aldrig uret paa de kanaler der har arkiv.
 * Begge steder skrev koden rigtigt og laeste forkert, saa "Proev igen"
 * hjalp — indtil man gik ud og ind igen.
 *
 * En valgfri kilde-parameter goer den fejl usynlig for baade oversaetter og
 * tests. Uden den fanges den ved oversaettelsen.
 *
 * Null betyder enten "ikke probet endnu" eller "ingen dialekt svarede".
 */
export async function getTimeshiftDialect(
  db: SqlDatabase,
  sourceId: string,
): Promise<TimeshiftDialect | null> {
  const value = await getSetting(db, scopedKey(KEY_DIALECT, sourceId));
  return value === 'php' || value === 'path' ? value : null;
}

export async function setTimeshiftDialect(
  db: SqlDatabase,
  dialect: TimeshiftDialect | null,
  sourceId: string,
): Promise<void> {
  await setSetting(db, scopedKey(KEY_DIALECT, sourceId), dialect ?? 'none');
}

/** Kilderne der har fundet en dialekt, som et opslag guiden kan bruge per raekke. */
export async function sourcesWithDialect(db: SqlDatabase): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key LIKE ? ESCAPE '\\'",
    [`${KEY_DIALECT}:%`],
  );
  const found = new Set<string>();
  for (const row of rows) {
    if (row.value !== 'php' && row.value !== 'path') continue;
    found.add(row.key.slice(KEY_DIALECT.length + 1));
  }
  return found;
}

export async function getPanelOffsetMinutes(
  db: SqlDatabase,
  sourceId: string,
): Promise<number> {
  const value = await getSetting(db, scopedKey(KEY_OFFSET, sourceId));
  if (value === null) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function setPanelOffsetMinutes(
  db: SqlDatabase,
  minutes: number,
  sourceId: string,
): Promise<void> {
  await setSetting(db, scopedKey(KEY_OFFSET, sourceId), String(Math.trunc(minutes)));
}

/**
 * Flytter den faelles dialekt og tidszone over paa en kilde.
 *
 * Enheder fra tiden med ét panel har vaerdierne uden kilde. De skal foelge med
 * over paa den kilde de faktisk hoerer til, ellers mister installationen
 * start-forfra og skal probe forfra — og probingen koerte kun under onboarding.
 */
export async function adoptLegacySettings(db: SqlDatabase, sourceId: string): Promise<void> {
  for (const key of [KEY_DIALECT, KEY_OFFSET]) {
    const scoped = scopedKey(key, sourceId);
    if ((await getSetting(db, scoped)) !== null) continue;
    const shared = await getSetting(db, key);
    if (shared !== null) await setSetting(db, scoped, shared);
  }
}

/**
 * Hvornaar en kilde sidst blev hentet.
 *
 * Per kilde, ikke faelles. Med én faelles vaerdi ville en nyligt tilfoejet
 * kilde arve de andres hentetid og staa tom i op til et doegn — og en kilde
 * der var nede, ville faa de oevrige til at vente med sig.
 */
export async function getLastSyncMs(
  db: SqlDatabase,
  sourceId?: string,
): Promise<number | null> {
  const value = await getSetting(db, scopedKey(KEY_LAST_SYNC, sourceId));
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function setLastSyncMs(
  db: SqlDatabase,
  ms: number,
  sourceId?: string,
): Promise<void> {
  await setSetting(db, scopedKey(KEY_LAST_SYNC, sourceId), String(Math.trunc(ms)));
}

/** Hvornaar en kildes XMLTV-programoversigt sidst blev hentet. */
export async function getLastXmltvMs(db: SqlDatabase, sourceId: string): Promise<number | null> {
  const value = await getSetting(db, scopedKey(KEY_LAST_XMLTV, sourceId));
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function setLastXmltvMs(
  db: SqlDatabase,
  sourceId: string,
  ms: number,
): Promise<void> {
  await setSetting(db, scopedKey(KEY_LAST_XMLTV, sourceId), String(Math.trunc(ms)));
}

/**
 * Nulstiller tidspunktet for sidste kanal-synkronisering.
 *
 * Kaldes ved udlogning. Uden det springer den naeste session synkroniseringen
 * over i op til et doegn, fordi `last_sync_ms` stadig er frisk — og logger man
 * ind paa et *andet* panel, ser man det gamles kanaler indtil da.
 */
export async function clearLastSyncMs(db: SqlDatabase): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key = ?', [KEY_LAST_SYNC]);
}

/**
 * Mini-preview er slaaet til som standard, men er appens mest skroebelige del:
 * panelet tillader én samtidig forbindelse, saa hver ny preview skal lukke den
 * forrige helt ned foerst. Spec sec.7 kraever derfor at den kan slaas fra.
 */
export async function getMiniPreviewEnabled(db: SqlDatabase): Promise<boolean> {
  return (await getSetting(db, KEY_PREVIEW)) !== 'off';
}

export async function setMiniPreviewEnabled(
  db: SqlDatabase,
  enabled: boolean,
): Promise<void> {
  await setSetting(db, KEY_PREVIEW, enabled ? 'on' : 'off');
}

/**
 * Hvilket containerformat live-streams hentes i.
 *
 * `auto` er platformens valg: `.ts` paa Android for lavere forsinkelse, HLS
 * alle andre steder fordi AVPlayer ikke kan afspille raa MPEG-TS.
 *
 * Valget er brugerens, fordi forskellen er maalbar paa netop det panelet
 * leverer: raa MPEG-TS har ingen tidslinje ud over de tidsstempler
 * transportstroemmen selv baerer, og en afspiller der estimerer forkert faar
 * undertekster til at loebe foran billedet. HLS beskriver hvert segments
 * laengde og har ikke det problem, men koster et par sekunders forsinkelse.
 * Hvilken af de to der er bedst kan kun afgoeres paa det panel man har.
 */
export type StreamFormatSetting = 'auto' | 'ts' | 'm3u8';

export async function getStreamFormatSetting(db: SqlDatabase): Promise<StreamFormatSetting> {
  const value = await getSetting(db, KEY_STREAM_FORMAT);
  return value === 'ts' || value === 'm3u8' ? value : 'auto';
}

export async function setStreamFormatSetting(
  db: SqlDatabase,
  value: StreamFormatSetting,
): Promise<void> {
  await setSetting(db, KEY_STREAM_FORMAT, value);
}

/**
 * Hvorfor logo-registret sidst ikke kunne hentes, eller null naar det gik godt.
 *
 * Gemmes fordi alternativet er at gaette. Hentningen sker i baggrunden, og
 * fejler den, staar der bare at registret ikke er hentet — uden at nogen kan
 * se om det var netvaerket, filen eller databasen. Fejlteksten kommer fra
 * hentningen af et offentligt register uden legitimation, saa der er intet at
 * skjule i den.
 */
export async function getRegistryError(db: SqlDatabase): Promise<string | null> {
  const value = await getSetting(db, KEY_REGISTRY_ERROR);
  return value === null || value.length === 0 ? null : value;
}

export async function setRegistryError(
  db: SqlDatabase,
  message: string | null,
): Promise<void> {
  await setSetting(db, KEY_REGISTRY_ERROR, message ?? '');
}

/**
 * Om det aabne logo-register maa hentes og bruges.
 *
 * Til som standard, men det skal kunne slaas **fra**. Registret er appens
 * tungeste enkeltdel — syv megabyte og over 60.000 raekker — og den der ikke
 * faar noget ud af det, skal kunne fjerne det helt frem for at leve med det.
 * Det er ogsaa den hurtigste maade at afgoere om et problem stammer derfra.
 */
export async function getLogoRegistryEnabled(db: SqlDatabase): Promise<boolean> {
  return (await getSetting(db, KEY_REGISTRY_ENABLED)) !== 'off';
}

export async function setLogoRegistryEnabled(
  db: SqlDatabase,
  enabled: boolean,
): Promise<void> {
  await setSetting(db, KEY_REGISTRY_ENABLED, enabled ? 'on' : 'off');
}

/**
 * Brugerens egen noegle til YouTubes Data API, eller null.
 *
 * Valgfri. Med den kan appen soege efter en rigtig trailer naar panelets er
 * en teaser paa otte sekunder, og vaelge en der er lang nok. Uden den aabnes
 * YouTubes soegeside inde i appen i stedet — det virker, men man vaelger selv.
 */
export async function getYoutubeApiKey(db: SqlDatabase): Promise<string | null> {
  const value = await getSetting(db, KEY_YOUTUBE_API_KEY);
  return value === null || value.trim().length === 0 ? null : value.trim();
}

export async function setYoutubeApiKey(db: SqlDatabase, key: string): Promise<void> {
  await setSetting(db, KEY_YOUTUBE_API_KEY, key.trim());
}

/**
 * Foretrukket undertekstsprog i film og serier.
 *
 * `auto` er telefonens eget sprog, `off` er ingen undertekster, ellers en
 * sprogkode. Afspilleren vaelger sporet selv naar filen er aabnet, saa man
 * ikke skal ind og vaelge det samme hver gang.
 */
export type SubtitlePreference = 'auto' | 'off' | 'da' | 'en' | 'sv' | 'no' | 'de';

const SUBTITLE_PREFERENCES: readonly SubtitlePreference[] = ['auto', 'off', 'da', 'en', 'sv', 'no', 'de'];

export async function getSubtitlePreference(db: SqlDatabase): Promise<SubtitlePreference> {
  const value = await getSetting(db, KEY_SUBTITLE_LANGUAGE);
  return SUBTITLE_PREFERENCES.find((option) => option === value) ?? 'auto';
}

export async function setSubtitlePreference(
  db: SqlDatabase,
  value: SubtitlePreference,
): Promise<void> {
  await setSetting(db, KEY_SUBTITLE_LANGUAGE, value);
}

/**
 * Brugerens egen noegle til The Movie Database, eller null. Valgfri: med
 * den fyldes plakater ind for de film og serier panelet ikke gav en.
 */
export async function getTmdbApiKey(db: SqlDatabase): Promise<string | null> {
  const value = await getSetting(db, KEY_TMDB_API_KEY);
  return value === null || value.trim().length === 0 ? null : value.trim();
}

export async function setTmdbApiKey(db: SqlDatabase, key: string): Promise<void> {
  await setSetting(db, KEY_TMDB_API_KEY, key.trim());
}

/** Den kanal der sidst blev aabnet, til "Se videre" oeverst i favoritterne. */
export async function getLastChannelId(db: SqlDatabase): Promise<string | null> {
  const value = await getSetting(db, KEY_LAST_CHANNEL);
  return value === null || value.length === 0 ? null : value;
}

export async function setLastChannelId(db: SqlDatabase, channelId: string): Promise<void> {
  await setSetting(db, KEY_LAST_CHANNEL, channelId);
}

/**
 * Brugerens egen noegle og soegemaskine-id (cx) til Googles billedsoegning,
 * til logoer Wikidata ikke har. Begge skal vaere sat foer der spoerges.
 */
export async function getGoogleSearchKeys(db: SqlDatabase): Promise<{ key: string; cx: string } | null> {
  const [key, cx] = await Promise.all([getSetting(db, KEY_GOOGLE_SEARCH_KEY), getSetting(db, KEY_GOOGLE_SEARCH_CX)]);
  if (key === null || cx === null || key.trim().length === 0 || cx.trim().length === 0) return null;
  return { key: key.trim(), cx: cx.trim() };
}

export async function getGoogleSearchFields(db: SqlDatabase): Promise<{ key: string; cx: string }> {
  const [key, cx] = await Promise.all([getSetting(db, KEY_GOOGLE_SEARCH_KEY), getSetting(db, KEY_GOOGLE_SEARCH_CX)]);
  return { key: key ?? '', cx: cx ?? '' };
}

export async function setGoogleSearchKey(db: SqlDatabase, key: string): Promise<void> {
  await setSetting(db, KEY_GOOGLE_SEARCH_KEY, key.trim());
}

export async function setGoogleSearchCx(db: SqlDatabase, cx: string): Promise<void> {
  await setSetting(db, KEY_GOOGLE_SEARCH_CX, cx.trim());
}

/** En streamingtjeneste valgt til forsiden, som TMDB kender den. */
export interface HomeProvider {
  id: number;
  name: string;
  logoUrl: string | null;
  /** Landet hylden slaas op i. Aeldre gemte valg uden land er danske. */
  region: string;
}

/**
 * Tjenesterne forsiden viser hylder for, i den orden de blev valgt.
 * Gemmes som JSON i én raekke; det er en haandfuld, ikke en tabel.
 */
export async function getHomeProviders(db: SqlDatabase): Promise<HomeProvider[]> {
  const value = await getSetting(db, KEY_HOME_PROVIDERS);
  if (value === null || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is HomeProvider =>
        typeof entry === 'object' && entry !== null && typeof (entry as HomeProvider).id === 'number' && typeof (entry as HomeProvider).name === 'string',
    ).map((entry) => ({
      id: entry.id,
      name: entry.name,
      logoUrl: typeof entry.logoUrl === 'string' ? entry.logoUrl : null,
      region: typeof entry.region === 'string' && entry.region.length > 0 ? entry.region : 'DK',
    }));
  } catch {
    return [];
  }
}

export async function setHomeProviders(db: SqlDatabase, providers: readonly HomeProvider[]): Promise<void> {
  await setSetting(db, KEY_HOME_PROVIDERS, JSON.stringify(providers));
}

const KEY_THEME_MODE = 'theme_mode';
const KEY_THEME_PLACE = 'theme_place';

/** Temaet: foelg solen (standard), foelg telefonen, moerkt eller lyst. Se ui/themeMode.ts. */
export async function getThemeMode(db: SqlDatabase): Promise<'sun' | 'system' | 'dark' | 'light'> {
  const value = await getSetting(db, KEY_THEME_MODE);
  return value === 'system' || value === 'dark' || value === 'light' ? value : 'sun';
}

export async function setThemeMode(db: SqlDatabase, mode: 'sun' | 'system' | 'dark' | 'light'): Promise<void> {
  await setSetting(db, KEY_THEME_MODE, mode);
}

/** Stedet solen regnes for (noegle i PLACES), eller null for standarden. */
export async function getThemePlace(db: SqlDatabase): Promise<string | null> {
  return getSetting(db, KEY_THEME_PLACE);
}

export async function setThemePlace(db: SqlDatabase, key: string): Promise<void> {
  await setSetting(db, KEY_THEME_PLACE, key);
}

const KEY_VIDEO_SURFACE = 'video_surface';

/**
 * Hvordan videoen tegnes paa Android: SurfaceView (standard, bedst til
 * HDR og ydelse) eller TextureView. Et valg til fejlsoegning: en groen
 * skaerm med lyd paa arkivstreams kan vaere overfladen, ikke streamen.
 */
export type VideoSurface = 'surface' | 'texture';

export async function getVideoSurface(db: SqlDatabase): Promise<VideoSurface> {
  return (await getSetting(db, KEY_VIDEO_SURFACE)) === 'texture' ? 'texture' : 'surface';
}

export async function setVideoSurface(db: SqlDatabase, value: VideoSurface): Promise<void> {
  await setSetting(db, KEY_VIDEO_SURFACE, value);
}
