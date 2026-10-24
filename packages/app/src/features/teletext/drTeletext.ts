/** DR's originale billedsider. HTML fra DR tegnes aldrig som kode i appen. */
const ORIGIN = 'https://www.dr.dk';
const PAGE_PATH = '/cgi-bin/fttv1.exe/';
export const TELETEXT_REFRESH_MS = 60_000;

export interface DrTeletextPage {
  number: number;
  imageUrl: string;
  width: number;
  height: number;
  previous: number;
  next: number;
}

export interface LoadedTeletextPage extends DrTeletextPage {
  imageData: string;
  loadedAt: number;
}

export class TeletextError extends Error {
  constructor(readonly kind: 'missing' | 'source' | 'network') { super(kind); }
}

export function isTeletextPage(page: number): boolean {
  return Number.isInteger(page) && page >= 100 && page <= 899;
}

export function adjacentTeletextPage(page: number, direction: -1 | 1): number {
  return page === 100 && direction === -1 ? 899 : page === 899 && direction === 1 ? 100 : page + direction;
}

export function drTeletextUrl(page: number, at: number): string {
  if (!isTeletextPage(page)) throw new TeletextError('missing');
  // DR's GIF-navn skifter. En gammel cachet HTML-side kan pege paa en slettet GIF.
  return `${ORIGIN}${PAGE_PATH}${page}?_=${at}`;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function linkedPage(href: string | null): number | null {
  if (href === null) return null;
  try {
    const url = new URL(href, ORIGIN);
    if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash) return null;
    const match = /^\/cgi-bin\/fttv1\.exe\/([1-8]\d{2})$/.exec(url.pathname);
    return match ? Number(match[1]) : null;
  } catch { return null; }
}

export function readDrTeletextPage(html: string, page: number): DrTeletextPage {
  if (!isTeletextPage(page) || html.length > 100_000) throw new TeletextError('source');
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  if (!new RegExp(`TEKST-TV side ${page}\\b`, 'i').test(title)) throw new TeletextError('source');
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = attribute(tag, 'src');
    if (src === null) continue;
    let image: URL;
    try { image = new URL(src, ORIGIN); } catch { continue; }
    if (image.origin !== ORIGIN || image.username || image.password || image.search || image.hash) continue;
    if (!new RegExp(`^/fttvimg/DR1/${page}_\\d{4}(?:-\\d+)?\\.gif$`, 'i').test(image.pathname)) continue;
    const width = Number(attribute(tag, 'width'));
    const height = Number(attribute(tag, 'height'));
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2000 || height > 2000) {
      throw new TeletextError('source');
    }
    const footer = (html.match(/<map\b[^>]*>[\s\S]*?<\/map>/gi) ?? [])
      .find(map => attribute(map.slice(0, map.indexOf('>') + 1), 'name')?.toLowerCase() === 'fpmap0');
    const links = (footer?.match(/<area\b[^>]*>/gi) ?? [])
      .map(area => linkedPage(attribute(area, 'href'))).filter((n): n is number => n !== null);
    return {
      number: page, imageUrl: image.href, width, height,
      previous: links[0] ?? adjacentTeletextPage(page, -1),
      next: links[1] ?? adjacentTeletextPage(page, 1),
    };
  }
  // DR returnerer ogsaa HTTP 200 og en korrekt titel for sider der ikke findes.
  throw new TeletextError('missing');
}

interface TeletextResponse {
  ok: boolean;
  status: number;
  url?: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type TeletextFetch = (url: string, init: RequestInit) => Promise<TeletextResponse>;

function assertOrigin(url: string | undefined): void {
  if (url && new URL(url).origin !== ORIGIN) throw new TeletextError('source');
}

/** Smaa GIF-filer omsaettes uden Buffer eller andre Node-afhaengigheder. */
function base64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!; const b = bytes[i + 1] ?? 0; const c = bytes[i + 2] ?? 0;
    parts.push(alphabet[a >> 2]!, alphabet[((a & 3) << 4) | (b >> 4)]!,
      i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)]! : '=',
      i + 2 < bytes.length ? alphabet[c & 63]! : '=');
  }
  return parts.join('');
}

export async function loadDrTeletextPage(
  page: number, signal: AbortSignal, fetchImpl: TeletextFetch = fetch, now: () => number = Date.now,
): Promise<LoadedTeletextPage> {
  const init: RequestInit = { signal, credentials: 'omit', headers: { 'Cache-Control': 'no-cache' } };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchImpl(drTeletextUrl(page, now() + attempt), init);
    if (!response.ok) throw new TeletextError('network');
    assertOrigin(response.url);
    const parsed = readDrTeletextPage(await response.text(), page);
    const image = await fetchImpl(parsed.imageUrl, init);
    assertOrigin(image.url);
    if (image.status === 404 && attempt === 0) continue;
    if (!image.ok) throw new TeletextError('network');
    const bytes = new Uint8Array(await image.arrayBuffer());
    const magic = String.fromCharCode(...bytes.slice(0, 6));
    if (bytes.length < 13 || bytes.length > 1_000_000 || (magic !== 'GIF87a' && magic !== 'GIF89a')) {
      throw new TeletextError('source');
    }
    return { ...parsed, imageData: `data:image/gif;base64,${base64(bytes)}`, loadedAt: now() };
  }
  throw new TeletextError('network');
}

/** Kun det originale billede, isoleret fra scripts, cookies og navigation. */
export function teletextImageDocument(page: LoadedTeletextPage): string {
  if (!/^data:image\/gif;base64,[A-Za-z0-9+/]+=*$/.test(page.imageData)) throw new TeletextError('source');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">` +
    `<style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}</style>` +
    `</head><body><img alt="DR Tekst-tv side ${page.number}" src="${page.imageData}"></body></html>`;
}
