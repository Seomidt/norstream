import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, serialiseBackup } from './backup.js';
import { listChannels, replaceCategories, replaceChannels, setFavorite } from './channels.js';
import { fingerprint, markCloudApplied, runCloudSync } from './cloudAutoSync.js';
import type { CloudIo } from './cloudAutoSync.js';
import { migrate } from './schema.js';
import { getSkySyncState, setSkyCode, setSkySync } from './settings.js';
import { addSource } from './sources.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';
import { getProgress, replaceVodItems, saveProgress } from './vod.js';

/** Én sky, delt mellem boksene. */
function fakeCloud(): CloudIo & { store: Map<string, string>; uploads: number } {
  const store = new Map<string, string>();
  const cloud = {
    store,
    uploads: 0,
    async upload(code: string, json: string): Promise<void> {
      cloud.uploads += 1;
      store.set(code, json);
    },
    async download(code: string): Promise<string | null> {
      return store.get(code) ?? null;
    },
  };
  return cloud;
}

/** En boks med det samme panel (samme adresse og brugernavn), saa id'erne kan oversaettes. */
async function box(): Promise<{ db: SqlDatabase; sourceId: string }> {
  const db = createTestDatabase();
  await migrate(db);
  const sourceId = (await addSource(db, { kind: 'xtream', name: 'Panel', url: 'http://panel.example', username: 'u' })).id;
  await replaceCategories(db, sourceId, [{ id: '1', name: 'DANMARK' }]);
  await replaceChannels(db, sourceId, [
    { id: '10', name: 'DNK| DR1 HD', number: 1, logoUrl: null, categoryId: '1', epgChannelId: null, hasArchive: false, archiveDays: 0 },
    { id: '11', name: 'DNK| DR2 HD', number: 2, logoUrl: null, categoryId: '1', epgChannelId: null, hasArchive: false, archiveDays: 0 },
    { id: '12', name: 'DNK| TV 2 HD', number: 3, logoUrl: null, categoryId: '1', epgChannelId: null, hasArchive: false, archiveDays: 0 },
  ]);
  await replaceVodItems(db, sourceId, 'movie', [
    { id: '7', kind: 'movie', name: 'Dune', posterUrl: null, categoryId: null, rating: null, year: null, added: null, containerExtension: 'mkv' },
  ]);
  await setSkyCode(db, 'kode');
  await setSkySync(db, true);
  return { db, sourceId };
}

async function favourites(db: SqlDatabase): Promise<string[]> {
  return (await listChannels(db, { favouritesOnly: true })).map((c) => c.name);
}

let cloud: ReturnType<typeof fakeCloud>;
let a: { db: SqlDatabase; sourceId: string };
let b: { db: SqlDatabase; sourceId: string };

beforeEach(async () => {
  cloud = fakeCloud();
  a = await box();
  b = await box();
});

