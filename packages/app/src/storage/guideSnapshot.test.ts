import { beforeEach, expect, it } from 'vitest';
import type { Channel } from '@norstream/core';
import { createBackup, restoreBackup } from './backup.js';
import { deleteOrphanedChannelData, listChannels, relinkOrphanedFavorites, replaceCategories, replaceChannels, setFavorite } from './channels.js';
import { createFavoriteGroup, deleteFavoriteGroup, listFavoriteGroups, moveFavoriteGroup, renameFavoriteGroup, setFavoriteGroupMember } from './favoriteGroups.js';
import { addCategoryToFavorites, moveFavorite, removeCategoryFromFavorites } from './favorites.js';
import { guideSnapshotRevision, invalidateGuideSnapshot, peekGuideSnapshot, saveGuideSnapshot, type GuideSnapshot } from './guideSnapshot.js';
import { clearLogoOverride, setLogoOverride } from './logoOverrides.js';
import { markEpgFetched } from './epgFetch.js';
import { upsertProgrammes } from './programmes.js';
import { invalidateQueryCache } from './queryCache.js';
import { migrate } from './schema.js';
import { getFavoriteGroup, setFavoriteGroup, setSetting, setTimeshiftDialect, sourcesWithDialect } from './settings.js';
import { addSource, adoptLegacyKeys, deleteSource, purgeDisabledSourceData, renameSource, setSourceEnabled, updateSourceDetails } from './sources.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

const SOURCE = 'guide-test';
const key = (id: string) => `${SOURCE}:${id}`;
const TOKEN = 7;
const channel = (id: string, name = id): Channel => ({
  id, name, number: null, logoUrl: null, categoryId: id === 'c' ? 'y' : 'x',
  epgChannelId: null, hasArchive: true, archiveDays: 7,
});
let db: SqlDatabase;
async function installation() {
  const database = createTestDatabase();
  await migrate(database);
  await database.runAsync('INSERT INTO sources(id,kind,name,url,created_at) VALUES(?,?,?,?,?)', [SOURCE, 'xtream', 'Guide', 'https://panel.example', 0]);
  await replaceCategories(database, SOURCE, [{ id: 'x', name: 'DK' }, { id: 'y', name: 'UK' }]);
  await replaceChannels(database, SOURCE, [channel('a'), channel('b'), channel('c')]);
  for (const id of ['a', 'b', 'c']) await setFavorite(database, key(id), true, key(id === 'c' ? 'y' : 'x'));
  return database;
}
async function readSnapshot(database = db): Promise<GuideSnapshot> {
  const [chosen, groups, dialectSources] = await Promise.all([
    getFavoriteGroup(database), listFavoriteGroups(database), sourcesWithDialect(database),
  ]);
  const group = groups.find(entry => entry.id === chosen) ?? null;
  const channels = await listChannels(database, { favouritesOnly: true, groupId: group?.id ?? null });
  return { channels, group, groups, dialectSources };
}
async function warm(database = db, token = TOKEN) {
  const revision = guideSnapshotRevision(database);
  const snapshot = await readSnapshot(database);
  saveGuideSnapshot(database, token, revision, snapshot);
  expect(peekGuideSnapshot(database, token)).toBe(snapshot);
  return { revision, snapshot };
}
async function changes(operation: () => Promise<unknown>) {
  const old = await warm();
  await operation();
  expect(guideSnapshotRevision(db)).toBeGreaterThan(old.revision);
  expect(peekGuideSnapshot(db, TOKEN)).toBeNull();
  saveGuideSnapshot(db, TOKEN, old.revision, old.snapshot);
  expect(peekGuideSnapshot(db, TOKEN)).toBeNull();
}
beforeEach(async () => { db = await installation(); });

it('viser kun den rigtige reloadToken og gemmer hoejst ét faerdigt snapshot', async () => {
  const old = await warm();
  expect(peekGuideSnapshot(db, TOKEN + 1)).toBeNull();
  saveGuideSnapshot(db, TOKEN + 1, old.revision, old.snapshot);
  expect(peekGuideSnapshot(db, TOKEN)).toBeNull();
  expect(peekGuideSnapshot(db, TOKEN + 1)).toBe(old.snapshot);
});

