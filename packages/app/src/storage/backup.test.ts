import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, parseBackup, restoreBackup, serialiseBackup } from './backup.js';
import { listChannels, replaceCategories, replaceChannels, setFavorite } from './channels.js';
import { addCategoryToFavorites } from './favorites.js';
import { setLogoOverride } from './logoOverrides.js';
import { migrate } from './schema.js';
import { addSource } from './sources.js';
import { setSubtitlePreference, setTimeshiftDialect } from './settings.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

async function installation(url: string, username: string): Promise<{ db: SqlDatabase; sourceId: string }> {
  const db = createTestDatabase();
  await migrate(db);
  const sourceId = (await addSource(db, { kind: 'xtream', name: 'Panel', url, username })).id;
  await replaceCategories(db, sourceId, [{ id: '1', name: 'DANMARK' }]);
  await replaceChannels(db, sourceId, [
    { id: '10', name: 'DNK| DR1 HD', number: 1, logoUrl: null, categoryId: '1', epgChannelId: null, hasArchive: false, archiveDays: 0 },
    { id: '11', name: 'DNK| DR2 HD', number: 2, logoUrl: null, categoryId: '1', epgChannelId: null, hasArchive: false, archiveDays: 0 },
    { id: '12', name: 'DNK| TV 2 HD', number: 3, logoUrl: null, categoryId: '1', epgChannelId: null, hasArchive: false, archiveDays: 0 },
  ]);
  return { db, sourceId };
}

let old: { db: SqlDatabase; sourceId: string };

beforeEach(async () => {
  old = await installation('http://panel.example', 'user1');
  await addCategoryToFavorites(old.db, `${old.sourceId}:1`);
  await setFavorite(old.db, `${old.sourceId}:11`, false);
  await setLogoOverride(old.db, `${old.sourceId}:12`, 'https://mit/tv2.png');
  await old.db.runAsync("INSERT INTO hidden_countries (name) VALUES ('SE')");
  await setSubtitlePreference(old.db, 'da');
  await setTimeshiftDialect(old.db, 'php', old.sourceId);
  await old.db.runAsync("INSERT INTO settings (key, value) VALUES ('last_sync_ms', '123')");
  await old.db.runAsync(`INSERT INTO vod_watchlist (item_key, added_ms) VALUES ('${old.sourceId}:movie-7', 5)`);
});

describe('createBackup', () => {
  it('tager brugerens eget med, og ikke appens bogholderi', async () => {
    const backup = await createBackup(old.db, 1000);
    expect(backup.sources).toEqual([
      { id: old.sourceId, kind: 'xtream', name: 'Panel', url: 'http://panel.example', username: 'user1', xmltvUrl: null },
    ]);
    expect(backup.favorites.map((f) => f.channelId)).toEqual([`${old.sourceId}:10`, `${old.sourceId}:12`]);
    expect(backup.favoriteExclusions).toEqual([{ channelId: `${old.sourceId}:11`, categoryId: `${old.sourceId}:1` }]);
    expect(backup.logoOverrides).toEqual([{ channelKey: `${old.sourceId}:12`, url: 'https://mit/tv2.png' }]);
    expect(backup.hiddenCountries).toEqual(['SE']);
    expect(backup.settings).toEqual({ subtitle_language: 'da', [`timeshift_dialect:${old.sourceId}`]: 'php' });
    expect(backup.watchlist).toEqual([{ itemKey: `${old.sourceId}:movie-7`, addedMs: 5 }]);
  });

  it('overlever en tur gennem tekst', async () => {
    const backup = await createBackup(old.db, 1000);
    expect(parseBackup(serialiseBackup(backup))).toEqual(backup);
  });

  it('tager panel-kodeordet med naar en henter det (til den krypterede sky-kopi)', async () => {
    const backup = await createBackup(old.db, 1000, async (id) =>
      id === old.sourceId ? { password: 'hemmelig123' } : null,
    );
    expect(backup.sources[0].password).toBe('hemmelig123');
    // Og det overlever en tur gennem tekst.
    expect(parseBackup(serialiseBackup(backup)).sources[0].password).toBe('hemmelig123');
  });

  it('tager ikke kodeord med uden en henter (den lokale/ukrypterede vej)', async () => {
    const backup = await createBackup(old.db, 1000);
    expect(backup.sources[0].password).toBeUndefined();
  });

  it('gemmer kanalnavne for favoritter og logo (til match paa et andet panel)', async () => {
    const backup = await createBackup(old.db, 1000);
    expect(backup.channelNames?.[`${old.sourceId}:10`]).toBe('DNK| DR1 HD');
    expect(backup.channelNames?.[`${old.sourceId}:12`]).toBe('DNK| TV 2 HD');
  });
});

describe('parseBackup', () => {
  it('afviser noget der ikke er en sikkerhedskopi', () => {
    expect(() => parseBackup('hej')).toThrow('ikke en sikkerhedskopi');
    expect(() => parseBackup('{"app":"other","version":1}')).toThrow('ikke en sikkerhedskopi');
    expect(() => parseBackup('{"app":"norstream","version":99}')).toThrow('nyere udgave');
  });

  it('taaler manglende afsnit', () => {
    const backup = parseBackup('{"app":"norstream","version":1}');
    expect(backup.favorites).toEqual([]);
    expect(backup.settings).toEqual({});
  });
});

