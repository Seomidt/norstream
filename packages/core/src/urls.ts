import type { StreamFormat, XtreamCredentials } from './models.js';

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
