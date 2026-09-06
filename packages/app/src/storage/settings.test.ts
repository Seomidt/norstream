import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';
import {
  clearLastSyncMs,
  getLastSyncMs,
  getMiniPreviewEnabled,
  getPanelOffsetMinutes,
  getSetting,
  getTimeshiftDialect,
  setLastSyncMs,
  setMiniPreviewEnabled,
  setPanelOffsetMinutes,
  sourcesWithDialect,
  setSetting,
  setTimeshiftDialect,
} from './settings.js';

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('setSetting og getSetting', () => {
  it('gemmer og henter', async () => {
    await setSetting(db, 'foo', 'bar');
    expect(await getSetting(db, 'foo')).toBe('bar');
  });

  it('giver null for en ukendt noegle', async () => {
    expect(await getSetting(db, 'findes-ikke')).toBeNull();
  });

  it('overskriver en eksisterende vaerdi', async () => {
    await setSetting(db, 'foo', 'en');
    await setSetting(db, 'foo', 'to');
    expect(await getSetting(db, 'foo')).toBe('to');
  });
});

const SOURCE = 'src1';

describe('timeshift-dialekt', () => {
  it('giver null foer probing', async () => {
    expect(await getTimeshiftDialect(db, SOURCE)).toBeNull();
  });

  it('gemmer og henter en dialekt', async () => {
    await setTimeshiftDialect(db, 'php', SOURCE);
    expect(await getTimeshiftDialect(db, SOURCE)).toBe('php');
  });

  it('gemmer at ingen dialekt svarede', async () => {
    await setTimeshiftDialect(db, null, SOURCE);
    expect(await getTimeshiftDialect(db, SOURCE)).toBeNull();
  });

  it('afviser en vaerdi der ikke er en kendt dialekt', async () => {
    await setSetting(db, `timeshift_dialect:${SOURCE}`, 'vroevl');
    expect(await getTimeshiftDialect(db, SOURCE)).toBeNull();
  });

  // Den her fejl kostede brugeren start-forfra paa hver eneste kanal: koden
  // skrev under kildens noegle og laeste under den faelles, saa svaret altid
  // var null indtil man trykkede "Proev igen" — og igen naeste gang.
  it('holder to kilders dialekter adskilt', async () => {
    await setTimeshiftDialect(db, 'php', SOURCE);
    await setTimeshiftDialect(db, 'path', 'src2');
    expect(await getTimeshiftDialect(db, SOURCE)).toBe('php');
    expect(await getTimeshiftDialect(db, 'src2')).toBe('path');
  });

  it('opregner de kilder der har fundet en dialekt', async () => {
    await setTimeshiftDialect(db, 'php', SOURCE);
    await setTimeshiftDialect(db, null, 'src2');
    await setTimeshiftDialect(db, 'path', 'src3');
    expect(await sourcesWithDialect(db)).toEqual(new Set([SOURCE, 'src3']));
  });
});

describe('panel-offset', () => {
  it('er nul som standard', async () => {
    expect(await getPanelOffsetMinutes(db, SOURCE)).toBe(0);
  });

  it('gemmer og henter', async () => {
    await setPanelOffsetMinutes(db, 120, SOURCE);
    expect(await getPanelOffsetMinutes(db, SOURCE)).toBe(120);
  });

  it('gemmer et negativt offset', async () => {
    await setPanelOffsetMinutes(db, -300, SOURCE);
    expect(await getPanelOffsetMinutes(db, SOURCE)).toBe(-300);
  });

  it('falder tilbage til nul ved en ulaeselig vaerdi', async () => {
    await setSetting(db, `panel_offset_minutes:${SOURCE}`, 'ikke et tal');
    expect(await getPanelOffsetMinutes(db, SOURCE)).toBe(0);
  });
});

describe('sidste synkronisering', () => {
  it('er null foer foerste synkronisering', async () => {
    expect(await getLastSyncMs(db)).toBeNull();
  });

  it('gemmer og henter', async () => {
    await setLastSyncMs(db, 1_700_000_000_000);
    expect(await getLastSyncMs(db)).toBe(1_700_000_000_000);
  });
});

describe('clearLastSyncMs', () => {
  it('nulstiller tidspunktet, saa naeste session synkroniserer med det samme', async () => {
    // Parkeret punkt 1 fra overdragelsen: uden det viser et nyt panel det
    // gamles kanaler i op til et doegn efter udlogning.
    await setLastSyncMs(db, 1788626052000);
    await clearLastSyncMs(db);
    await expect(getLastSyncMs(db)).resolves.toBeNull();
  });

  it('taaler at blive kaldt naar der aldrig har vaeret synkroniseret', async () => {
    await expect(clearLastSyncMs(db)).resolves.toBeUndefined();
  });
});

describe('mini-preview-indstillingen', () => {
  it('er slaaet til som standard', async () => {
    await expect(getMiniPreviewEnabled(db)).resolves.toBe(true);
  });

  it('kan slaas fra og til igen', async () => {
    await setMiniPreviewEnabled(db, false);
    await expect(getMiniPreviewEnabled(db)).resolves.toBe(false);
    await setMiniPreviewEnabled(db, true);
    await expect(getMiniPreviewEnabled(db)).resolves.toBe(true);
  });
});
