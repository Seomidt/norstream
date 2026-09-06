import { logoCandidates, originOf } from '@norstream/core';
import type { FetchLike } from '@norstream/core';
import {
  getLogoHostsCheckedMs,
  recordLogoHostState,
  setLogoHostsCheckedMs,
  sourceOrigins,
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

/**
 * Hvor laenge der ventes paa en vaert der ikke svarer.
 *
 * Kortere end appens almindelige timeout paa femten sekunder. Maalingen er en
 * bekvemmelighed, ikke noget nogen venter paa, og tre doede vaerter á femten
 * sekunder er et helt minut lagt til en opdatering.
 */
const PROBE_TIMEOUT_MS = 6000;

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

  const [samples, sources] = await Promise.all([sampleLogoUrls(db), sourceOrigins(db)]);

  // Kildernes egne vaerter maales **ikke**. Panelet tillader én forbindelse, og
  // et kald til det her ville tage den fra de kanaler og programmer der
  // faktisk skal hentes — og saa tabe kapløbet og blive noteret som doedt.
  // Det behoeves heller ikke: taler appen ikke med panelet, er der ingen
  // kanaler at vise logoer for.
  const toProbe = [...samples].filter(([origin]) => !sources.has(origin));
  const known: LogoHostRecord[] = [...samples]
    .filter(([origin]) => sources.has(origin))
    .map(([origin]) => ({ origin, state: 'ok' as const, detail: 'kildens egen vært' }));

  // Samtidigt, ikke efter hinanden: vaerterne har intet med hinanden at goere,
  // og en der ikke svarer maa ikke holde de oevrige tilbage.
  const measured = await Promise.all(
    toProbe.map(([origin, url]) => probeOrigin(origin, url, fetchImpl)),
  );

  const hosts = [...known, ...measured];
  for (const record of hosts) await recordLogoHostState(db, record);

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
    const response = await withTimeout(fetchImpl(url));
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

/**
 * Giver op efter `PROBE_TIMEOUT_MS`, uanset hvad den underliggende hentning
 * gaar og laver.
 *
 * Det underliggende kald har sin egen timeout, men den er sat efter hvad et
 * panel maa have lov at bruge paa et svar. En maaling ingen venter paa maa
 * ikke laane den graense.
 */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      },
    );
  });
}
