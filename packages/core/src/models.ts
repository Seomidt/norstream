export interface Category {
  id: string;
  name: string;
}

export interface Channel {
  id: string;
  name: string;
  number: number | null;
  logoUrl: string | null;
  categoryId: string | null;
  epgChannelId: string | null;
  hasArchive: boolean;
  archiveDays: number;
}

export interface Programme {
  channelId: string;
  title: string;
  description: string | null;
  start: Date;
  stop: Date;
}

export interface XtreamCredentials {
  /** Basis-URL uden afsluttende skråstreg, fx "http://panel.example:8080" */
  baseUrl: string;
  username: string;
  password: string;
}

export type StreamFormat = 'ts' | 'm3u8';

export type TimeshiftDialect = 'php' | 'path';

/** Hvad slags VOD-post det er. Film afspilles direkte; serier har afsnit. */
export type VodKind = 'movie' | 'series';

/**
 * En film eller en serie, som den staar i panelets liste.
 *
 * Kun det panelet oplyser i **listen** — én post per titel, tusindvis af
 * dem. Handlingen, rollelisten og traileren ligger i et opslag per titel og
 * hentes foerst naar man aabner den; se `VodDetails`.
 */
export interface VodItem {
  id: string;
  kind: VodKind;
  name: string;
  posterUrl: string | null;
  categoryId: string | null;
  /** Panelets bedoemmelse paa en skala til 10, eller null naar den mangler. */
  rating: number | null;
  year: number | null;
  /** Hvornaar panelet lagde titlen op. Til "nyt paa panelet". */
  added: Date | null;
  /** Kun film: filendelsen streamen skal bedes om med — `mkv`, `mp4`. */
  containerExtension: string | null;
}

/** Det panelet ved om én titel, hentet naar den aabnes. */
export interface VodDetails {
  plot: string | null;
  genre: string | null;
  cast: string | null;
  director: string | null;
  durationMinutes: number | null;
  /** YouTube-id for traileren, eller null. Aldrig en hel adresse. */
  trailerId: string | null;
  backdropUrl: string | null;
  rating: number | null;
  year: number | null;
}

export interface Episode {
  id: string;
  seriesId: string;
  season: number;
  episode: number;
  title: string;
  plot: string | null;
  durationMinutes: number | null;
  containerExtension: string | null;
  airDate: string | null;
}

