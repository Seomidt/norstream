import { useEffect, useState } from 'react';
import { isSongSaved, removeSavedSong, saveSong } from '../../storage/savedSongs.js';
import type { SqlDatabase } from '../../storage/types.js';

export interface SaveSongControl {
  saved: boolean;
  onToggle: () => void;
}

/**
 * Knappen "Gem sang" i radioafspilleren: om den sang der spiller allerede
 * er gemt, og et tryk der gemmer eller fjerner den. Null naar streamen
 * ikke fortaeller nogen sang.
 */
export function useSaveSong(
  db: SqlDatabase,
  song: { artist: string; track: string } | null,
  station: string,
): SaveSongControl | null {
  const artist = song?.artist ?? '';
  const track = song?.track ?? '';
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSaved(false);
    if (artist.length === 0 || track.length === 0) return;
    void isSongSaved(db, artist, track).then((value) => {
      if (!cancelled) setSaved(value);
    });
    return () => {
      cancelled = true;
    };
  }, [db, artist, track]);

  if (artist.length === 0 || track.length === 0) return null;
  return {
    saved,
    onToggle: () => {
      const next = !saved;
      setSaved(next);
      void (next ? saveSong(db, { artist, track, station }) : removeSavedSong(db, artist, track));
    },
  };
}
