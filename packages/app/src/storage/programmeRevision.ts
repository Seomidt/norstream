import type { SqlDatabase } from './types.js';

// EPG-data har egen revision. Nye programmer maa ikke rydde film-, kanal-
// eller menucachen, men en varm tidslinje skal genlaese det rettede vindue.
const revisions = new WeakMap<SqlDatabase, number>();
export function programmeDataRevision(db: SqlDatabase): number { return revisions.get(db) ?? 0; }
export function invalidateProgrammeData(db: SqlDatabase): void {
  revisions.set(db, programmeDataRevision(db) + 1);
}
