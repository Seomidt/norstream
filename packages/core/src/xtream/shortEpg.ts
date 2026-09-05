import { decodeBase64Utf8 } from '../base64.js';
import type { Programme } from '../models.js';
import { toInteger } from './coerce.js';

/**
 * En post fra `action=get_short_epg`. Titel og beskrivelse er base64-kodede;
 * tidsstemplerne er epoch-**sekunder**, ikke millisekunder, og kommer typisk
 * som strenge.
 */
export interface RawShortEpgListing {
  title?: string;
  description?: string;
  start_timestamp?: string | number;
  stop_timestamp?: string | number;
  /** Nogle paneler navngiver sluttidspunktet saadan. */
  end_timestamp?: string | number;
}

/**
 * Panelet svarer normalt `{ "epg_listings": [...] }`, men et bart array er set
 * i naturen. Begge accepteres; alt andet giver en tom liste.
 */
function listingsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && raw !== null) {
    const nested = (raw as { epg_listings?: unknown }).epg_listings;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

/**
 * Afkoder et base64-felt. `null` betyder "brug den ikke": enten var feltet der
 * ikke, eller ogsaa kunne det ikke afkodes til gyldig UTF-8.
 */
function decodeField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const decoded = decodeBase64Utf8(value);
  if (decoded === null) return null;
  const trimmed = decoded.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Epoch-sekunder til Date. Afviser nul, negative og ikke-numeriske vaerdier. */
function secondsToDate(value: unknown): Date | null {
  const seconds = toInteger(value);
  if (seconds === null || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

function mapListing(streamId: string, raw: RawShortEpgListing): Programme | null {
  // En post uden laesbar titel springes over frem for at blive vist som en
  // base64-klump. Beskrivelsen er valgfri og maa gerne mangle.
  const title = decodeField(raw.title);
  if (title === null) return null;

  const start = secondsToDate(raw.start_timestamp);
  const stop = secondsToDate(raw.stop_timestamp ?? raw.end_timestamp);
  if (start === null || stop === null) return null;
  // Et program der slutter foer det begynder ville braekke guidens
  // bredde-beregning og kan kun komme af beskadigede data.
  if (stop.getTime() <= start.getTime()) return null;

  return {
    channelId: streamId,
    title,
    description: decodeField(raw.description),
    start,
    stop,
  };
}

/**
 * Oversaetter svaret fra `get_short_epg` til programmer.
 *
 * `streamId` kommer fra kalderen, ikke fra svaret: opslaget skete paa
 * stream_id, og det er den noegle programmerne skal gemmes under. Svarets eget
 * `channel_id` er panelets EPG-id, som 87 % af kanalerne ikke har.
 *
 * Kaster aldrig. Ugyldige poster udelades; resultatet er sorteret efter
 * starttidspunkt, saa guiden kan laegge rækken ud uden at sortere igen.
 */
export function mapShortEpg(streamId: string, raw: unknown): Programme[] {
  const out: Programme[] = [];
  for (const item of listingsOf(raw)) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const mapped = mapListing(streamId, item as RawShortEpgListing);
    if (mapped) out.push(mapped);
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}
