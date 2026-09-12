import { beforeEach, describe, expect, it } from 'vitest';
import { channelKey } from '@norstream/core';
import type { Category, Channel } from '@norstream/core';
import { listChannels, replaceCategories, replaceChannels, setFavorite } from './channels.js';
import { createFavoriteGroup, setFavoriteGroupMember } from './favoriteGroups.js';
import { moveFavorite } from './favorites.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

const SOURCE = 'src1';
const key = (streamId: string): string => channelKey(SOURCE, streamId);
const CATEGORIES: Category[] = [{ id: '1', name: 'DENMARK' }];
function channel(id: string, name: string): Channel {
  return { id, name, number: null, logoUrl: null, categoryId: '1', epgChannelId: null, hasArchive: false, archiveDays: 0 };
}
// Faelles raekkefoelge: DR1, TV2, TV3 Sport, Viasat Film, Eurosport.
const CHANNELS: Channel[] = [channel('10', 'DR1'), channel('11', 'TV2'), channel('12', 'TV3 Sport'), channel('13', 'Viasat Film'), channel('14', 'Eurosport')];

describe('sortering inde i en gruppe', () => {
  let db: SqlDatabase;
  let sportId: string;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
    await db.runAsync("INSERT INTO sources VALUES ('src1','xtream','P','http://p:8080',NULL,NULL,1,0,0)");
    await replaceCategories(db, SOURCE, CATEGORIES);
    await replaceChannels(db, SOURCE, CHANNELS);
    for (const id of ['10', '11', '12', '13', '14']) await setFavorite(db, key(id), true);
    const sport = await createFavoriteGroup(db, 'Sport');
    sportId = sport!.id;
    await setFavoriteGroupMember(db, sportId, key('12'), true);
    await setFavoriteGroupMember(db, sportId, key('14'), true);
  });

  const names = async (groupId?: string): Promise<string[]> =>
    (await listChannels(db, { favouritesOnly: true, groupId })).map((c) => c.name);

  it('en plads i gruppen gaelder gruppen, ikke hele listen', async () => {
    expect(await names(sportId)).toEqual(['TV3 Sport', 'Eurosport']);
    // Eurosport oeverst i gruppen: plads 0 i den viste liste.
    await moveFavorite(db, key('14'), 0, [key('12'), key('14')]);
    expect(await names(sportId)).toEqual(['Eurosport', 'TV3 Sport']);
    // De andre favoritter ligger som foer omkring dem.
    expect(await names()).toEqual(['DR1', 'TV2', 'Eurosport', 'TV3 Sport', 'Viasat Film']);
    // Og tilbage igen, til sidste plads i gruppen.
    await moveFavorite(db, key('14'), 1, [key('14'), key('12')]);
    expect(await names(sportId)).toEqual(['TV3 Sport', 'Eurosport']);
    expect(await names()).toEqual(['DR1', 'TV2', 'TV3 Sport', 'Eurosport', 'Viasat Film']);
  });

  it('uden en vist liste er pladsen i hele listen som foer', async () => {
    await moveFavorite(db, key('14'), 0);
    expect(await names()).toEqual(['Eurosport', 'DR1', 'TV2', 'TV3 Sport', 'Viasat Film']);
  });
});
