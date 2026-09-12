import { beforeEach, describe, expect, it } from 'vitest';
import { getAutoBackupState, runWeeklyBackup, WEEKLY_BACKUP_MS } from './autoBackup.js';
import { migrate } from './schema.js';
import { setBackupFolderUri } from './settings.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

describe('automatisk ugentlig sikkerhedskopi', () => {
  let db: SqlDatabase;
  let written: Array<{ uri: string; json: string }>;
  const writer = async (uri: string, json: string): Promise<void> => {
    written.push({ uri, json });
  };
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
    written = [];
  });

  it('goer ingenting naar ingen mappe er valgt', async () => {
    expect(await runWeeklyBackup(db, writer, 1000)).toBe('off');
    expect(written).toHaveLength(0);
  });

  it('skriver foerste gang, springer over inden en uge, og skriver igen efter', async () => {
    await setBackupFolderUri(db, 'content://mappe');
    expect(await runWeeklyBackup(db, writer, 1000)).toBe('written');
    expect(written[0]?.uri).toBe('content://mappe');
    expect(JSON.parse(written[0]?.json ?? '{}')).toHaveProperty('favorites');
    expect(await runWeeklyBackup(db, writer, 1000 + WEEKLY_BACKUP_MS - 1)).toBe('not-due');
    expect(await runWeeklyBackup(db, writer, 1000 + WEEKLY_BACKUP_MS)).toBe('written');
    expect(written).toHaveLength(2);
    expect((await getAutoBackupState(db)).lastMs).toBe(1000 + WEEKLY_BACKUP_MS);
  });

  it('husker en fejl til Indstillinger og proever igen naeste gang', async () => {
    await setBackupFolderUri(db, 'content://vaek');
    const failing = async (): Promise<void> => {
      throw new Error('mappen findes ikke');
    };
    expect(await runWeeklyBackup(db, failing, 1000)).toBe('failed');
    expect(await getAutoBackupState(db)).toEqual({ folderUri: 'content://vaek', lastMs: null, failed: true });
    expect(await runWeeklyBackup(db, writer, 2000)).toBe('written');
    expect((await getAutoBackupState(db)).failed).toBe(false);
  });

  it('skriver med det samme naar der tvinges, ogsaa lige efter sidste', async () => {
    await setBackupFolderUri(db, 'content://mappe');
    await runWeeklyBackup(db, writer, 1000);
    expect(await runWeeklyBackup(db, writer, 1001, true)).toBe('written');
    await setBackupFolderUri(db, null);
    expect(await runWeeklyBackup(db, writer, 1002, true)).toBe('off');
  });
});
