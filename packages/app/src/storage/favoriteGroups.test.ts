import { beforeEach, describe, expect, it } from 'vitest';
import { channelKey } from '@norstream/core';
import type { Category, Channel } from '@norstream/core';
import { listChannels, replaceCategories, replaceChannels, setFavorite } from './channels.js';
import {
  createFavoriteGroup,
  deleteFavoriteGroup,
  favoriteGroupMembers,
  groupsForChannel,
  listFavoriteGroups,
  moveFavoriteGroup,
  renameFavoriteGroup,
  setFavoriteGroupMember,
} from './favoriteGroups.js';
import { createBackup, restoreBackup } from './backup.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

const SOURCE = 'src1';
const key = (streamId: string): string => channelKey(SOURCE, streamId);

const CATEGORIES: Category[] = [{ id: '1', name: 'DENMARK' }];
function channel(id: string, name: string): Channel {
  return { id, name, number: null, logoUrl: null, categoryId: '1', epgChannelId: null, hasArchive: false, archiveDays: 0 };
}
const CHANNELS: Channel[] = [channel('10', 'DR1'), channel('11', 'TV2'), channel('12', 'TV3 Sport'), channel('13', 'Viasat Film')];

describe('favoritgrupper', () => {
  let db: SqlDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
    await db.runAsync("INSERT INTO sources VALUES ('src1','xtream','P','http://p:8080',NULL,NULL,1,0,0)");
    await replaceCategories(db, SOURCE, CATEGORIES);
    await replaceChannels(db, SOURCE, CHANNELS);
    for (const id of ['10', '11', '12', '13']) await setFavorite(db, key(id), true);
  });

  it('opretter, omdoeber, flytter og sletter grupper', async () => {
    const sport = await createFavoriteGroup(db, ' Sport ');
    const film = await createFavoriteGroup(db, 'Film');
    expect(await createFavoriteGroup(db, '   ')).toBeNull();
    expect((await listFavoriteGroups(db)).map((g) => g.name)).toEqual(['Sport', 'Film']);
    await renameFavoriteGroup(db, sport!.id, 'Sport & bold');
    await moveFavoriteGroup(db, film!.id, -1);
    expect((await listFavoriteGroups(db)).map((g) => g.name)).toEqual(['Film', 'Sport & bold']);
    await deleteFavoriteGroup(db, film!.id);
    expect((await listFavoriteGroups(db)).map((g) => g.name)).toEqual(['Sport & bold']);
  });

  it('filtrerer favoritterne paa gruppe og beholder favoritlistens raekkefoelge', async () => {
    const sport = (await createFavoriteGroup(db, 'Sport'))!;
    await setFavoriteGroupMember(db, sport.id, key('12'), true);
    await setFavoriteGroupMember(db, sport.id, key('10'), true);
    const inGroup = await listChannels(db, { favouritesOnly: true, groupId: sport.id });
    expect(inGroup.map((c) => c.name)).toEqual(['DR1', 'TV3 Sport']);
    expect((await listFavoriteGroups(db))[0]?.count).toBe(2);
    expect(await favoriteGroupMembers(db, sport.id)).toEqual(new Set([key('10'), key('12')]));
    expect(await groupsForChannel(db, key('12'))).toEqual(new Set([sport.id]));
    await setFavoriteGroupMember(db, sport.id, key('10'), false);
    expect((await listChannels(db, { favouritesOnly: true, groupId: sport.id })).map((c) => c.name)).toEqual(['TV3 Sport']);
    // Uden gruppe: alle favoritter.
    expect((await listChannels(db, { favouritesOnly: true, groupId: null })).length).toBe(4);
  });

  it('en kanal der ikke laengere er favorit taeller ikke med i gruppen', async () => {
    const sport = (await createFavoriteGroup(db, 'Sport'))!;
    await setFavoriteGroupMember(db, sport.id, key('12'), true);
    await setFavorite(db, key('12'), false);
    expect((await listFavoriteGroups(db))[0]?.count).toBe(0);
    expect((await listChannels(db, { favouritesOnly: true, groupId: sport.id })).length).toBe(0);
  });

  it('foelger med i sikkerhedskopien', async () => {
    const sport = (await createFavoriteGroup(db, 'Sport'))!;
    await setFavoriteGroupMember(db, sport.id, key('12'), true);
    const backup = await createBackup(db);
    expect(backup.favoriteGroups).toEqual([{ id: sport.id, name: 'Sport', position: 0, channelIds: [key('12')] }]);
    await deleteFavoriteGroup(db, sport.id);
    await restoreBackup(db, backup);
    expect((await listFavoriteGroups(db)).map((g) => g.name)).toEqual(['Sport']);
    expect(await favoriteGroupMembers(db, sport.id)).toEqual(new Set([key('12')]));
  });
});
