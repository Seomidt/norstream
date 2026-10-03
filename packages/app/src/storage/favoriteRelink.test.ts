import { beforeEach, describe, expect, it } from 'vitest';
import type { Channel } from '@norstream/core';
import {
  listChannels,
  relinkOrphanedFavorites,
  replaceCategories,
  replaceChannels,
  setFavorite,
} from './channels.js';
import { addCategoryToFavorites } from './favorites.js';
import { addSource } from './sources.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

function ch(id: string, name: string, categoryId = 'c1'): Channel {
  return { id, name, number: null, logoUrl: null, categoryId, epgChannelId: null, hasArchive: false, archiveDays: 0 };
}

let db: SqlDatabase;
beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('favoritter overlever at kanal-id skifter', () => {
  it('gemmer kanalnavnet paa favoritten', async () => {
    const s = await addSource(db, { kind: 'xtream', name: 'Hakuna', url: 'http://h' });
    await replaceCategories(db, s.id, [{ id: 'c1', name: 'DK' }]);
    await replaceChannels(db, s.id, [ch('1', 'DR1 HD')]);
    const [dr1] = await listChannels(db, {});
    await setFavorite(db, dr1!.id, true);

    const row = await db.getFirstAsync<{ match_key: string }>(
      'SELECT match_key FROM favorites WHERE channel_id = ?',
      [dr1!.id],
    );
    expect(row?.match_key).toBeTruthy();
  });

  it('gen-haegter en favorit naar panelet giver kanalen et nyt id', async () => {
    const s = await addSource(db, { kind: 'xtream', name: 'Hakuna', url: 'http://h' });
    await replaceCategories(db, s.id, [{ id: 'c1', name: 'DK' }]);
    // Foerst med stream_id "1"
    await replaceChannels(db, s.id, [ch('1', 'DR1 HD'), ch('2', 'TV2')]);
    for (const c of await listChannels(db, {})) await setFavorite(db, c.id, true);
    expect((await listChannels(db, { favouritesOnly: true })).length).toBe(2);

    // Panelet omnummererer: samme kanaler, nye stream_id'er
    await replaceChannels(db, s.id, [ch('11', 'DR1 HD'), ch('22', 'TV2')]);
    // Nu peger favoritterne paa id'er der ikke findes -> tomme
    expect((await listChannels(db, { favouritesOnly: true })).length).toBe(0);

    await relinkOrphanedFavorites(db);

    const favs = await listChannels(db, { favouritesOnly: true });
    expect(favs.map((c) => c.name).sort()).toEqual(['DR1 HD', 'TV2']);
    // Nye id'er
    expect(favs.map((c) => c.id).sort()).toEqual([`${s.id}:11`, `${s.id}:22`].sort());
  });

  it('gen-haegter ikke paa tvaers af kilder (samme navn, anden fil)', async () => {
    const a = await addSource(db, { kind: 'xtream', name: 'Hakuna', url: 'http://a' });
    const b = await addSource(db, { kind: 'm3u', name: 'Test', url: 'http://b' });
    await replaceCategories(db, a.id, [{ id: 'c1', name: 'DK' }]);
    await replaceChannels(db, a.id, [ch('1', 'DR1 HD')]);
    for (const c of await listChannels(db, {})) await setFavorite(db, c.id, true);

    // Fil A's kanal forsvinder helt; fil B har en kanal med samme navn
    await replaceChannels(db, a.id, []);
    await replaceCategories(db, b.id, [{ id: 'c1', name: 'DK' }]);
    await replaceChannels(db, b.id, [ch('9', 'DR1 HD')]);

    await relinkOrphanedFavorites(db);
    // Maa IKKE haegte Hakunas favorit paa Test-filens kanal
    expect((await listChannels(db, { favouritesOnly: true })).length).toBe(0);
  });

  it('rydder den forael­dede raekke hvis kanalen allerede er favorit under nyt id', async () => {
    const s = await addSource(db, { kind: 'xtream', name: 'Hakuna', url: 'http://h' });
    await replaceCategories(db, s.id, [{ id: 'c1', name: 'DK' }]);
    await replaceChannels(db, s.id, [ch('1', 'DR1 HD')]);
    await setFavorite(db, `${s.id}:1`, true);
    // Simulér en forael­det favorit paa et gammelt id med samme navn
    await db.runAsync(
      "INSERT INTO favorites (channel_id, match_key, position) VALUES (?, ?, 5)",
      [`${s.id}:gammel`, 'dr1'],
    );

    await relinkOrphanedFavorites(db);
    const favs = await listChannels(db, { favouritesOnly: true });
    expect(favs.length).toBe(1);
    expect(favs[0]!.id).toBe(`${s.id}:1`);
  });

  it('gen-haegter IKKE en dansk favorit paa en svensk kanal med samme navn', async () => {
    // Det rod v24 retter: navnet renses for land ("DNK| DR1 HD" og "SWE| DR1"
    // bliver begge "dr1"), saa uden landet med ville en dansk favorit kunne
    // blive hgtet paa en svensk kanal.
    const s = await addSource(db, { kind: 'xtream', name: 'Hakuna', url: 'http://h' });
    await replaceCategories(db, s.id, [{ id: 'c1', name: 'Blandet' }]);
    // Svensk DR1 staar foerst (lavere sort_order); dansk DR1 favoriseres.
    await replaceChannels(db, s.id, [ch('1', 'SWE| DR1'), ch('2', 'DNK| DR1 HD')]);
    const dansk = (await listChannels(db, {})).find((c) => c.name === 'DNK| DR1 HD');
    await setFavorite(db, dansk!.id, true);

    // Panelet omnummererer begge kanaler.
    await replaceChannels(db, s.id, [ch('11', 'SWE| DR1'), ch('22', 'DNK| DR1 HD')]);
    expect((await listChannels(db, { favouritesOnly: true })).length).toBe(0);

    await relinkOrphanedFavorites(db);

    const favs = await listChannels(db, { favouritesOnly: true });
    expect(favs.length).toBe(1);
    // Skal ramme den DANSKE kanal igen, ikke den svenske.
    expect(favs[0]!.name).toBe('DNK| DR1 HD');
    expect(favs[0]!.id).toBe(`${s.id}:22`);
  });

  it('gaetter ikke paa tvaers naar landet er ukendt og navnet er flertydigt', async () => {
    // Gammel favorit fra foer v24: intet land gemt. Er der to kanaler med samme
    // navn (fx dansk og svensk DR1), maa den hellere staa tom end gaette.
    const s = await addSource(db, { kind: 'xtream', name: 'Hakuna', url: 'http://h' });
    await replaceCategories(db, s.id, [{ id: 'c1', name: 'Blandet' }]);
    await replaceChannels(db, s.id, [ch('11', 'SWE| DR1'), ch('22', 'DNK| DR1 HD')]);
    // Foraeldet favorit med match_key men UDEN land (country = NULL).
    await db.runAsync(
      "INSERT INTO favorites (channel_id, match_key, country, position) VALUES (?, 'dr1', NULL, 0)",
      [`${s.id}:gammel`],
    );

    await relinkOrphanedFavorites(db);

    // Flertydigt navn uden land: ingen gen-haegtning.
    expect((await listChannels(db, { favouritesOnly: true })).length).toBe(0);
  });

  it('addCategoryToFavorites gemmer ogsaa navnet', async () => {
    const s = await addSource(db, { kind: 'xtream', name: 'Hakuna', url: 'http://h' });
    await replaceCategories(db, s.id, [{ id: 'c1', name: 'DK' }]);
    await replaceChannels(db, s.id, [ch('1', 'DR1 HD'), ch('2', 'TV2')]);
    await addCategoryToFavorites(db, `${s.id}:c1`);

    const rows = await db.getAllAsync<{ match_key: string | null }>('SELECT match_key FROM favorites');
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.match_key !== null && r.match_key !== '')).toBe(true);
  });
});
