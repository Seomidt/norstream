import { XtreamAuthError, XtreamClient, detectTimeshiftDialect } from '@norstream/core';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { addSource, deleteSource, listSources } from '../storage/sources.js';
import { setPanelOffsetMinutes, setTimeshiftDialect } from '../storage/settings.js';
import type { SqlDatabase } from '../storage/types.js';
import { syncChannels } from '../sync/syncChannels.js';
import { syncM3u } from '../sync/syncM3u.js';

/**
 * Hvad der kom ud af at tilfoeje en kilde.
 *
 * En fejl er en **vaerdi**, ikke en undtagelse. Begge skaerme der tilfoejer
 * kilder skal vise den samme danske forklaring, og en kastet fejl ville
 * betyde to steder der hver formulerer sig paa sin maade — eller glemmer det.
 */
export type ConnectResult =
  | { ok: true; sourceId: string; name: string }
  | { ok: false; message: string };

export interface XtreamRequest {
  url: string;
  username: string;
  password: string;
  /** Valgfri XMLTV-adresse der fylder hullerne i panelets egen oversigt. */
  xmltvUrl?: string;
  /** Navn i listen. Uden det bruges vaerten. */
  name?: string;
}

export interface M3uRequest {
  url: string;
  xmltvUrl?: string;
  name?: string;
}

/** Et brugbart navn til kilden, taget af adressen. */
export function hostOf(url: string): string {
  const match = /^[a-z]+:\/\/([^/:]+)/i.exec(url.trim());
  return match?.[1] ?? 'Kilde';
}

