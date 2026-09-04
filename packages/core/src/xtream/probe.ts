import type { TimeshiftDialect, XtreamCredentials } from '../models.js';
import { buildTimeshiftUrl } from '../urls.js';
import type { FetchLike } from './client.js';

const DIALECTS: readonly TimeshiftDialect[] = ['php', 'path'];
const PROBE_DURATION_MINUTES = 1;
const PROBE_OFFSET_MS = 60 * 60_000;

/**
 * Afgør hvilken timeshift-dialekt panelet taler ved at bede om et kort
 * udsnit en time tilbage i tiden. Returnerer null hvis ingen dialekt svarer,
 * hvilket betyder at start-forfra ikke er tilgængeligt.
 */
export async function detectTimeshiftDialect(
  creds: XtreamCredentials,
  streamId: string,
  fetchImpl: FetchLike,
  now: Date = new Date(),
): Promise<TimeshiftDialect | null> {
  const start = new Date(now.getTime() - PROBE_OFFSET_MS);

  for (const dialect of DIALECTS) {
    const url = buildTimeshiftUrl(
      creds,
      streamId,
      start,
      PROBE_DURATION_MINUTES,
      dialect,
    );
    try {
      const response = await fetchImpl(url);
      if (response.ok) return dialect;
    } catch {
      // Netværksfejl under probing er ikke fatalt: prøv næste dialekt.
    }
  }

  return null;
}