it('holder databaser adskilt, og lokale favoritvalg rydder kun deres egen database', async () => {
  const other = await installation();
  const first = await warm(); const second = await warm(other);
  await setFavorite(db, key('a'), false);
  expect(peekGuideSnapshot(db, TOKEN)).toBeNull();
  expect(peekGuideSnapshot(other, TOKEN)).toBe(second.snapshot);
  saveGuideSnapshot(db, TOKEN, first.revision, first.snapshot);
  expect(peekGuideSnapshot(db, TOKEN)).toBeNull();
});

it('afviser et gammelt asynkront svar efter baade lokal og faelles katalog-invalidering', async () => {
  const old = await warm();
  invalidateGuideSnapshot(db);
  saveGuideSnapshot(db, TOKEN, old.revision, old.snapshot);
  expect(peekGuideSnapshot(db, TOKEN)).toBeNull();
  const current = await warm();
  invalidateQueryCache();
  saveGuideSnapshot(db, TOKEN, current.revision, current.snapshot);
  expect(peekGuideSnapshot(db, TOKEN)).toBeNull();
  await warm();
});

it('fjernede favoritter bliver vaek, og genvalgte favoritter kommer nederst i den friske liste', async () => {
  await changes(() => setFavorite(db, key('a'), false));
  expect((await warm()).snapshot.channels.map(entry => entry.id)).toEqual([key('b'), key('c')]);
  await changes(() => setFavorite(db, key('a'), true));
  expect((await warm()).snapshot.channels.map(entry => entry.id)).toEqual([key('b'), key('c'), key('a')]);
});

it('favorit-sortering bevarer den valgte gruppes orden efter genlaesning', async () => {
  const group = (await createFavoriteGroup(db, 'DK'))!;
  await setFavoriteGroupMember(db, group.id, key('a'), true);
  await setFavoriteGroupMember(db, group.id, key('b'), true);
  await setFavoriteGroup(db, group.id);
  await changes(() => moveFavorite(db, key('b'), 0, [key('a'), key('b')]));
  const snapshot = (await warm()).snapshot;
  expect(snapshot.group?.id).toBe(group.id);
  expect(snapshot.channels.map(entry => entry.id)).toEqual([key('b'), key('a')]);
});

it('hele kategoriers tilfoejelse og fjernelse kasserer kun forrige liste', async () => {
  await changes(() => removeCategoryFromFavorites(db, key('x')));
  expect((await warm()).snapshot.channels.map(entry => entry.id)).toEqual([key('c')]);
  await changes(() => addCategoryToFavorites(db, key('x')));
  expect((await warm()).snapshot.channels.map(entry => entry.id)).toEqual([key('c'), key('a'), key('b')]);
});

it('gruppers oprettelse, navn, raekkefoelge og sletning kasserer gamle metadata', async () => {
  let first = '';
  await changes(async () => { first = (await createFavoriteGroup(db, 'DK'))!.id; });
  const second = (await createFavoriteGroup(db, 'UK'))!.id;
  await changes(() => renameFavoriteGroup(db, first, 'Danmark'));
  await changes(() => moveFavoriteGroup(db, second, -1));
  expect((await warm()).snapshot.groups.map(entry => entry.name)).toEqual(['UK', 'Danmark']);
  await setFavoriteGroup(db, first);
  await changes(() => deleteFavoriteGroup(db, first));
  const snapshot = (await warm()).snapshot;
  expect(snapshot.group).toBeNull();
  expect(snapshot.channels).toHaveLength(3);
});

it('gruppeskift og medlemskab kan ikke efterlade gamle eller fjernede kanaler i cachen', async () => {
  const group = (await createFavoriteGroup(db, 'DK'))!.id;
  await changes(() => setFavoriteGroup(db, group));
  await changes(() => setFavoriteGroupMember(db, group, key('a'), true));
  expect((await warm()).snapshot.channels.map(entry => entry.id)).toEqual([key('a')]);
  await changes(() => setFavoriteGroupMember(db, group, key('a'), false));
  expect((await warm()).snapshot.channels).toEqual([]);
  await changes(() => setFavoriteGroup(db, null));
  expect((await warm()).snapshot.channels).toHaveLength(3);
});

