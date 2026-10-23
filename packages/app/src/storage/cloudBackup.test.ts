import { beforeEach, describe, expect, it } from 'vitest';
import type { Channel } from '@norstream/core';
import { runWeeklyCloudBackup } from './cloudBackup.js';
import { backupHasUserData, createBackup } from './backup.js';
import { replaceChannels, setFavorite } from './channels.js';
import { addSource } from './sources.js';
import { migrate } from './schema.js';
import { getSkyStorageCode, setSkyCode, setSkyLastMs } from './settings.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

function ch(id: string, name: string): Channel {
  return { id, name, number: null, logoUrl: null, categoryId: null, epgChannelId: null, hasArchive: false, archiveDays: 0 };
}

let db: SqlDatabase;
let uploads: Array<{ code: string; json: string }>;
const upload = async (code: string, json: string): Promise<void> => {
  uploads.push({ code, json });
};

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  uploads = [];
});

describe('sky-backup: overskriv aldrig en god kopi med en tom', () => {
  it('lagger IKKE en tom kopi op paa en ny boks (kun kodeord gemt)', async () => {
    await setSkyCode(db, 'mit-kodeord');
    // Ny boks: ingen favoritter endnu
    const result = await runWeeklyCloudBackup(db, upload, 1000, true);
    expect(result).toBe('empty');
    expect(uploads).toHaveLength(0);
  });

  it('lagger kopien op naar der ER favoritter', async () => {
    const s = await addSource(db, { kind: 'xtream', name: 'Hakuna', url: 'http://h' });
    await replaceChannels(db, s.id, [ch('1', 'DR1')]);
    await setFavorite(db, `${s.id}:1`, true);
    await setSkyCode(db, 'mit-kodeord');

    const result = await runWeeklyCloudBackup(db, upload, 1000, true);
    expect(result).toBe('written');
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.code).toBe(await getSkyStorageCode(db));
  });

  it("'off' naar der ikke er valgt et kodeord", async () => {
    expect(await runWeeklyCloudBackup(db, upload, 1000, true)).toBe('off');
    expect(uploads).toHaveLength(0);
  });
  it('gemmer straks i eget namespace selv med gammel ugentlig status', async () => {
    await setSkyCode(db, 'samme-kode');
    await setSkyLastMs(db, 999);
    const s = await addSource(db, { kind: 'xtream', name: 'Panel', url: 'http://p' });
    await replaceChannels(db, s.id, [ch('1', 'CNN')]);
    await setFavorite(db, `${s.id}:1`, true);
    expect(await runWeeklyCloudBackup(db, upload, 1000)).toBe('written');
    expect(await runWeeklyCloudBackup(db, upload, 2000)).toBe('not-due');
    expect(uploads[0]?.code).not.toBe('samme-kode');
  });

});

describe('backupHasUserData', () => {
  it('er falsk paa en tom boks og sand naar der er en favorit', async () => {
    expect(backupHasUserData(await createBackup(db, 1000))).toBe(false);
    const s = await addSource(db, { kind: 'xtream', name: 'Hakuna', url: 'http://h' });
    await replaceChannels(db, s.id, [ch('1', 'DR1')]);
    await setFavorite(db, `${s.id}:1`, true);
    expect(backupHasUserData(await createBackup(db, 1000))).toBe(true);
  });
});
