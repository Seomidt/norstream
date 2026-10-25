import { XtreamAuthError, XtreamClient } from '@norstream/core';
import type { FetchLike, PanelClock, XtreamCredentials } from '@norstream/core';
import { getPanelOffsetMinutes, setPanelOffsetMinutes } from '../storage/settings.js';
import type { SqlDatabase } from '../storage/types.js';
import { withPanel } from './panelGate.js';

/** Nyt arkivforsoeg henter panelets aktuelle ur; genforbindelser genbruger
 * resultatet. En gemt sommertid maa ikke bruges efter skift til vintertid.
 * Manglende servermetadata maa stadig kunne bruge sidst maalte kilde-offset. */
export async function refreshPanelClock(
  db: SqlDatabase,
  sourceId: string,
  creds: XtreamCredentials,
  fetchImpl: FetchLike,
): Promise<PanelClock> {
  const cached = { offsetMinutes: await getPanelOffsetMinutes(db, sourceId) };
  let clock: PanelClock | null;
  try {
    clock = await withPanel(false, () => new XtreamClient(creds, fetchImpl).getPanelClock());
  } catch (error: unknown) {
    // Afvist konto er en rigtig adgangsfejl, ikke manglende ur-metadata.
    if (error instanceof XtreamAuthError) throw error;
    return cached;
  }
  if (clock === null) return cached;
  await setPanelOffsetMinutes(db, clock.offsetMinutes, sourceId);
  return clock;
}
