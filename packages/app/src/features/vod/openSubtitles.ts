/**
 * Danske undertekster fra OpenSubtitles (v338) — naar filmen eller afsnittet
 * ikke selv har dem.
 *
 * OpenSubtitles.com har en officiel, gratis API. Den kraever en API-noegle
 * (brugeren laver den selv: opensubtitles.com → Profil → API consumers) og
 * tillader et antal hentninger i doegnet — flere med et (gratis) login.
 * Noeglen og login ligger kun paa enheden (Indstillinger), aldrig i koden.
 *
 * Opslag: film paa IMDb-/TMDB-nummer (fra `findTitleInfo`), afsnit paa
 * seriens nummer + saeson og afsnit; uden numre paa titel og aar. De bedste
 * kandidater: menneske-oversat foer maskine-oversat, saa flest hentninger.
 * Selve filen hentes som SRT og tegnes af appen (`SubtitleOverlay`), fordi
 * afspilleren ikke kan tage undertekster udefra.
 *
 * Fejlbeskeder er korte og paa dansk og rummer aldrig noeglen.
 */

export const OPENSUBTITLES_API = 'https://api.opensubtitles.com/api/v1';
/** OpenSubtitles kraever appens navn og version som User-Agent. */
export const OPENSUBTITLES_USER_AGENT = 'NorStream v1';

export interface OsResponse {
  status: number;
  json: unknown;
}

/** HTTP mod OpenSubtitles; kaster ved netfejl. */
export type OsHttp = (method: 'GET' | 'POST', url: string, headers: Record<string, string>, body?: string) => Promise<OsResponse>;
/** Henter en fil som tekst; null ved fejl. */
export type GetText = (url: string) => Promise<string | null>;

export interface OsSession {
  apiKey: string;
  /** Fra login; uden token hentes med noeglens egen (mindre) kvote. */
  token?: string | null;
  /** Login kan pege paa en anden vaert (fx VIP). */
  baseUrl?: string | null;
}

export interface SubtitleQuery {
  kind: 'movie' | 'episode';
  /** tt1234567 eller 1234567. Filmens — eller for et afsnit: seriens. */
  imdbId?: string | null;
  /** TMDB-nummer. Filmens — eller for et afsnit: seriens. */
  tmdbId?: number | null;
  title: string;
  year?: number | null;
  season?: number | null;
  episode?: number | null;
  /** ISO 639-1, fx "da". */
  language: string;
}

export interface SubtitleCandidate {
  fileId: number;
  release: string;
  downloads: number;
  machine: boolean;
  hearingImpaired: boolean;
}

function base(session: OsSession): string {
  const host = session.baseUrl?.trim();
  if (host !== undefined && host !== null && host.length > 0) {
    const clean = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return `https://${clean}/api/v1`;
  }
  return OPENSUBTITLES_API;
}

