import { beforeEach, describe, expect, it } from 'vitest';
import { isSongSaved, listSavedSongs, removeSavedSong, saveSong, spotifyAppUrl, spotifyWebUrl } from './savedSongs.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

describe('gemte sange', () => {
  let db: SqlDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
  });

  it('gemmer, viser nyeste foerst, og gemmer samme sang kun én gang', async () => {
    await saveSong(db, { artist: 'Kim Larsen', track: 'Susan Himmelblå', station: 'P4' }, 1000);
    await saveSong(db, { artist: 'TV-2', track: 'Nærmest lykkelig', station: 'P3' }, 2000);
    await saveSong(db, { artist: ' Kim Larsen ', track: 'Susan Himmelblå', station: 'P5' }, 3000);
    const songs = await listSavedSongs(db);
    expect(songs.map((s) => `${s.artist} – ${s.track} (${s.station})`)).toEqual([
      'Kim Larsen – Susan Himmelblå (P5)',
      'TV-2 – Nærmest lykkelig (P3)',
    ]);
    expect(await isSongSaved(db, 'Kim Larsen', 'Susan Himmelblå')).toBe(true);
    await removeSavedSong(db, 'Kim Larsen', 'Susan Himmelblå');
    expect(await isSongSaved(db, 'Kim Larsen', 'Susan Himmelblå')).toBe(false);
    expect(await listSavedSongs(db)).toHaveLength(1);
  });

  it('springer tomme sange over', async () => {
    await saveSong(db, { artist: '', track: 'x', station: 'P4' }, 1000);
    expect(await listSavedSongs(db)).toHaveLength(0);
  });

  it('laver Spotify-adresser der kan aabnes', () => {
    const song = { artist: 'Kim Larsen', track: 'Susan Himmelblå' };
    expect(spotifyAppUrl(song)).toBe('spotify:search:Kim%20Larsen%20Susan%20Himmelbl%C3%A5');
    expect(spotifyWebUrl(song)).toBe('https://open.spotify.com/search/Kim%20Larsen%20Susan%20Himmelbl%C3%A5');
  });
});