it('nye kanaldata, relink og oprydning bruger den eksisterende katalog-revision', async () => {
  await changes(() => replaceChannels(db, SOURCE, [channel('a', 'Nyt navn'), channel('b'), channel('c')]));
  expect((await warm()).snapshot.channels[0]?.name).toBe('Nyt navn');
  await db.runAsync('INSERT INTO favorites(channel_id,match_key,country) SELECT ?,match_key,country FROM channels WHERE id=?', [key('missing'), key('a')]);
  await changes(() => relinkOrphanedFavorites(db));
  await changes(() => deleteOrphanedChannelData(db));
});

it('kildeoprettelse, aktivering, adresse, navn og gamle noegler kasserer guiden', async () => {
  await changes(() => addSource(db, { kind: 'xtream', name: 'Ny', url: 'https://new.example' }));
  await changes(() => setSourceEnabled(db, SOURCE, false));
  await changes(() => setSourceEnabled(db, SOURCE, true));
  await changes(() => renameSource(db, SOURCE, 'Omdobt'));
  await changes(() => updateSourceDetails(db, SOURCE, { name: 'Guide', url: 'https://changed.example' }));
  await changes(() => adoptLegacyKeys(db, SOURCE));
});

it('slettede og fravalgte kilder faar ikke deres kanalrækker genoplivet fra et gammelt svar', async () => {
  await setSourceEnabled(db, SOURCE, false);
  await changes(() => purgeDisabledSourceData(db));
  expect((await warm()).snapshot.channels).toEqual([]);
  await changes(() => deleteSource(db, SOURCE));
  expect((await warm()).snapshot.channels).toEqual([]);
});

it('dialekt og logoaendringer genlaeses, men almindelige indstillinger og EPG-skrivninger bevarer snapshot', async () => {
  await changes(() => setTimeshiftDialect(db, 'php', SOURCE));
  expect((await warm()).snapshot.dialectSources.has(SOURCE)).toBe(true);
  await changes(() => setLogoOverride(db, key('a'), 'https://logos.example/a.png'));
  expect((await warm()).snapshot.channels[0]?.logoUrls).toContain('https://logos.example/a.png');
  await changes(() => clearLogoOverride(db, key('a')));
  await changes(() => setSetting(db, 'logo_host:https://logos.example', 'unreachable|test'));
  const stable = await warm();
  await setSetting(db, 'last_sync_ms:guide-test', '100');
  await markEpgFetched(db, key('a'), new Date());
  await upsertProgrammes(db, [{ channelId: key('a'), title: 'Aktuelt', description: null, start: new Date(0), stop: new Date(1000) }]);
  expect(guideSnapshotRevision(db)).toBe(stable.revision);
  expect(peekGuideSnapshot(db, TOKEN)).toBe(stable.snapshot);
});

it('backup-gendannelse af favoritter og gruppe afviser forrige snapshot', async () => {
  const backup = await createBackup(db);
  await setFavorite(db, key('a'), false);
  await changes(() => restoreBackup(db, backup));
  expect((await warm()).snapshot.channels.map(entry => entry.id)).toEqual([key('a'), key('b'), key('c')]);
});

it('en fejlet gendannelse afviser ogsaa snapshots startet midt i den delvise skrivning', async () => {
  const backup = await createBackup(db);
  let fail = false;
  let midway = -1;
  let old: GuideSnapshot;
  const failing: SqlDatabase = {
    ...db,
    runAsync: async (sql, params) => {
      if (fail && sql === 'DELETE FROM favorite_exclusions') {
        midway = guideSnapshotRevision(failing);
        saveGuideSnapshot(failing, TOKEN, midway, old);
        throw new Error('testfejl');
      }
      return db.runAsync(sql, params);
    },
  };
  old = (await warm(failing)).snapshot;
  fail = true;
  await expect(restoreBackup(failing, backup)).rejects.toThrow('testfejl');
  expect(guideSnapshotRevision(failing)).toBeGreaterThan(midway);
  expect(peekGuideSnapshot(failing, TOKEN)).toBeNull();
  saveGuideSnapshot(failing, TOKEN, midway, old);
  expect(peekGuideSnapshot(failing, TOKEN)).toBeNull();
});
