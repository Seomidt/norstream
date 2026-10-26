import { describe, expect, it } from 'vitest';
import { createBackup, parseBackup, restoreBackup, serialiseBackup } from './backup.js';
import { epgTimingRevision, getArchiveTimeShift, getEpgTimeShift, setEpgTimeShifts } from './epgTiming.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

async function installation(id: string, url = 'https://panel.example'): Promise<SqlDatabase> {
  const db = createTestDatabase();
  await migrate(db);
  await db.runAsync(
    `INSERT INTO sources (id, kind, name, url, username, created_at)
     VALUES (?, 'xtream', 'Panel', ?, 'bruger', 1)`,
    [id, url],
  );
  return db;
}

describe('sikkerhedskopi af kildeopdelte EPG- og arkivtider', () => {
  it('tager begge brugerrettelser med uden programdata eller kodeord', async () => {
    const db = await installation('old');
    await setEpgTimeShifts(db, 'old', { epgMinutes: 60, archiveMinutes: 30 });
    await db.runAsync("INSERT INTO settings (key,value) VALUES ('last_sync_ms:old','123')");
    const backup = parseBackup(serialiseBackup(await createBackup(db, 1000)));
    expect(backup.settings).toEqual({
      'archive_shift_minutes:old': '30',
    });
    expect(backup.sources[0].password).toBeUndefined();
    expect(backup).not.toHaveProperty('programmes');
  });

  it('oversaetter kilde-id og bevarer andre kilders korrektion ved gendannelse', async () => {
    const old = await installation('old');
    await setEpgTimeShifts(old, 'old', { epgMinutes: 60, archiveMinutes: 60 });
    const backup = await createBackup(old);
    const fresh = await installation('new');
    await fresh.runAsync(
      `INSERT INTO sources (id,kind,name,url,username,created_at)
       VALUES ('other','xtream','Andet','https://other.example','bruger',2)`,
    );
    await setEpgTimeShifts(fresh, 'other', { epgMinutes: -60, archiveMinutes: 0 });
    const revision = epgTimingRevision(fresh);
    await restoreBackup(fresh, backup);
    expect(epgTimingRevision(fresh)).toBeGreaterThan(revision);
    await restoreBackup(fresh, backup);
    expect(await getEpgTimeShift(fresh, 'new')).toBe(0);
    expect(await getArchiveTimeShift(fresh, 'new')).toBe(60);
    expect(await getEpgTimeShift(fresh, 'other')).toBe(-60);
    expect(await getArchiveTimeShift(fresh, 'other')).toBe(0);
    expect(await fresh.getFirstAsync("SELECT value FROM settings WHERE key='epg_shift_minutes:old'")).toBeNull();
  });

  it('lader manglende kilders korrektion blive ude af en anden installation', async () => {
    const old = await installation('old');
    await setEpgTimeShifts(old, 'old', { epgMinutes: 60, archiveMinutes: 60 });
    const fresh = await installation('new', 'https://different.example');
    const result = await restoreBackup(fresh, await createBackup(old));
    expect(result.missingSources).toEqual(['Panel']);
    expect(result.settings).toBe(0);
    expect(await getEpgTimeShift(fresh, 'new')).toBe(0);
    expect(await getArchiveTimeShift(fresh, 'new')).toBe(0);
  });
});
