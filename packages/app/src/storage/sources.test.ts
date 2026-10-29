import { beforeEach, describe, expect, it } from 'vitest';
import { channelKey, parseChannelKey } from '@norstream/core';
import {
  addSource,
  adoptLegacyKeys,
  deleteSource,
  getSource,
  listEnabledSources,
  listSources,
  newSourceId,
  purgeDisabledSourceData,
  renameSource,
  setSourceEnabled,
} from './sources.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('newSourceId', () => {
  it('laver aldrig et id med skilletegnet i', () => {
    // Et kolon i kilde-id'et ville braekke hver eneste kanalnoegle.
    for (let i = 0; i < 200; i += 1) {
      expect(newSourceId()).not.toContain(':');
    }
  });

  it('giver forskellige id i samme millisekund', () => {
    const now = new Date('2026-09-06T18:00:00.000Z');
    const ids = new Set(Array.from({ length: 50 }, () => newSourceId(now)));
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe('addSource og listSources', () => {
  it('gemmer et panel med brugernavn, men uden adgangskode', async () => {
    const source = await addSource(db, {
      kind: 'xtream',
      name: 'Hovedpanel',
      url: 'http://panel.example:8080',
      username: 'seomidt',
    });

    const stored = await getSource(db, source.id);
    expect(stored).toEqual({
      id: source.id,
      kind: 'xtream',
      name: 'Hovedpanel',
      url: 'http://panel.example:8080',
      username: 'seomidt',
      xmltvUrl: null,
      enabled: true,
      sortOrder: 0,
    });

    // Adgangskoden hoerer til i Keychain. Er der en kolonne til den her,
    // ender den i en ukrypteret SQLite-fil.
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(sources)');
    expect(columns.map((c) => c.name)).not.toContain('password');
  });

  it('gemmer en M3U-liste med sin XMLTV-adresse', async () => {
    const source = await addSource(db, {
      kind: 'm3u',
      name: 'Sport',
      url: 'http://liste.example/liste.m3u',
      xmltvUrl: 'http://liste.example/epg.xml',
    });
    expect((await getSource(db, source.id))?.xmltvUrl).toBe('http://liste.example/epg.xml');
  });

  it('holder raekkefoelgen som de blev tilfoejet', async () => {
    await addSource(db, { kind: 'xtream', name: 'Én', url: 'http://a' });
    await addSource(db, { kind: 'm3u', name: 'To', url: 'http://b' });
    expect((await listSources(db)).map((s) => s.name)).toEqual(['Én', 'To']);
  });
});

describe('slaa en kilde fra', () => {
  it('lader den staa, men holder den ude af de aktive', async () => {
    const a = await addSource(db, { kind: 'xtream', name: 'A', url: 'http://a' });
    await addSource(db, { kind: 'xtream', name: 'B', url: 'http://b' });

    await setSourceEnabled(db, a.id, false);

    expect((await listSources(db)).map((s) => s.name)).toEqual(['A', 'B']);
    expect((await listEnabledSources(db)).map((s) => s.name)).toEqual(['B']);
  });

  it('kan omdoebes', async () => {
    const a = await addSource(db, { kind: 'xtream', name: 'A', url: 'http://a' });
    await renameSource(db, a.id, 'Hovedpanel');
    expect((await getSource(db, a.id))?.name).toBe('Hovedpanel');
  });
});

describe('purgeDisabledSourceData', () => {
  it('fjerner kanaler, kategorier og film for fravalgte kilder, men lader de aktive staa', async () => {
    const a = await addSource(db, { kind: 'xtream', name: 'A', url: 'http://a' });
    const b = await addSource(db, { kind: 'xtream', name: 'B', url: 'http://b' });

    for (const source of [a, b]) {
      const key = channelKey(source.id, '1');
      await db.runAsync(
        `INSERT INTO channels (id, source_id, stream_id, name) VALUES (?, ?, '1', 'DR1')`,
        [key, source.id],
      );
      await db.runAsync('INSERT INTO categories (id, source_id, name) VALUES (?, ?, ?)', [
        channelKey(source.id, 'c1'),
        source.id,
        'DENMARK',
      ]);
      await db.runAsync(
        `INSERT INTO vod_items (key, source_id, item_id, kind, name) VALUES (?, ?, 'v1', 'movie', 'Film')`,
        [channelKey(source.id, 'v1'), source.id],
      );
    }

    // Fil A slaas fra: dens kanaler skal forsvinde ved naeste hentning.
    await setSourceEnabled(db, a.id, false);
    await purgeDisabledSourceData(db);

    const channels = await db.getAllAsync<{ source_id: string }>('SELECT source_id FROM channels');
    expect(channels.map((row) => row.source_id)).toEqual([b.id]);
    const categories = await db.getAllAsync<{ source_id: string }>(
      'SELECT source_id FROM categories',
    );
    expect(categories.map((row) => row.source_id)).toEqual([b.id]);
    const vod = await db.getAllAsync<{ source_id: string }>('SELECT source_id FROM vod_items');
    expect(vod.map((row) => row.source_id)).toEqual([b.id]);

    // Kilden selv bliver staaende, saa den kan slaas til igen.
    expect(await getSource(db, a.id)).not.toBeNull();
  });

  it('roerer intet naar alle kilder er aktive', async () => {
    const a = await addSource(db, { kind: 'xtream', name: 'A', url: 'http://a' });
    await db.runAsync(
      `INSERT INTO channels (id, source_id, stream_id, name) VALUES (?, ?, '1', 'DR1')`,
      [channelKey(a.id, '1'), a.id],
    );
    await purgeDisabledSourceData(db);
    expect(await db.getAllAsync('SELECT id FROM channels')).toHaveLength(1);
  });
});

describe('deleteSource', () => {
  it('tager alt fra kilden med, og rører ikke de andres', async () => {
    const a = await addSource(db, { kind: 'xtream', name: 'A', url: 'http://a' });
    const b = await addSource(db, { kind: 'xtream', name: 'B', url: 'http://b' });

    for (const source of [a, b]) {
      const key = channelKey(source.id, '1');
      await db.runAsync(
        `INSERT INTO channels (id, source_id, stream_id, name) VALUES (?, ?, '1', 'DR1')`,
        [key, source.id],
      );
      await db.runAsync('INSERT INTO categories (id, source_id, name) VALUES (?, ?, ?)', [
        channelKey(source.id, 'c1'),
        source.id,
        'DENMARK',
      ]);
      await db.runAsync('INSERT INTO favorites (channel_id, source_category_id) VALUES (?, NULL)', [key]);
      await db.runAsync('INSERT INTO programmes VALUES (?, 1, 2, ?, NULL)', [key, 'Titel']);
      await db.runAsync('INSERT INTO epg_fetch VALUES (?, 1)', [key]);
    }

    await deleteSource(db, a.id);

    const channels = await db.getAllAsync<{ id: string }>('SELECT id FROM channels');
    expect(channels.map((row) => parseChannelKey(row.id)?.sourceId)).toEqual([b.id]);
    const favorites = await db.getAllAsync<{ channel_id: string }>(
      'SELECT channel_id FROM favorites',
    );
    expect(favorites).toHaveLength(1);
    const programmes = await db.getAllAsync<{ channel_id: string }>(
      'SELECT channel_id FROM programmes',
    );
    expect(programmes).toHaveLength(1);
    expect(await getSource(db, a.id)).toBeNull();
    expect(await getSource(db, b.id)).not.toBeNull();
  });
});

describe('adoptLegacyKeys', () => {
  it('giver gamle favoritter og optagelser kildens noegle', async () => {
    // Sadan saa databasen ud da appen kun kunne ét panel.
    await db.runAsync("INSERT INTO favorites (channel_id, source_category_id) VALUES ('247634', NULL)");
    await db.runAsync("INSERT INTO favorite_exclusions VALUES ('99', 'dk')");
    await db.runAsync(
      `INSERT INTO recordings
         (id, channel_id, channel_name, title, start_ms, stop_ms, archive_days, state, bytes, created_at)
       VALUES ('247634:1000', '247634', 'DR1', 'Bjerget', 1000, 2000, 7, 'planned', 0, 1)`,
    );

    await adoptLegacyKeys(db, 'src1');

    const favorite = await db.getFirstAsync<{ channel_id: string }>(
      'SELECT channel_id FROM favorites',
    );
    expect(favorite?.channel_id).toBe('src1:247634');

    const recording = await db.getFirstAsync<{ id: string; channel_id: string }>(
      'SELECT id, channel_id FROM recordings',
    );
    expect(recording?.channel_id).toBe('src1:247634');
    // Optagelsens id er kanal plus starttidspunkt, og kanaldelen skiftede.
    expect(recording?.id).toBe('src1:247634:1000');
  });

  it('kan koeres igen uden at laegge noeglen paa to gange', async () => {
    await db.runAsync("INSERT INTO favorites (channel_id, source_category_id) VALUES ('247634', NULL)");
    await adoptLegacyKeys(db, 'src1');
    await adoptLegacyKeys(db, 'src1');
    const favorite = await db.getFirstAsync<{ channel_id: string }>(
      'SELECT channel_id FROM favorites',
    );
    expect(favorite?.channel_id).toBe('src1:247634');
  });
});