export function osHeaders(session: OsSession): Record<string, string> {
  const headers: Record<string, string> = {
    'Api-Key': session.apiKey.trim(),
    'User-Agent': OPENSUBTITLES_USER_AGENT,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (session.token !== undefined && session.token !== null && session.token.length > 0) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  return headers;
}

/** "tt0133093" / "133093" -> 133093; ellers null. */
export function imdbNumber(id: string | null | undefined): number | null {
  const match = /^(?:tt)?0*(\d{1,10})$/i.exec((id ?? '').trim());
  return match === null ? null : Number(match[1]);
}

/**
 * Soege-adressen. OpenSubtitles vil have parametrene i alfabetisk orden og
 * med smaa bogstaver — ellers sender den en omdirigering.
 */
export function searchUrl(session: OsSession, query: SubtitleQuery): string {
  const params: Record<string, string> = { languages: query.language.toLowerCase() };
  const imdb = imdbNumber(query.imdbId);
  const tmdb = typeof query.tmdbId === 'number' && query.tmdbId > 0 ? query.tmdbId : null;
  if (query.kind === 'episode') {
    params.type = 'episode';
    if (imdb !== null) params.parent_imdb_id = String(imdb);
    else if (tmdb !== null) params.parent_tmdb_id = String(tmdb);
    else params.query = query.title.toLowerCase();
    if (typeof query.season === 'number') params.season_number = String(query.season);
    if (typeof query.episode === 'number') params.episode_number = String(query.episode);
  } else {
    params.type = 'movie';
    if (imdb !== null) params.imdb_id = String(imdb);
    else if (tmdb !== null) params.tmdb_id = String(tmdb);
    else {
      params.query = query.title.toLowerCase();
      if (typeof query.year === 'number') params.year = String(query.year);
    }
  }
  const qs = Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k] as string)}`)
    .join('&');
  return `${base(session)}/subtitles?${qs}`;
}

interface RawSubtitle {
  attributes?: {
    language?: string;
    download_count?: number;
    hearing_impaired?: boolean;
    ai_translated?: boolean;
    machine_translated?: boolean;
    release?: string;
    files?: Array<{ file_id?: number }>;
  };
}

/** Kandidaterne i svaret, bedste foerst. */
export function rankSubtitles(json: unknown, language: string): SubtitleCandidate[] {
  const data = (json as { data?: RawSubtitle[] } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: SubtitleCandidate[] = [];
  for (const item of data) {
    const a = item.attributes;
    if (a === undefined) continue;
    if (typeof a.language === 'string' && a.language.toLowerCase() !== language.toLowerCase()) continue;
    const fileId = a.files?.[0]?.file_id;
    if (typeof fileId !== 'number') continue;
    out.push({
      fileId,
      release: a.release ?? '',
      downloads: typeof a.download_count === 'number' ? a.download_count : 0,
      machine: a.ai_translated === true || a.machine_translated === true,
      hearingImpaired: a.hearing_impaired === true,
    });
  }
  out.sort((x, y) => Number(x.machine) - Number(y.machine) || y.downloads - x.downloads);
  return out;
}

function reason(status: number): string {
  if (status === 401 || status === 403) return 'OpenSubtitles afviste nøglen eller login.';
  if (status === 406 || status === 429) return 'Dagens antal hentninger fra OpenSubtitles er brugt.';
  return `OpenSubtitles svarede ${status}.`;
}

export async function searchSubtitles(http: OsHttp, session: OsSession, query: SubtitleQuery): Promise<SubtitleCandidate[]> {
  const response = await http('GET', searchUrl(session, query), osHeaders(session));
  if (response.status !== 200) throw new Error(reason(response.status));
  return rankSubtitles(response.json, query.language);
}

/** Henter én undertekst som SRT-tekst. */
export async function downloadSubtitle(
  http: OsHttp,
  getText: GetText,
  session: OsSession,
  fileId: number,
): Promise<{ text: string; remaining: number | null }> {
  const response = await http('POST', `${base(session)}/download`, osHeaders(session), JSON.stringify({ file_id: fileId, sub_format: 'srt' }));
  if (response.status !== 200) throw new Error(reason(response.status));
  const body = response.json as { link?: unknown; remaining?: unknown } | null;
  const link = typeof body?.link === 'string' ? body.link : null;
  if (link === null || !link.startsWith('https://')) throw new Error('OpenSubtitles gav ingen fil.');
  const text = await getText(link);
  if (text === null || text.trim().length === 0) throw new Error('Underteksten kunne ikke hentes.');
  return { text, remaining: typeof body?.remaining === 'number' ? body.remaining : null };
}

/** Login (valgfrit): flere hentninger om dagen. Svarer token og evt. anden vaert. */
export async function login(
  http: OsHttp,
  apiKey: string,
  username: string,
  password: string,
): Promise<{ token: string; baseUrl: string | null }> {
  const response = await http(
    'POST',
    `${OPENSUBTITLES_API}/login`,
    osHeaders({ apiKey }),
    JSON.stringify({ username, password }),
  );
  if (response.status !== 200) throw new Error(reason(response.status));
  const body = response.json as { token?: unknown; base_url?: unknown } | null;
  if (typeof body?.token !== 'string' || body.token.length === 0) throw new Error('Login gav intet token.');
  return { token: body.token, baseUrl: typeof body.base_url === 'string' ? body.base_url : null };
}

// ---------------------------------------------------------------------------
// SRT

export interface Cue {
  /** Sekunder. */
  start: number;
  end: number;
  text: string;
}

function seconds(stamp: string): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(stamp.trim());
  if (m === null) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] ?? '0').padEnd(3, '0')) / 1000;
}

/** Fjerner formatering (<i>, {\an8}) — teksten tegnes af appen selv. */
function clean(line: string): string {
  return line
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .trim();
}

export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    const timeIndex = lines.findIndex((l) => l.includes('-->'));
    if (timeIndex < 0) continue;
    const [from, to] = (lines[timeIndex] ?? '').split('-->');
    const start = seconds((from ?? '').trim());
    const end = seconds((to ?? '').trim().split(/\s+/)[0] ?? '');
    if (start === null || end === null || end <= start) continue;
    const body = lines.slice(timeIndex + 1).map(clean).filter((l) => l.length > 0).join('\n');
    if (body.length === 0) continue;
    cues.push({ start, end, text: body });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/** Teksten der skal vises til tiden `t` (sekunder), eller null. Binaer soegning. */
export function cueAt(cues: readonly Cue[], t: number): string | null {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((cues[mid] as Cue).start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Overlappende replikker: den nyeste der stadig er i gang.
  for (let i = found; i >= 0 && i > found - 3; i--) {
    const cue = cues[i] as Cue;
    if (cue.start <= t && t < cue.end) return cue.text;
  }
  return null;
}
