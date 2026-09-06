import { logoCandidates, originOf } from '@norstream/core';
import type { FetchLike } from '@norstream/core';
import {
  getLogoHostsCheckedMs,
  recordLogoHostState,
  setLogoHostsCheckedMs,
} from '../storage/logoHosts.js';
import type { LogoHostRecord } from '../storage/logoHosts.js';
import type { SqlDatabase } from '../storage/types.js';

/**
 * Hvor tit vaerterne proeves igen.
 *
 * Ikke sjaeldnere, fordi en vaert der var nede i det oejeblik der blev maalt,
 * ellers ville staa doed for altid og koste kanalerne deres rigtige logo. Ikke
 * oftere, fordi maalingen koster et opkald per vaert der ikke svarer, og det
 * er de dyreste af dem alle.
 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Hvor mange kanaler der kigges paa for at finde vaerterne.
 *
 * Panelerne bruger i praksis én billed-vaert til alle deres logoer, saa de
 * foerste par tusinde raekker rummer dem der findes. At laese alle 22.142
 * adresser ind i hukommelsen for at faa den samme haandfuld vaerter frem er
 * spild.
 */
const SAMPLE = 2000;

export interface LogoHostCheck {
  hosts: LogoHostRecord[];
  /** Falsk naar maalingen blev sprunget over fordi den forrige var frisk. */
  checked: boolean;
}

/**
 * Finder ud af hvilke logo-vaerter telefonen faktisk kan naa.
 *
 * Baggrunden er maalt, ikke gaettet: brugerens panel oplyser sine logoer paa
 * `http://103.176.90.95`, og telefonen svarer `Host unreachable` paa den
 * vaert, mens panelet selv virker fint. Uden den her viden proever hver enkelt
 * kanal den doede vaert forfra, venter til forsoeget bliver afbrudt, og naar
 * aldrig frem til den adresse der kunne have tegnet noget.
 *
 * Der maales én gang per vaert. Resultatet gemmes, og kanallisten springer de
 * doede over — saa er registrets logo det foerste der bliver proevet i stedet
 * for det sidste.
 */
export async function checkLogoHosts(
  db: SqlDatabase,
  fetchImpl: FetchLike,
  now: Date,
  force = false,
): Promise<LogoHostCheck> {
  const last = await getLogoHostsCheckedMs(db);
  if (!force && last !== null && now.getTime() - last < CHECK_INTERVAL_MS) {
    return { hosts: [], checked: false };
  }

  const samples = await sampleLogoUrls(db);
  const hosts: LogoHostRecord[] = [];
  for (const [origin, url] of samples) {
    const record = await probeOrigin(origin, url, fetchImpl);
    await recordLogoHostState(db, record);
    hosts.push(record);
  }

  await setLogoHostsCheckedMs(db, now.getTime());
  return { hosts, checked: true };
}

/** Én adresse per vaert — det er vaerten der maales, ikke den enkelte fil. */
async function sampleLogoUrls(db: SqlDatabase): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ logo_url: string | null; source_url: string | null }>(
    `SELECT c.logo_url, s.url AS source_url
     FROM channels c
     LEFT JOIN sources s ON s.id = c.source_id
     WHERE c.logo_url IS NOT NULL AND c.logo_url <> ''
     LIMIT ?`,
    [SAMPLE],
  );

  const byOrigin = new Map<string, string>();
  for (const row of rows) {
    // Begge kandidater taeller med: panelets egen vaert er anden udvej, og den
    // skal maales af samme grund som den foerste.
    for (const candidate of logoCandidates(row.logo_url, row.source_url ?? '')) {
      const origin = originOf(candidate);
      if (origin === null || byOrigin.has(origin)) continue;
      byOrigin.set(origin, candidate);
    }
  }
  return byOrigin;
}

async function probeOrigin(
  origin: string,
  url: string,
  fetchImpl: FetchLike,
): Promise<LogoHostRecord> {
  try {
    const response = await fetchImpl(url);
    // Ogsaa en fejlstatus er et svar. En 404 gaelder den ene fil, ikke vaerten,
    // og `Image` fejler med det samme paa den — der er intet at spare ved at
    // springe vaerten over.
    return {
      origin,
      state: 'ok',
      detail: response.ok ? 'svarer' : `svarer HTTP ${response.status}`,
    };
  } catch {
    // Fejlteksten gemmes ikke: den kommer fra netvaerkslaget og kan indeholde
    // hele adressen, og logo-adresser fra M3U-lister baerer af og til
    // legitimation i sig.
    return { origin, state: 'unreachable', detail: 'kunne ikke nås' };
  }
}