describe('restoreBackup', () => {
  it('oversaetter kildens id til den nye installations, paa adresse og brugernavn', async () => {
    const backup = await createBackup(old.db);
    // Samme panel, logget ind paa ny: nyt id, afsluttende skraastreg og store bogstaver.
    const fresh = await installation('HTTP://panel.example/', 'user1');
    expect(fresh.sourceId).not.toBe(old.sourceId);

    const result = await restoreBackup(fresh.db, backup);

    expect(result.missingSources).toEqual([]);
    expect(result.favorites).toBe(2);
    const favourites = (await listChannels(fresh.db, { favouritesOnly: true })).map((c) => c.id);
    expect(favourites).toEqual([`${fresh.sourceId}:10`, `${fresh.sourceId}:12`]);
    const exclusions = await fresh.db.getAllAsync<{ channel_id: string; category_id: string }>(
      'SELECT channel_id, category_id FROM favorite_exclusions',
    );
    expect(exclusions).toEqual([{ channel_id: `${fresh.sourceId}:11`, category_id: `${fresh.sourceId}:1` }]);
    const override = await fresh.db.getFirstAsync<{ channel_key: string }>('SELECT channel_key FROM logo_overrides');
    expect(override?.channel_key).toBe(`${fresh.sourceId}:12`);
    expect(result.overrideKeys).toEqual([`${fresh.sourceId}:12`]);
    const dialect = await fresh.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      [`timeshift_dialect:${fresh.sourceId}`],
    );
    expect(dialect?.value).toBe('php');
    const subtitles = await fresh.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'subtitle_language'",
    );
    expect(subtitles?.value).toBe('da');
    const watchlist = await fresh.db.getAllAsync<{ item_key: string }>('SELECT item_key FROM vod_watchlist');
    expect(watchlist).toEqual([{ item_key: `${fresh.sourceId}:movie-7` }]);
    expect(await fresh.db.getAllAsync('SELECT * FROM hidden_countries')).toEqual([{ name: 'SE' }]);
  });

  it('springer over det der hoerer til en kilde der ikke findes, og siger hvilken', async () => {
    const backup = await createBackup(old.db);
    const fresh = await installation('http://other.example', 'user1');

    const result = await restoreBackup(fresh.db, backup);

    expect(result.missingSources).toEqual(['Panel']);
    expect(result.favorites).toBe(0);
    expect(await fresh.db.getAllAsync('SELECT * FROM favorites')).toEqual([]);
    // Det der ikke hoerer til en kilde, kommer med alligevel.
    expect(result.hiddenCountries).toBe(1);
    expect(result.settings).toBe(1);
  });

  it('finder favoritter og logo igen paa et ANDET panel via kanalnavn (1:1 kopi)', async () => {
    const backup = await createBackup(old.db);
    // Et helt andet panel — anden adresse og bruger — og andre kanal-id'er,
    // men samme kanalnavne. Uden navne-match ville intet af det haenge paa.
    const fresh = createTestDatabase();
    await migrate(fresh);
    const freshId = (await addSource(fresh, { kind: 'xtream', name: 'Andet', url: 'http://andet.example', username: 'bruger2' })).id;
    await replaceCategories(fresh, freshId, [{ id: '99', name: 'ALT' }]);
    await replaceChannels(fresh, freshId, [
      { id: 'aa', name: 'DR1', number: 1, logoUrl: null, categoryId: '99', epgChannelId: null, hasArchive: false, archiveDays: 0 },
      { id: 'bb', name: 'TV 2', number: 2, logoUrl: null, categoryId: '99', epgChannelId: null, hasArchive: false, archiveDays: 0 },
    ]);

    const result = await restoreBackup(fresh, backup, { matchByName: true });

    // Favoritterne (DR1 og TV 2) fandt de nye kanaler paa navn — nye id'er.
    const favourites = (await listChannels(fresh, { favouritesOnly: true })).map((c) => c.id).sort();
    expect(favourites).toEqual([`${freshId}:aa`, `${freshId}:bb`].sort());
    expect(result.favorites).toBe(2);
    // Det egne TV 2-logo fulgte med til den nye TV 2-kanal.
    const override = await fresh.getFirstAsync<{ channel_key: string }>('SELECT channel_key FROM logo_overrides');
    expect(override?.channel_key).toBe(`${freshId}:bb`);
  });

  it('matcher IKKE paa navn uden matchByName (uaendret adfaerd)', async () => {
    const backup = await createBackup(old.db);
    const fresh = await installation('http://andet.example', 'bruger2');
    const result = await restoreBackup(fresh.db, backup);
    expect(result.favorites).toBe(0);
  });

  it('erstatter favoritterne frem for at blande', async () => {
    const backup = await createBackup(old.db);
    await setFavorite(old.db, `${old.sourceId}:11`, true);
    await old.db.runAsync("INSERT INTO settings (key, value) VALUES ('last_sync_ms:x', '1')");

    await restoreBackup(old.db, backup);

    const favourites = (await listChannels(old.db, { favouritesOnly: true })).map((c) => c.id);
    expect(favourites).toEqual([`${old.sourceId}:10`, `${old.sourceId}:12`]);
    // Bogholderiet roeres ikke.
    expect(await old.db.getFirstAsync("SELECT value FROM settings WHERE key = 'last_sync_ms'")).toEqual({ value: '123' });
  });

  it('ignorerer indstillinger kopien ikke maa saette', async () => {
    const fresh = await installation('http://panel.example', 'user1');
    await restoreBackup(fresh.db, parseBackup('{"app":"norstream","version":1,"settings":{"last_sync_ms":"1","subtitle_language":"en"}}'));
    expect(await fresh.db.getFirstAsync("SELECT value FROM settings WHERE key = 'last_sync_ms'")).toBeNull();
    expect(await fresh.db.getFirstAsync("SELECT value FROM settings WHERE key = 'subtitle_language'")).toEqual({ value: 'en' });
  });
});
