import type { TimeshiftDialect, XtreamCredentials } from '../models.js';
import { buildTimeshiftUrl } from '../urls.js';
import type { FetchLike } from './client.js';

const DIALECTS: readonly TimeshiftDialect[] = ['php', 'path'];
const PROBE_DURATION_MINUTES = 1;
const PROBE_OFFSET_MS = 60 * 60_000;
// Dækker hele intervallet af mulige tidszoneafvigelser (±12 timer), så et
// forkert `panelOffsetMinutes` ikke kan få begge dialekter til at fejle.
const DEEP_PROBE_OFFSET_MS = 13 * 60 * 60_000;

/**
 * Afgør hvilken timeshift-dialekt panelet taler ved at bede om et kort
 * udsnit tilbage i tiden. Prøver først ét tidspunkt en time tilbage; hvis
 * ingen dialekt svarer der, prøves begge dialekter igen 13 timer tilbage —
 * det dækker ±12 timers tidszoneafvigelse, så et forkert `panelOffsetMinutes`
 * ikke permanent kan slå start-forfra fra på et ellers velfungerende panel.
 * Returnerer null hvis ingen dialekt svarer på noget tidspunkt, hvilket
 * betyder at start-forfra ikke er tilgængeligt.
 *
 * `panelOffsetMinutes` er panelets offset fra UTC og videregives til
 * `buildTimeshiftUrl`, som bruges til at generere probe-URL'en.
 */
export async function detectTimeshiftDialect(
  creds: XtreamCredentials,
  streamId: string,
  fetchImpl: FetchLike,
  now: Date = new Date(),
  panelOffsetMinutes = 0,
): Promise<TimeshiftDialect | null> {
  for (const offsetMs of [PROBE_OFFSET_MS, DEEP_PROBE_OFFSET_MS]) {
    const start = new Date(now.getTime() - offsetMs);

    for (const dialect of DIALECTS) {
      const url = buildTimeshiftUrl(
        creds,
        streamId,
        start,
        PROBE_DURATION_MINUTES,
        dialect,
        panelOffsetMinutes,
      );
      try {
        const response = await fetchImpl(url);
        if (response.ok) return dialect;
      } catch {
        // Netværksfejl under probing er ikke fatalt: prøv næste dialekt.
      }
    }
  }

  return null;
}
