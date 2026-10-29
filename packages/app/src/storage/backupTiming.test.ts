import { describe, expect, it } from 'vitest';
import { createBackup, parseBackup, restoreBackup, serialiseBackup } from './backup.js';
import { epgTimingRevision } from './epgTiming.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

async function installation(id: string): Promise<SqlDatabase> {
  const db = createTestDatabase();
  await migrate(db);
  await db.runAsync(
    `INSERT INTO sources (id, kind, name, url, username, created_at)
     VALUES (?, 'xtream', 'Panel', 'https://panel.example', 'bruger', 1)`,
    [id],
  );
  return db;
}

describe('sikkerhedskopi uden timekorrektioner (v423)', () => {
  it('tager hverken EPG- eller arkivkorrektion med', async () => {
    const db = await installation('old');
    await db.execAsync(`INSERT INTO settings (key,value) VALUES
      ('archive_shift_minutes:old','60'),('epg_shift_minutes:old','60'),('panel_offset_minutes:old','60')`);
    const backup = parseBackup(serialiseBackup(await createBackup(db, 1000)));
    expect(backup.settings).toEqual({ 'panel_offset_minutes:old': '60' });
    expect(backup.sources[0].password).toBeUndefined();
  });

  it('en gammel kopi med arkivets +60 kan ikke bringe det tilbage', async () => {
    const old = await installation('old');
    const backup = await createBackup(old);
    backup.settings['archive_shift_minutes:old'] = '60';
    backup.settings['epg_shift_minutes:old'] = '60';
    const fresh = await installation('new');
    const revision = epgTimingRevision(fresh);
    await restoreBackup(fresh, backup);
    expect(epgTimingRevision(fresh)).toBeGreaterThan(revision);
    expect(await fresh.getAllAsync("SELECT key FROM settings WHERE key LIKE '%shift_minutes:%'")).toEqual([]);
  });
});
