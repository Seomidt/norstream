import type { Episode, VodDetails, VodItem, VodKind } from '../models.js';
import { toInteger } from './coerce.js';

/**
 * Raa VOD-JSON fra et Xtream-panel.
 *
 * Felterne er valgfrie og loest typede med vilje: paneler er ikke enige om
 * navnene (`releasedate` og `releaseDate` findes begge), om typerne (tal og
 * strenge i flaeng) eller om hvad der overhovedet er med. Hver mapper tager
 * det der er, og giver null for resten.
 */
export interface RawVodStream {
  stream_id?: string | number;
  series_id?: string | number;
  name?: string;
  stream_icon?: string | null;
  cover?: string | null;
  category_id?: string | number | null;
  rating?: string | number | null;
  added?: string | number | null;
  last_modified?: string | number | null;
  container_extension?: string | null;
  releasedate?: string | null;
  releaseDate?: string | null;
  year?: string | number | null;
}

export interface RawVodInfo {
  info?: Record<string, unknown>;
  movie_data?: Record<string, unknown>;
  seasons?: unknown;
  episodes?: unknown;
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Bedoemmelsen som et tal mellem 0 og 10, eller null.
 *
 * Nul regnes som ukendt: panelerne skriver 0 naar de ikke har en, og en film
 * med "0 af 10" er ikke en daarlig film — det er en film uden bedoemmelse.
 */
function rating(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(10, Math.round(parsed * 10) / 10);
}

/** Aaret ud af `2023-05-12`, `2023` eller `12/05/2023`. */
function year(...values: unknown[]): number | null {
  for (const value of values) {
    const raw = text(value);
    if (raw === null) continue;
    const match = /(19|20)\d{2}/.exec(raw);
    if (match !== null) return Number.parseInt(match[0], 10);
  }
  return null;
}

/** Unix-tid i sekunder, som panelerne skriver den, til en dato. */
function fromUnix(value: unknown): Date | null {
  const seconds = toInteger(value);
  if (seconds === null || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

/**
 * YouTube-id'et ud af det panelet skriver i `youtube_trailer`.
 *
 * Nogle paneler skriver id'et alene, andre en hel adresse — `watch?v=`,
 * `youtu.be/`, `embed/` — og nogle skriver ingenting. Kun id'et gemmes, saa
 * knappen altid bygger den samme adresse.
 */
export function youtubeId(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const fromUrl = /(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(raw);
  if (fromUrl?.[1] !== undefined) return fromUrl[1];
  return /^[A-Za-z0-9_-]{11}$/.test(raw) ? raw : null;
}

/**
 * Spilletid i minutter.
 *
 * Panelerne skriver den paa tre maader: `episode_run_time` i minutter,
 * `duration_secs` i sekunder, og `duration` som `01:32:00`. Den foerste der
 * giver mening, vinder.
 */
export function durationMinutes(info: Record<string, unknown>): number | null {
  const runTime = toInteger(info.episode_run_time);
  if (runTime !== null && runTime > 0) return runTime;
  const seconds = toInteger(info.duration_secs);
  if (seconds !== null && seconds > 0) return Math.round(seconds / 60);
  const clock = text(info.duration);
  if (clock !== null) {
    const parts = clock.split(':').map((part) => Number.parseInt(part, 10));
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
      const [h, m] = parts as [number, number, number];
      const total = h * 60 + m;
      if (total > 0) return total;
    }
  }
  return null;
}

/** Foerste baggrundsbillede, uanset om panelet sender ét eller en liste. */
function backdrop(value: unknown): string | null {
  if (Array.isArray(value)) return text(value[0]);
  return text(value);
}

export function mapVodItem(raw: RawVodStream, kind: VodKind): VodItem | null {
  const id = text(kind === 'movie' ? raw.stream_id : raw.series_id);
  const name = text(raw.name);
  if (!id || !name) return null;
  return {
    id,
    kind,
    name,
    posterUrl: text(raw.stream_icon) ?? text(raw.cover),
    categoryId: text(raw.category_id),
    rating: rating(raw.rating),
    year: year(raw.releasedate, raw.releaseDate, raw.year),
    added: fromUnix(raw.added) ?? fromUnix(raw.last_modified),
    containerExtension: kind === 'movie' ? text(raw.container_extension) : null,
  };
}

function mapArray<TRaw, TOut>(raw: unknown, map: (item: TRaw) => TOut | null): TOut[] {
  if (!Array.isArray(raw)) return [];
  const out: TOut[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const mapped = map(item as TRaw);
    if (mapped) out.push(mapped);
  }
  return out;
}

export function mapVodItems(raw: unknown, kind: VodKind): VodItem[] {
  return mapArray<RawVodStream, VodItem>(raw, (item) => mapVodItem(item, kind));
}

/** Det panelet ved om titlen, ud af `get_vod_info` eller `get_series_info`. */
export function mapVodDetails(raw: unknown): VodDetails {
  const info =
    typeof raw === 'object' && raw !== null && typeof (raw as RawVodInfo).info === 'object'
      ? ((raw as RawVodInfo).info as Record<string, unknown>)
      : {};
  return {
    posterUrl: text(info.movie_image) ?? text(info.cover_big) ?? text(info.cover),
    plot: text(info.plot) ?? text(info.description),
    genre: text(info.genre),
    cast: text(info.cast) ?? text(info.actors),
    director: text(info.director),
    durationMinutes: durationMinutes(info),
    trailerId: youtubeId(info.youtube_trailer),
    backdropUrl: backdrop(info.backdrop_path),
    rating: rating(info.rating),
    year: year(info.releasedate, info.releaseDate, info.year),
  };
}

/**
 * Afsnittene ud af `get_series_info`.
 *
 * `episodes` er et objekt med saesonnummeret som noegle — `{"1": [...],
 * "2": [...]}` — men nogle paneler sender en liste af lister. Begge former
 * laeses, og saesonen tages fra afsnittet selv naar det oplyser den.
 */
export function mapEpisodes(raw: unknown, seriesId: string): Episode[] {
  const container = typeof raw === 'object' && raw !== null ? (raw as RawVodInfo).episodes : null;
  if (container === null || container === undefined || typeof container !== 'object') return [];

  const groups: [string, unknown][] = Array.isArray(container)
    ? container.map((group, index) => [String(index + 1), group])
    : Object.entries(container as Record<string, unknown>);

  const episodes: Episode[] = [];
  for (const [seasonKey, group] of groups) {
    if (!Array.isArray(group)) continue;
    const seasonFromKey = toInteger(seasonKey) ?? 0;
    for (const item of group) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;
      const id = text(entry.id);
      if (id === null) continue;
      const info =
        typeof entry.info === 'object' && entry.info !== null
          ? (entry.info as Record<string, unknown>)
          : {};
      const episodeNumber = toInteger(entry.episode_num) ?? episodes.length + 1;
      episodes.push({
        id,
        seriesId,
        season: toInteger(entry.season) ?? seasonFromKey,
        episode: episodeNumber,
        title: text(entry.title) ?? `Afsnit ${episodeNumber}`,
        plot: text(info.plot),
        durationMinutes: durationMinutes(info),
        containerExtension: text(entry.container_extension),
        airDate: text(info.releasedate) ?? text(info.air_date),
      });
    }
  }
  return episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
}
