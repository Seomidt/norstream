import type { YoutubeFormat } from './youtubeStream.js';

export interface ProofMedia extends YoutubeFormat { url: string; contentLength: number }
export interface ProofResult { video: ProofMedia; audio: ProofMedia; seconds: number; userAgent: string }

/** Den usynlige WebView maa kun bruge broen til YouTubes kendte API/JS. */
export function proofRequestAllowed(url: string, method: string): boolean {
  if (method !== 'GET' && method !== 'POST') return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    if (u.hostname === 'www.google.com') return method === 'GET' && u.pathname.startsWith('/js/');
    if (u.hostname !== 'www.youtube.com') return false;
    if (method === 'POST') return u.pathname.startsWith('/youtubei/v1/') || u.pathname === '/api/jnn/v1/GenerateIT';
    return u.pathname === '/' || u.pathname === '/iframe_api' || u.pathname.startsWith('/s/player/') || u.pathname.startsWith('/js/');
  } catch { return false; }
}
function media(value: unknown, kind: 'video' | 'audio'): value is ProofMedia {
  if (!value || typeof value !== 'object') return false;
  const v = value as ProofMedia;
  try {
    const url = new URL(v.url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com') || url.username || url.password || !url.searchParams.get('pot')) return false;
  } catch { return false; }
  return typeof v.mimeType === 'string' && v.mimeType.startsWith(`${kind}/`) &&
    Number.isSafeInteger(v.contentLength) && v.contentLength > 1000 && v.contentLength <= 80 * 1024 * 1024 &&
    [v.initRange, v.indexRange].every((r) => r && /^\d+$/.test(r.start) && /^\d+$/.test(r.end) && Number(r.start) <= Number(r.end) && Number(r.end) < v.contentLength) &&
    (kind !== 'video' || Number.isInteger(v.height) && v.height! > 0 && v.height! <= 1080);
}
export function isProofResult(value: unknown): value is ProofResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as ProofResult;
  return media(v.video, 'video') && media(v.audio, 'audio') &&
    Number.isFinite(v.seconds) && v.seconds >= 60 && v.seconds <= 360 &&
    typeof v.userAgent === 'string' && v.userAgent.length > 0 && v.userAgent.length <= 1024 && !/[\r\n]/.test(v.userAgent);
}
/** Hele filen skal passe; HTTP 200 kan ogsaa vaere en HTML-fejlside. */
export function completeProofFile(actual: number, expected: number): boolean {
  return Number.isSafeInteger(expected) && expected > 1000 && actual === expected;
}
