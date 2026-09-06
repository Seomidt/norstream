import { XtreamAuthError } from '@norstream/core';
import type { FetchLike } from '@norstream/core';
import type { SourceAccess } from '../sources/access.js';
import type { SqlDatabase } from '../storage/types.js';
import { syncChannels } from './syncChannels.js';
import { syncM3u } from './syncM3u.js';

export interface SyncAllResult {
  /** Kilder der blev hentet uden problemer. */
  synced: number;
  /** Kilder der afviste adgangsoplysningerne. */
  rejected: string[];
  /** Kilder der ikke kunne naas. */
  failed: string[];
}

/**
 * Henter kanallisten fra hver aktiv kilde.
 *
 * Fejl paa én kilde stopper ikke de andre. Det er hele pointen med flere
 * kilder: er det ene panel nede, skal de oevrige kanaler stadig virke — og
 * brugeren skal kunne se **hvilken** kilde der driller frem for at faa en app
 * der halvt fungerer uden forklaring.
 *
 * `XtreamAuthError` sluges ikke, men samles: en kilde med skiftet kodeord skal
 * kunne peges ud, uden at de andre bliver logget ud med den.
 */
export async function syncAllSources(
  db: SqlDatabase,
  sources: readonly SourceAccess[],
  fetchImpl: FetchLike,
  now: Date = new Date(),
): Promise<SyncAllResult> {
  const result: SyncAllResult = { synced: 0, rejected: [], failed: [] };

  for (const access of sources) {
    try {
      if (access.source.kind === 'm3u') {
        await syncM3u(db, access.source, fetchImpl, now);
      } else if (access.creds !== null) {
        await syncChannels(db, access.source.id, access.creds, fetchImpl, now);
      } else {
        // Kilden findes, men adgangsoplysningerne er vaek fra Keychain.
        result.rejected.push(access.source.name);
        continue;
      }
      result.synced += 1;
    } catch (cause) {
      if (cause instanceof XtreamAuthError) result.rejected.push(access.source.name);
      else result.failed.push(access.source.name);
    }
  }

  return result;
}
