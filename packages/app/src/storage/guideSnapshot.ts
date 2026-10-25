import type { StoredChannel } from './channels.js';
import type { FavoriteGroup } from './favoriteGroups.js';
import { queryCacheRevision } from './queryCache.js';
import type { SqlDatabase } from './types.js';

export interface GuideSnapshot {
  channels: StoredChannel[];
  group: FavoriteGroup | null;
  groups: FavoriteGroup[];
  dialectSources: ReadonlySet<string>;
}

interface Entry {
  revision: number;
  queryRevision: number;
  saved: { reloadToken: number; snapshot: GuideSnapshot } | null;
}

// Ét faerdigt overblik per database. Ingen afspillere, streams eller EPG her.
const snapshots = new WeakMap<SqlDatabase, Entry>();
function entryFor(db: SqlDatabase): Entry {
  const queryRevision = queryCacheRevision();
  let entry = snapshots.get(db);
  if (entry === undefined) {
    entry = { revision: 0, queryRevision, saved: null };
    snapshots.set(db, entry);
  } else if (entry.queryRevision !== queryRevision) {
    entry.queryRevision = queryRevision;
    entry.revision += 1;
    entry.saved = null;
  }
  return entry;
}

/** Synkront foerste billede; skaermen genlaeser SQLite i baggrunden. */
export function peekGuideSnapshot(db: SqlDatabase, reloadToken: number): GuideSnapshot | null {
  const saved = entryFor(db).saved;
  return saved?.reloadToken === reloadToken ? saved.snapshot : null;
}

/** Laeses foer et asynkront opslag, saa gamle svar ikke kan genoplive slettede favoritter. */
export function guideSnapshotRevision(db: SqlDatabase): number {
  return entryFor(db).revision;
}

export function saveGuideSnapshot(db: SqlDatabase, reloadToken: number, expectedRevision: number, snapshot: GuideSnapshot): void {
  const entry = entryFor(db);
  if (entry.revision !== expectedRevision) return;
  entry.saved = { reloadToken, snapshot };
}

/** Kun aendringer af guidens kanalvalg og metadata roerer denne cache. */
export function invalidateGuideSnapshot(db: SqlDatabase): void {
  const entry = entryFor(db);
  entry.revision += 1;
  entry.saved = null;
}
