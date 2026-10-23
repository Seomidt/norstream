import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackup, parseBackup, serialiseBackup, restoreBackup } from './backup.js';
import { listChannels, replaceCategories, replaceChannels, setFavorite } from './channels.js';
import { fingerprint, runCloudSync } from './cloudAutoSync.js';
import type { CloudIo } from './cloudAutoSync.js';
import { createFavoriteGroup, listFavoriteGroups, setFavoriteGroupMember } from './favoriteGroups.js';
import { migrate } from './schema.js';
import { getSkyStorageCode, setSkyCode, setSkySync, setSkySyncState } from './settings.js';
import { addSource } from './sources.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

async function box() {
  const db = createTestDatabase();
  await migrate(db);
  const sourceId = (await addSource(db, { kind: 'xtream', name: 'Panel', url: 'http://panel.example', username: 'u' })).id;
  await replaceCategories(db, sourceId, [{ id: '1', name: 'USA' }]);
  await replaceChannels(db, sourceId, [{ id: '10', name: 'US| CNN', number: 1, logoUrl: null, categoryId: '1', epgChannelId: null, hasArchive: false, archiveDays: 0 }]);
  await setFavorite(db, `${sourceId}:10`, true);
  await setSkyCode(db, 'kode');
  await setSkySync(db, true);
  return { db, sourceId };
}
let a: Awaited<ReturnType<typeof box>>;
let b: Awaited<ReturnType<typeof box>>;
let store: Map<string, string>;
let cloud: CloudIo;
beforeEach(async () => {
  a = await box(); b = await box(); store = new Map();
  cloud = { upload: vi.fn(async (code, json) => { store.set(code, json); }), download: vi.fn(async code => store.get(code) ?? null) };
});

describe('hver boks har sin egen sky', () => {
  it('bevarer US-gruppen og den gamle faelles kopi med samme kodeord paa to bokse', async () => {
    const us = (await createFavoriteGroup(a.db, 'US'))!;
    await setFavoriteGroupMember(a.db, us.id, `${a.sourceId}:10`, true);
    const legacy = serialiseBackup({ ...await createBackup(b.db, 9000), synced: true });
    store.set('kode', legacy);
    expect((await runCloudSync(a.db, cloud, 10000)).outcome).toBe('uploaded');
    expect((await runCloudSync(b.db, cloud, 11000)).outcome).toBe('uploaded');
    expect(await getSkyStorageCode(a.db)).not.toBe(await getSkyStorageCode(b.db));
    expect(store.size).toBe(3);
    expect(store.get('kode')).toBe(legacy);
    expect((await listFavoriteGroups(a.db)).map(g => [g.name, g.count])).toEqual([['US', 1]]);
    expect(await listFavoriteGroups(b.db)).toEqual([]);
    expect(cloud.download).not.toHaveBeenCalled();
    expect((await runCloudSync(a.db, cloud, 12000)).outcome).toBe('unchanged');
  });

  it('migrerer fra gammel sync-status uden at hente eller overskrive faelles sky', async () => {
    await setSkySyncState(a.db, { fingerprint: fingerprint(await createBackup(a.db, 1)), seenMs: 999999, dirtySinceMs: 0 });
    expect((await runCloudSync(a.db, cloud, 1000)).outcome).toBe('uploaded');
    expect(store.has('kode')).toBe(false);
    expect(cloud.download).not.toHaveBeenCalled();
  });

  it('holder samtidige bokse og kodeordsskift adskilt', async () => {
    expect((await Promise.all([runCloudSync(a.db, cloud, 1000), runCloudSync(b.db, cloud, 1000)])).map(r => r.outcome)).toEqual(['uploaded', 'uploaded']);
    const old = await getSkyStorageCode(a.db);
    await setSkyCode(a.db, 'en-anden-sky');
    expect((await runCloudSync(a.db, cloud, 2000)).outcome).toBe('uploaded');
    expect(store.has(old)).toBe(true);
    expect(store.has(await getSkyStorageCode(a.db))).toBe(true);
    expect(store.size).toBe(3);
  });

  it('bevarer lokal US-gruppe ved netfejl og proever upload igen', async () => {
    await createFavoriteGroup(a.db, 'US');
    const offline = { ...cloud, upload: vi.fn(async () => { throw new Error('network'); }) };
    expect((await runCloudSync(a.db, offline, 1000)).outcome).toBe('failed');
    expect((await listFavoriteGroups(a.db)).map(g => g.name)).toEqual(['US']);
    expect((await runCloudSync(a.db, cloud, 2000)).outcome).toBe('uploaded');
  });

  it('tillader manuel overfoersel uden at flytte boksens identitet eller backup-kode', async () => {
    await createFavoriteGroup(a.db, 'US');
    await runCloudSync(a.db, cloud, 1000);
    const codeA = await getSkyStorageCode(a.db), codeB = await getSkyStorageCode(b.db);
    const backup = parseBackup(store.get(codeA)!);
    expect(Object.keys(backup.settings).some(k => k.startsWith('sky_'))).toBe(false);
    await restoreBackup(b.db, backup, { matchByName: true });
    expect((await listFavoriteGroups(b.db)).map(g => g.name)).toEqual(['US']);
    expect(await getSkyStorageCode(b.db)).toBe(codeB);
    expect(codeB).not.toBe(codeA);
  });

  it('slaaet fra medfoerer ingen netvaerkskald', async () => {
    await setSkySync(a.db, false);
    expect((await runCloudSync(a.db, cloud)).outcome).toBe('off');
    expect(cloud.upload).not.toHaveBeenCalled();
    expect(cloud.download).not.toHaveBeenCalled();
  });
});

describe('fingerprint', () => {
  it('ignorerer tidspunkt og adgangskoder', async () => {
    expect(fingerprint(await createBackup(a.db, 1000, async () => ({ password: 'hemmeligt' })))).toBe(fingerprint(await createBackup(a.db, 2000)));
  });
});
