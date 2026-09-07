import type { StreamFormat, TimeshiftDialect, XtreamCredentials } from './models.js';

/** Fjerner afsluttende skråstreger, så URL-sammensætning altid giver ét skilletegn. */
export function normaliseBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function buildLiveUrl(
  creds: XtreamCredentials,
  streamId: string,
  format: StreamFormat,
): string {
  const base = normaliseBaseUrl(creds.baseUrl);
  const user = encodeURIComponent(creds.username);
  const pass = encodeURIComponent(creds.password);
  return `${base}/live/${user}/${pass}/${encodeURIComponent(streamId)}.${format}`;
}

/**
 * Adressen paa en film.
 *
 * Endelsen er panelets egen (`mkv`, `mp4`, `avi`) og staar paa filmen i
 * listen. Den kan ikke vaelges frit som for live-tv: filen ligger som den
 * ligger, og en forkert endelse er en 404.
 */
export function buildMovieUrl(
  creds: XtreamCredentials,
  streamId: string,
  containerExtension: string | null,
): string {
  const base = normaliseBaseUrl(creds.baseUrl);
  const user = encodeURIComponent(creds.username);
  const pass = encodeURIComponent(creds.password);
  const ext = containerExtension ?? 'mp4';
  return `${base}/movie/${user}/${pass}/${encodeURIComponent(streamId)}.${ext}`;
}

/** Adressen paa et afsnit. Samme regel for endelsen som film. */
export function buildEpisodeUrl(
  creds: XtreamCredentials,
  episodeId: string,
  containerExtension: string | null,
): string {
  const base = normaliseBaseUrl(creds.baseUrl);
  const user = encodeURIComponent(creds.username);
  const pass = encodeURIComponent(creds.password);
  const ext = containerExtension ?? 'mp4';
  return `${base}/series/${user}/${pass}/${encodeURIComponent(episodeId)}.${ext}`;
}

/** Bygger URL'en til panelets XMLTV-EPG-endpoint. */
export function buildXmltvUrl(creds: XtreamCredentials): string {
  const base = normaliseBaseUrl(creds.baseUrl);
  const user = encodeURIComponent(creds.username);
  const pass = encodeURIComponent(creds.password);
  return `${base}/xmltv.php?username=${user}&password=${pass}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Formaterer et tidspunkt som `YYYY-MM-DD:HH-MM` i panelets tidszone.
 * `panelOffsetMinutes` er panelets offset fra UTC; 0 betyder at panelet kører UTC.
 */
export function formatTimeshiftStart(date: Date, panelOffsetMinutes = 0): string {
  const shifted = new Date(date.getTime() + panelOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const mo = pad(shifted.getUTCMonth() + 1);
  const d = pad(shifted.getUTCDate());
  const h = pad(shifted.getUTCHours());
  const mi = pad(shifted.getUTCMinutes());
  return `${y}-${mo}-${d}:${h}-${mi}`;
}

/**
 * Bygger URL'en til et udsnit af panelets arkiv.
 *
 * `format` gaelder kun `path`-dialekten, som lægger et filnavn i stien.
 * Standarden er `m3u8`, fordi det er en spilleliste en afspiller vil have.
 * Til **optagelse** skal der `ts`: henter man `.m3u8` ned som fil, faar man
 * spillelisten — nogle faa kilobyte tekst der peger paa segmenter der ikke
 * findes i morgen — og ikke udsendelsen.
 *
 * `php`-dialekten har intet filnavn at aendre; den leverer transportstroemmen
 * direkte, og `format` er uden betydning der.
 */
export function buildTimeshiftUrl(
  creds: XtreamCredentials,
  streamId: string,
  start: Date,
  durationMinutes: number,
  dialect: TimeshiftDialect,
  panelOffsetMinutes = 0,
  format: StreamFormat = 'm3u8',
): string {
  const base = normaliseBaseUrl(creds.baseUrl);
  const startStr = formatTimeshiftStart(start, panelOffsetMinutes);
  const duration = Math.max(1, Math.ceil(durationMinutes));
  const user = encodeURIComponent(creds.username);
  const pass = encodeURIComponent(creds.password);

  if (dialect === 'php') {
    const query = [
      `username=${user}`,
      `password=${pass}`,
      `stream=${encodeURIComponent(streamId)}`,
      `start=${encodeURIComponent(startStr)}`,
      `duration=${duration}`,
    ].join('&');
    return `${base}/streaming/timeshift.php?${query}`;
  }

  return `${base}/timeshift/${user}/${pass}/${duration}/${startStr}/${encodeURIComponent(streamId)}.${format}`;
}