describe('runCloudSync', () => {
  it("'off' uden kodeord eller naar synkronisering er slaaet fra", async () => {
    await setSkySync(a.db, false);
    expect((await runCloudSync(a.db, cloud, 1000)).outcome).toBe('off');
  });

  it('foerste gang: den foerste boks laegger op (ogsaa oven paa en ugentlig kopi), den naeste retter sig ind', async () => {
    await setFavorite(a.db, `${a.sourceId}:10`, true);
    // En almindelig (ikke synkroniseret) kopi ligger i skyen fra en anden boks.
    await setFavorite(b.db, `${b.sourceId}:12`, true);
    cloud.store.set('kode', serialiseBackup(await createBackup(b.db, 500)));

    expect((await runCloudSync(a.db, cloud, 1000)).outcome).toBe('uploaded');
    expect(await favourites(a.db)).toEqual(['DNK| DR1 HD']);

    const result = await runCloudSync(b.db, cloud, 2000);
    expect(result.outcome).toBe('applied');
    expect(result.restore?.favorites).toBe(1);
    expect(await favourites(b.db)).toEqual(['DNK| DR1 HD']);
    // Bagefter: intet aendret, intet sker.
    expect((await runCloudSync(b.db, cloud, 3000)).outcome).toBe('unchanged');
    expect((await runCloudSync(a.db, cloud, 3000)).outcome).toBe('unchanged');
    expect(cloud.uploads).toBe(1);
  });

  it('en aendring paa den ene boks naar den anden', async () => {
    await setFavorite(a.db, `${a.sourceId}:10`, true);
    await runCloudSync(a.db, cloud, 1000);
    await runCloudSync(b.db, cloud, 2000);

    await setFavorite(b.db, `${b.sourceId}:11`, true);
    expect((await runCloudSync(b.db, cloud, 3000)).outcome).toBe('uploaded');
    expect((await runCloudSync(a.db, cloud, 4000)).outcome).toBe('applied');
    expect(await favourites(a.db)).toEqual(['DNK| DR1 HD', 'DNK| DR2 HD']);
  });

  it('konflikt: den nyeste vinder', async () => {
    await setFavorite(a.db, `${a.sourceId}:10`, true);
    await runCloudSync(a.db, cloud, 1000);
    await runCloudSync(b.db, cloud, 2000);

    // A aendrer kl. 3000 men naar ikke at laegge op (netfejl); B aendrer og laegger op kl. 5000.
    await setFavorite(a.db, `${a.sourceId}:11`, true);
    const offline: CloudIo = { upload: async () => Promise.reject(new Error('network')), download: cloud.download };
    expect((await runCloudSync(a.db, offline, 3000)).outcome).toBe('failed');
    expect((await getSkySyncState(a.db)).dirtySinceMs).toBe(3000);
    await setFavorite(b.db, `${b.sourceId}:12`, true);
    expect((await runCloudSync(b.db, cloud, 5000)).outcome).toBe('uploaded');
    // Skyen (5000) er nyere end A's aendring (3000): A retter sig ind.
    expect((await runCloudSync(a.db, cloud, 6000)).outcome).toBe('applied');
    expect(await favourites(a.db)).toEqual(['DNK| DR1 HD', 'DNK| TV 2 HD']);

    // Omvendt: A aendrer EFTER skyens tidspunkt -> A laegger op.
    await setFavorite(a.db, `${a.sourceId}:11`, true);
    expect((await runCloudSync(a.db, cloud, 7000)).outcome).toBe('uploaded');
    expect((await runCloudSync(b.db, cloud, 8000)).outcome).toBe('applied');
    expect(await favourites(b.db)).toEqual(['DNK| DR1 HD', 'DNK| TV 2 HD', 'DNK| DR2 HD']);
  });

  it('laegger aldrig en tom boks op oven paa de andre', async () => {
    expect((await runCloudSync(a.db, cloud, 1000)).outcome).toBe('empty');
    expect(cloud.store.size).toBe(0);
  });

  it('fremdrift i film flettes: den nyeste per titel bliver', async () => {
    await setFavorite(a.db, `${a.sourceId}:10`, true);
    await saveProgress(a.db, `${a.sourceId}:movie-7`, 300, 6000, new Date(1000));
    await runCloudSync(a.db, cloud, 2000);
    await saveProgress(b.db, `${b.sourceId}:movie-7`, 900, 6000, new Date(2500));
    expect((await runCloudSync(b.db, cloud, 3000)).outcome).toBe('applied');
    expect((await getProgress(b.db, `${b.sourceId}:movie-7`))?.positionSeconds).toBe(900);
  });

  it('markCloudApplied: efter et manuelt Hent ses skyen som synkroniseret', async () => {
    await setFavorite(a.db, `${a.sourceId}:10`, true);
    await runCloudSync(a.db, cloud, 1000);
    const json = cloud.store.get('kode')!;
    await markCloudApplied(b.db, json, 2000);
    expect((await getSkySyncState(b.db)).seenMs).toBe(1000);
  });
});

describe('fingerprint', () => {
  it('aendrer sig med indholdet, ikke med tidspunkt eller kodeord', async () => {
    const one = await createBackup(a.db, 1000, async () => ({ password: 'x' }));
    const two = await createBackup(a.db, 2000);
    expect(fingerprint(one)).toBe(fingerprint(two));
    await setFavorite(a.db, `${a.sourceId}:10`, true);
    expect(fingerprint(await createBackup(a.db, 1000))).not.toBe(fingerprint(one));
  });
});