/** Samme panel, uanset skraastreg til sidst og store bogstaver i vaertsnavnet. */
function sameOrigin(a: string, b: string): boolean {
  const norm = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Kort, renset beskrivelse af en forbindelsesfejl.
 *
 * Legitimationen filtreres fra: stream- og API-adresser baerer adgangskoden
 * som et sti-segment, og fejl fra netvaerkslaget citerer rutinemaessigt hele
 * adressen. Uden det her ville en fejlbesked paa skaermen vaere et kodeord.
 */
export function describeFailure(cause: unknown, creds: XtreamCredentials): string {
  const raw = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  let safe = raw;
  if (creds.password.length > 0) safe = safe.split(creds.password).join('***');
  if (creds.username.length > 0) safe = safe.split(creds.username).join('***');
  return safe.slice(0, 300);
}

/**
 * Tilfoejer et Xtream-panel: logger ind, gemmer kilden, henter kanalerne.
 *
 * Kilden oprettes **foer** kodeordet gemmes, fordi kodeordet gemmes under
 * kildens id. Og kanalerne hentes her frem for af skaermen bagefter: den
 * session skaermen har, kender endnu ikke den nye kilde og ville springe
 * netop den over — saa ville kilden staa tom til naeste opstart.
 */
export async function connectXtream(
  db: SqlDatabase,
  fetchImpl: FetchLike,
  request: XtreamRequest,
): Promise<ConnectResult> {
  const creds: XtreamCredentials = {
    baseUrl: request.url.trim(),
    username: request.username.trim(),
    password: request.password,
  };

  try {
    await new XtreamClient(creds, fetchImpl).authenticate();
  } catch (cause) {
    return {
      ok: false,
      message:
        cause instanceof XtreamAuthError
          ? 'Brugernavn eller adgangskode blev afvist af panelet.'
          : `Kunne ikke nå panelet. Tjek adressen og din forbindelse.\n\nDetalje: ${describeFailure(cause, creds)}`,
    };
  }

  const name = optional(request.name) ?? hostOf(creds.baseUrl);
  let sourceId: string;
  try {
    // Findes kilden allerede — samme panel, samme brugernavn — er det et
    // nyt login paa den, ikke en kilde til. Favoritter, optagelser og alt
    // andet der haenger paa kilden bliver staaende; kun kodeordet skiftes.
    const existing = (await listSources(db)).find(
      (source) =>
        source.kind === 'xtream' &&
        sameOrigin(source.url, creds.baseUrl) &&
        source.username === creds.username,
    );
    if (existing !== undefined) {
      const { saveSourceCredentials } = await import('../storage/credentials.js');
      await saveSourceCredentials(existing.id, creds);
      await probeArchive(db, fetchImpl, existing.id, creds);
      return { ok: true, sourceId: existing.id, name: existing.name };
    }

    const source = await addSource(db, {
      kind: 'xtream',
      name,
      url: creds.baseUrl,
      username: creds.username,
      xmltvUrl: optional(request.xmltvUrl),
    });
    sourceId = source.id;
    // Hentes foerst her. `storage/credentials` traekker `react-native` med
    // sig, og det modul kan ikke laeses af testkoerslen — saa ville hele den
    // her fil, ogsaa M3U-vejen og de rene funktioner, staa uden tests.
    const { saveSourceCredentials } = await import('../storage/credentials.js');
    await saveSourceCredentials(sourceId, creds);
  } catch {
    return { ok: false, message: 'Kunne ikke gemme dine adgangsoplysninger på denne enhed.' };
  }

  try {
    await syncChannels(db, sourceId, creds, fetchImpl);
  } catch {
    // Panelet svarede paa login og ikke paa kanallisten. Kilden bliver
    // staaende; naeste opdatering forsoeger igen.
  }
  await probeArchive(db, fetchImpl, sourceId, creds);
  return { ok: true, sourceId, name };
}

/**
 * Tilfoejer en M3U-liste og henter den med det samme.
 *
 * Med det samme, fordi det er den eneste maade en forkert adresse bliver
 * opdaget mens brugeren staar med den. Giver listen ingen kanaler, fjernes
 * kilden igen — en tom kilde i listen ligner en fejl der er sket senere.
 */
export async function connectM3u(
  db: SqlDatabase,
  fetchImpl: FetchLike,
  request: M3uRequest,
): Promise<ConnectResult> {
  const url = request.url.trim();
  const name = optional(request.name) ?? hostOf(url);
  const source = await addSource(db, {
    kind: 'm3u',
    name,
    url,
    xmltvUrl: optional(request.xmltvUrl),
  });

  try {
    const result = await syncM3u(db, source, fetchImpl);
    if (result.channels === 0) {
      await deleteSource(db, source.id);
      return { ok: false, message: 'Listen kunne hentes, men indeholdt ingen kanaler.' };
    }
  } catch {
    await deleteSource(db, source.id);
    return { ok: false, message: 'Kunne ikke hente listen. Tjek adressen og din forbindelse.' };
  }
  return { ok: true, sourceId: source.id, name };
}

/**
 * Finder panelets tidszone og timeshift-dialekt for den nye kilde.
 *
 * Maa ikke kunne blokere tilfoejelsen: uden arkiv virker alt andet stadig, og
 * kun start-forfra er utilgaengeligt. Afspilleren kan probe igen bagefter.
 */
export async function probeArchive(
  db: SqlDatabase,
  fetchImpl: FetchLike,
  sourceId: string,
  creds: XtreamCredentials,
): Promise<void> {
  try {
    const client = new XtreamClient(creds, fetchImpl);
    // Panelets afvigelse fra UTC laeses foerst: gemmes den inden probingen,
    // bygger probe-adresserne paa det rigtige tidspunkt.
    const offset = await client.getPanelOffsetMinutes();
    if (offset !== null) await setPanelOffsetMinutes(db, offset, sourceId);

    const streams = await client.getLiveStreams();
    const withArchive = streams.find((stream) => stream.hasArchive);
    if (withArchive === undefined) return;

    const dialect = await detectTimeshiftDialect(
      creds,
      withArchive.id,
      fetchImpl,
      new Date(),
      offset ?? 0,
    );
    await setTimeshiftDialect(db, dialect, sourceId);
  } catch {
    // Med vilje: se kommentaren ovenfor.
  }
}
