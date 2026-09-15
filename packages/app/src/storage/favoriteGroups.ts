import type { SqlDatabase } from './types.js';

/**
 * Grupper oven paa favoritterne.
 *
 * Én favoritliste med sin egen raekkefoelge, og grupper der peger ind i
 * den: Sport, Film, Boern. Brugeren laver og navngiver dem selv; intet
 * laegges i dem af sig selv. Guiden og Favoritter viser den valgte gruppe,
 * eller alle, og afspilleren zapper inden for det der vises. Raekkefoelgen
 * i en gruppe er favoritlistens egen.
 */
export interface FavoriteGroup {
  id: string;
  name: string;
  position: number;
  /** Antal favoritter i gruppen. */
  count: number;
}

interface GroupRow {
  id: string;
  name: string;
  position: number;
  count: number;
}

export async function listFavoriteGroups(db: SqlDatabase): Promise<FavoriteGroup[]> {
  const rows = await db.getAllAsync<GroupRow>(
    `SELECT g.id, g.name, g.position,
            (SELECT COUNT(*) FROM favorite_group_members m
              JOIN favorites f ON f.channel_id = m.channel_id
              WHERE m.group_id = g.id) AS count
     FROM favorite_groups g
     ORDER BY g.position, g.name`,
  );
  return rows.map((row) => ({ id: row.id, name: row.name, position: row.position, count: row.count }));
}

export async function createFavoriteGroup(db: SqlDatabase, name: string): Promise<FavoriteGroup | null> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  const last = await db.getFirstAsync<{ max: number | null }>('SELECT MAX(position) AS max FROM favorite_groups');
  const position = (last?.max ?? -1) + 1;
  const id = `g${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  await db.runAsync('INSERT INTO favorite_groups (id, name, position) VALUES (?, ?, ?)', [id, trimmed, position]);
  return { id, name: trimmed, position, count: 0 };
}

export async function renameFavoriteGroup(db: SqlDatabase, id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return;
  await db.runAsync('UPDATE favorite_groups SET name = ? WHERE id = ?', [trimmed, id]);
}

export async function deleteFavoriteGroup(db: SqlDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM favorite_group_members WHERE group_id = ?', [id]);
  await db.runAsync('DELETE FROM favorite_groups WHERE id = ?', [id]);
}

/** Flytter gruppen én plads op eller ned i raekken af grupper. */
export async function moveFavoriteGroup(db: SqlDatabase, id: string, direction: -1 | 1): Promise<void> {
  const groups = await listFavoriteGroups(db);
  const index = groups.findIndex((group) => group.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= groups.length) return;
  const order = groups.map((group) => group.id);
  order.splice(index, 1);
  order.splice(target, 0, id);
  for (let position = 0; position < order.length; position += 1) {
    await db.runAsync('UPDATE favorite_groups SET position = ? WHERE id = ?', [position, order[position]!]);
  }
}

export async function setFavoriteGroupMember(
  db: SqlDatabase,
  groupId: string,
  channelId: string,
  member: boolean,
): Promise<void> {
  if (member) {
    await db.runAsync('INSERT OR IGNORE INTO favorite_group_members (group_id, channel_id) VALUES (?, ?)', [groupId, channelId]);
  } else {
    await db.runAsync('DELETE FROM favorite_group_members WHERE group_id = ? AND channel_id = ?', [groupId, channelId]);
  }
}

/** Kanalerne i gruppen, som et saet af kanal-id'er. */
export async function favoriteGroupMembers(db: SqlDatabase, groupId: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ channel_id: string }>(
    'SELECT channel_id FROM favorite_group_members WHERE group_id = ?',
    [groupId],
  );
  return new Set(rows.map((row) => row.channel_id));
}

/** Grupperne en kanal ligger i. */
export async function groupsForChannel(db: SqlDatabase, channelId: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ group_id: string }>(
    'SELECT group_id FROM favorite_group_members WHERE channel_id = ?',
    [channelId],
  );
  return new Set(rows.map((row) => row.group_id));
}
