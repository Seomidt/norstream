import { Directory, File, Paths } from 'expo-file-system';
import {
  getOpenSubtitlesSettings,
  getOpenSubtitlesToken,
  getTmdbApiKey,
  setOpenSubtitlesToken,
} from '../../storage/settings.js';
import type { SqlDatabase } from '../../storage/types.js';
import { getVodItem, listEpisodes } from '../../storage/vod.js';
import { cleanVodTitle, findTitleInfo, tmdbFetch } from '../../sync/tmdb.js';
import { downloadSubtitle, login, parseSrt, searchSubtitles } from './openSubtitles.js';
import type { Cue, GetText, OsHttp, OsSession, SubtitleQuery } from './openSubtitles.js';

/**
 * Henter undertekster udefra til det der spilles (v338) — limen mellem
 * afspilleren, databasen og OpenSubtitles. Reglerne selv (opslag, rangering,
 * SRT) er i openSubtitles.ts og testet dér.
 *
 * Hentede filer gemmes under dokumenter/undertekster, saa samme film ikke
 * bruger af dagens kvote igen naar man ser videre en anden dag.
 */

const FOLDER = 'undertekster';
const TIMEOUT_MS = 15_000;
/** Login-tokenet fornyes efter saa lang tid (OpenSubtitles giver ca. et doegn). */
const TOKEN_MAX_AGE_MS = 20 * 60 * 60_000;

export interface SubtitleRequest {
  /** Filmens eller afsnittets noegle (som fremdriften gemmes under). */
  progressKey: string;
  /** Serien, naar det er et afsnit. */
  seriesKey: string | null;
  episodeKey: string | null;
  language: string;
  /** Hvilken af kandidaterne (0 = bedste). "Proev en anden" taeller op. */
  index: number;
}

export type SubtitleResult =
  | { kind: 'ok'; cues: Cue[]; index: number; count: number }
  | { kind: 'nokey' }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

async function timed(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const http: OsHttp = async (method, url, headers, body) => {
  const response = await timed(url, { method, headers, ...(body === undefined ? {} : { body }) });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
};

const getText: GetText = async (url) => {
  try {
    const response = await timed(url, {});
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
};

function folder(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function cacheFile(request: SubtitleRequest): File {
  const safe = request.progressKey.replace(/[^A-Za-z0-9_-]/g, '_');
  return new File(folder(), `${safe}-${request.language}-${request.index}.srt`);
}

/** Sessionen: noeglen, og et frisk login-token hvis brugernavn og kodeord er sat. */
async function session(db: SqlDatabase): Promise<OsSession | null> {
  const settings = await getOpenSubtitlesSettings(db);
  if (settings.apiKey === null) return null;
  if (settings.username === null || settings.password === null) return { apiKey: settings.apiKey };
  const saved = await getOpenSubtitlesToken(db);
  if (saved !== null && Date.now() - saved.issuedMs < TOKEN_MAX_AGE_MS) {
    return { apiKey: settings.apiKey, token: saved.token, baseUrl: saved.baseUrl };
  }
  try {
    const fresh = await login(http, settings.apiKey, settings.username, settings.password);
    await setOpenSubtitlesToken(db, { ...fresh, issuedMs: Date.now() });
    return { apiKey: settings.apiKey, token: fresh.token, baseUrl: fresh.baseUrl };
  } catch {
    // Login virker ikke (forkert kodeord, nede): hent med noeglen alene.
    return { apiKey: settings.apiKey };
  }
}

/** Hvad der soeges paa: filmens/seriens numre fra TMDB, ellers titel og aar. */
async function query(db: SqlDatabase, request: SubtitleRequest): Promise<SubtitleQuery | null> {
  const titleKey = request.seriesKey ?? request.progressKey;
  const item = await getVodItem(db, titleKey);
  if (item === null) return null;
  const { title, year } = cleanVodTitle(item.name);
  const kind = request.seriesKey === null ? 'movie' : 'series';
  const tmdbKey = await getTmdbApiKey(db);
  const info = tmdbKey === null ? null : await findTitleInfo(tmdbFetch, tmdbKey, kind, item.name).catch(() => null);
  let season: number | null = null;
  let episode: number | null = null;
  if (request.seriesKey !== null && request.episodeKey !== null) {
    const found = (await listEpisodes(db, request.seriesKey)).find((e) => e.key === request.episodeKey);
    if (found === undefined) return null;
    season = found.season;
    episode = found.episode;
  }
  return {
    kind: request.seriesKey === null ? 'movie' : 'episode',
    imdbId: info?.imdbId ?? null,
    title: info?.englishTitle ?? title,
    year: info?.year ?? year ?? item.year,
    season,
    episode,
    language: request.language,
  };
}

export async function loadExternalSubtitles(db: SqlDatabase, request: SubtitleRequest): Promise<SubtitleResult> {
  try {
    const cached = cacheFile(request);
    if (cached.exists) {
      const cues = parseSrt(await cached.text());
      // Antallet af kandidater kendes ikke fra cachen; "proev en anden" er
      // stadig mulig (et nyt opslag afgoer om der er flere).
      if (cues.length > 0) return { kind: 'ok', cues, index: request.index, count: request.index + 2 };
    }
    const os = await session(db);
    if (os === null) return { kind: 'nokey' };
    const q = await query(db, request);
    if (q === null) return { kind: 'none' };
    const candidates = await searchSubtitles(http, os, q);
    const chosen = candidates[request.index];
    if (chosen === undefined) return { kind: 'none' };
    const { text } = await downloadSubtitle(http, getText, os, chosen.fileId);
    const cues = parseSrt(text);
    if (cues.length === 0) return { kind: 'error', message: 'Undertekstfilen var tom eller ulæselig.' };
    try {
      const file = cacheFile(request);
      if (file.exists) file.delete();
      file.create();
      file.write(text);
    } catch {
      // Uden cache virker det stadig; den hentes bare igen naeste gang.
    }
    return { kind: 'ok', cues, index: request.index, count: candidates.length };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'Underteksten kunne ikke hentes.' };
  }
}

/**
 * "Test" i Indstillinger: virker noeglen (og evt. login)? Soeger danske
 * undertekster til The Matrix — en titel der altid har dem.
 */
export async function testOpenSubtitles(db: SqlDatabase): Promise<string> {
  try {
    const os = await session(db);
    if (os === null) return 'Skriv API-nøglen først.';
    const found = await searchSubtitles(http, os, { kind: 'movie', imdbId: 'tt0133093', title: 'The Matrix', language: 'da' });
    const who = os.token === undefined || os.token === null ? 'uden login' : 'logget ind';
    return found.length > 0 ? `Virker (${who}).` : `Nøglen virker (${who}), men søgningen gav intet.`;
  } catch (error) {
    return error instanceof Error ? error.message : 'Kunne ikke nå OpenSubtitles.';
  }
}
