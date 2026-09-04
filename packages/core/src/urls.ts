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
  return `${base}/live/${user}/${pass}/${streamId}.${format}`;
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

export function buildTimeshiftUrl(
  creds: XtreamCredentials,
  streamId: string,
  start: Date,
  durationMinutes: number,
  dialect: TimeshiftDialect,
  panelOffsetMinutes = 0,
): string {
  const base = normaliseBaseUrl(creds.baseUrl);
  const startStr = formatTimeshiftStart(start, panelOffsetMinutes);
  const duration = Math.max(1, Math.ceil(durationMinutes));

  if (dialect === 'php') {
    const query = [
      `username=${encodeURIComponent(creds.username)}`,
      `password=${encodeURIComponent(creds.password)}`,
      `stream=${encodeURIComponent(streamId)}`,
      `start=${encodeURIComponent(startStr)}`,
      `duration=${duration}`,
    ].join('&');
    return `${base}/streaming/timeshift.php?${query}`;
  }

  const user = encodeURIComponent(creds.username);
  const pass = encodeURIComponent(creds.password);
  return `${base}/timeshift/${user}/${pass}/${duration}/${startStr}/${streamId}.m3u8`;
}
