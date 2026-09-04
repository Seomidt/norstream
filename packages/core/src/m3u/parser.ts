import type { Channel } from '../models.js';

export interface M3uEntry {
  channel: Channel;
  url: string;
}

const ATTRIBUTE = /([\w-]+)="([^"]*)"/g;

function attributes(line: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of line.matchAll(ATTRIBUTE)) {
    const [, key, value] = match;
    if (key !== undefined && value !== undefined) map.set(key, value);
  }
  return map;
}

function displayName(line: string): string {
  // Find det første komma uden for anførselstegn — et komma inde i en
  // citeret attributværdi (fx group-title="Movies, Drama") er ikke skillet
  // mellem attributter og visningsnavn.
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      return line.slice(i + 1).trim();
    }
  }
  return '';
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parser en M3U-playlist. Poster uden efterfølgende URL-linje udelades.
 * Indekset i det genererede id er postens plads i resultatet, så id'et er
 * stabilt mellem to kørsler over samme playliste — men kun hvis playlisten
 * er byte-identisk. Indsættes eller fjernes en enkelt post uden tvg-id
 * et sted i playlisten, forskydes alle senere genererede id'er.
 */
export function parseM3u(text: string): M3uEntry[] {
  const entries: M3uEntry[] = [];
  const lines = text.split(/\r?\n/);
  let pending: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    if (line.startsWith('#EXTINF:')) {
      pending = line;
      continue;
    }

    if (line.startsWith('#')) continue;

    if (pending === null) continue;

    const attrs = attributes(pending);
    const tvgId = attrs.get('tvg-id')?.trim() || null;
    const name = displayName(pending) || attrs.get('tvg-name') || 'Ukendt kanal';
    const index = entries.length;

    entries.push({
      channel: {
        id: tvgId ?? `m3u-${index}`,
        name,
        number: toNumber(attrs.get('tvg-chno')),
        logoUrl: attrs.get('tvg-logo') || null,
        categoryId: attrs.get('group-title') || null,
        epgChannelId: tvgId,
        hasArchive: false,
        archiveDays: 0,
      },
      url: line,
    });

    pending = null;
  }

  return entries;
}
