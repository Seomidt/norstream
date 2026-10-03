import type { SqlDatabase } from './types.js';

/**
 * Sange gemt fra radioen.
 *
 * Streamen fortaeller "Kunstner - Titel"; et tryk gemmer den her, saa man
 * kan finde den igen — og aabne den i Spotify med ét tryk. Bilen kan ogsaa
 * gemme (bogmaerket i Android Auto); tjenesten laegger dem til side, og
 * appen foerer dem ind her naar den aabnes.
 */
export interface SavedSong {
  artist: string;
  track: string;
  /** Stationen den blev hoert paa. */
  station: string;
  savedMs: number;
}

export async function saveSong(db: SqlDatabase, song: Omit<SavedSong, 'savedMs'>, now = Date.now()): Promise<void> {
  const artist = song.artist.trim();
  const track = song.track.trim();
  if (artist.length === 0 || track.length === 0) return;
  await db.runAsync(
    `INSERT INTO saved_songs (artist, track, station, saved_ms) VALUES (?, ?, ?, ?)
     ON CONFLICT(artist, track) DO UPDATE SET station = excluded.station, saved_ms = excluded.saved_ms`,
    [artist, track, song.station, now],
  );
}

export async function removeSavedSong(db: SqlDatabase, artist: string, track: string): Promise<void> {
  await db.runAsync('DELETE FROM saved_songs WHERE artist = ? AND track = ?', [artist.trim(), track.trim()]);
}

export async function isSongSaved(db: SqlDatabase, artist: string, track: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM saved_songs WHERE artist = ? AND track = ?', [
    artist.trim(),
    track.trim(),
  ]);
  return (row?.n ?? 0) > 0;
}

/** Nyeste foerst. */
export async function listSavedSongs(db: SqlDatabase): Promise<SavedSong[]> {
  const rows = await db.getAllAsync<{ artist: string; track: string; station: string; saved_ms: number }>(
    'SELECT artist, track, station, saved_ms FROM saved_songs ORDER BY saved_ms DESC',
  );
  return rows.map((row) => ({ artist: row.artist, track: row.track, station: row.station, savedMs: row.saved_ms }));
}

/**
 * Spotifys egen soegning: app-adressen aabner appen direkte naar den er
 * installeret, web-adressen virker altid.
 */
export function spotifyAppUrl(song: Pick<SavedSong, 'artist' | 'track'>): string {
  return `spotify:search:${encodeURIComponent(`${song.artist} ${song.track}`)}`;
}

export function spotifyWebUrl(song: Pick<SavedSong, 'artist' | 'track'>): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${song.artist} ${song.track}`)}`;
}
