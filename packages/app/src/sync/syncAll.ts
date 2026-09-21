import { XtreamAuthError } from '@norstream/core';
import type { FetchLike } from '@norstream/core';
import type { SourceAccess } from '../sources/access.js';
import type { SqlDatabase } from '../storage/types.js';
import {
  getLastSyncMs,
  getLastXmltvMs,
  getSetting,
  setSetting,
  setLastSyncMs,
  getLogoRegistryEnabled,
  setLastXmltvMs,
  setRegistryError,
} from '../storage/settings.js';
import { deleteOrphanedChannelData } from '../storage/channels.js';
import { checkLogoHosts } from './logoHosts.js';
import { syncChannels } from './syncChannels.js';
import { syncM3u } from './syncM3u.js';
import { syncVod } from './syncVod.js';
import { refreshFollowedSeries } from './vodDetails.js';
import { syncLogoRegistry } from './syncLogoRegistry.js';
import { forgetLogoMisses } from '../ui/logoCache.js';
import { syncXmltv } from './syncXmltv.js';

/** Kanallisten hentes hoejst én gang i doegnet af sig selv. */
export const CHANNEL_SYNC_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * Programoversigten for en M3U-kilde hentes ogsaa hoejst én gang i doegnet.
 *
 * Xtream-kilder er ikke med her: deres EPG hentes per kanal og kun for de
 * raekker der er fremme, med sin egen friskhed paa en halv time. En XMLTV-fil
 * er derimod alt-eller-intet — den daekker hele listen paa én gang, og der er
 * ingen grund til at hente den oftere end programmerne aendrer sig.
 */
export const XMLTV_INTERVAL_MS = 24 * 60 * 60_000;

/** Efter en fejlet XMLTV-hentning: proev igen om en time, ikke om et doegn. */
const XMLTV_RETRY_MS = 60 * 60_000;

/**
 * Version af de indbyggede EPG-feeds. Aendrer listen sig (nye/andre feeds), skal
 * de hentes med det samme efter en opdatering — ikke foerst naar den gamle
 * "sidst hentet" er et doegn gammel. Naar tallet her er hoejere end det gemte,
 * nulstilles XMLTV-hentetiderne én gang, saa de nye feeds kommer ind straks.
 * **Haev det her, hver gang DEFAULT_XMLTV_URLS aendres.**
 */
const XMLTV_DEFAULTS_VERSION = 1;
const XMLTV_DEFAULTS_VERSION_KEY = 'xmltv_defaults_version';

/**
 * Indbyggede EPG-filer der bruges for ALLE kilder, oven i det brugeren selv har
 * skrevet ind. Saa er programoversigten bred fra foerste start — panelets egen
 * EPG daekker sjaeldent de mange kanaler, og de her fylder hullerne paa DK, UK
 * og US uden at man skal taste noget.
 *
 * Kun feeds MAALT til at passe under loftet (40 MB upakket, se
 * scripts/maal/epgfeeds.mjs). Den fulde US er 156 MB / den store US-cable-fil
 * 76 MB — for stort til en tv-boks; US daekkes derfor af de gratis FAST-feeds
 * (nyheder, film, underholdning), ~1.700 kanaler tilsammen, der passer sikkert.
 */
const DEFAULT_XMLTV_URLS = [
  // Danmark — 217 kanaler, 9,9 MB upakket
  'https://epgshare01.online/epgshare01/epg_ripper_DK1.xml.gz',
  // Storbritannien — 486 kanaler, 22,4 MB upakket
  'https://epgshare01.online/epgshare01/epg_ripper_UK1.xml.gz',
  // USA (FAST) — nyheder + underholdning (CBS/ABC/NBC/FOX news m.fl.), 582 kanaler, 3,0 MB
  'https://i.mjh.nz/SamsungTVPlus/us.xml.gz',
  // USA (FAST) — film og serier (AMC, ION m.fl.), 693 kanaler, 14,8 MB
  'https://i.mjh.nz/Plex/us.xml.gz',
  // USA (FAST) — Pluto TV, 430 kanaler, 7,4 MB
  'https://i.mjh.nz/PlutoTV/us.xml.gz',
];

/**
 * Logo-registret hentes hoejst én gang om ugen.
 *
 * Det er to filer paa tre megabyte hver, og kanallogoer aendrer sig ikke fra
 * dag til dag. En uge er rigeligt, og det holder hentningen ude af den
 * daglige rytme hvor den ville koste baandbredde uden at give noget.
 */
export const REGISTRY_INTERVAL_MS = 7 * 24 * 60 * 60_000;

/** Noeglen registrets hentetid gemmes under. */
const REGISTRY_SOURCE = '__registry__';

export interface SyncAllResult {
  /** Kilder der blev hentet uden problemer. */
  synced: number;
  /** Kilder der var friske nok til at blive sprunget over. */
  skipped: number;
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
  options: { force?: boolean; now?: Date } = {},
): Promise<SyncAllResult> {
  const now = options.now ?? new Date();
  const force = options.force === true;
  const result: SyncAllResult = { synced: 0, skipped: 0, rejected: [], failed: [] };

  // Ryd rester fra kilder der er slettet: en fil man har fjernet maa ikke blive
  // ved med at rode i kanallisten. Maa aldrig kunne vaelte selve hentningen.
  try {
    await deleteOrphanedChannelData(db);
  } catch {
    // Med vilje: oprydningen er en ekstra sikkerhed, ikke en forudsaetning.
  }

  // Er de indbyggede EPG-feeds skiftet siden sidst (ny app-udgave), saa nulstil
  // XMLTV-hentetiderne én gang, saa de nye feeds hentes STRAKS — ikke foerst naar
  // den gamle "sidst hentet" er et doegn gammel.
  try {
    await maybeInvalidateXmltvDefaults(db);
  } catch {
    // Ekstra sikkerhed, ikke en forudsaetning.
  }

  for (const access of sources) {
    // Hver kilde har sin egen doegnrytme. Med én faelles ville en nyligt
    // tilfoejet kilde arve de andres hentetid og staa tom i op til et doegn.
    const last = await getLastSyncMs(db, access.source.id);
    const fresh = last !== null && now.getTime() - last < CHANNEL_SYNC_INTERVAL_MS;
    if (!force && fresh) {
      result.skipped += 1;
      await maybeXmltv(db, access, fetchImpl, now, force);
      continue;
    }

    try {
      if (access.source.kind === 'm3u') {
        await syncM3u(db, access.source, fetchImpl, now);
        await maybeXmltv(db, access, fetchImpl, now, true);
      } else if (access.creds !== null) {
        await syncChannels(db, access.source.id, access.creds, fetchImpl, now);
        await maybeXmltv(db, access, fetchImpl, now, true);
        // Film og serier foelger kanalernes doegnrytme. Fejler de, staar
        // kanalerne stadig — `syncVod` sluger selv sine fejl per slags.
        await syncVod(db, access.source.id, access.creds, fetchImpl, now);
        // Serier man foelger: afsnitlisten igen, saa forsiden kan sige "nye afsnit".
        await refreshFollowedSeries(db, access.source.id, access.creds, fetchImpl, now).catch(() => undefined);
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

  // **Efter** kilderne, ikke foer. Registret er to filer paa flere megabyte og
  // over 60.000 raekker i databasen; laa det foerst, ventede kanaler og
  // programoversigt paa noget der kun handler om logoer.
  //
  // Og **uden** `force`. Det er den vigtige del. `force` betyder "brugeren
  // trak ned og vil have friske kanaler" — og det blev til: hent syv megabyte
  // forfra, slet 61.828 raekker og skriv dem igen. Hver eneste gang. SQLite
  // lader ikke laesninger komme forbi en skrivning, saa kanaler og
  // programoversigt stod i koe bag den. Registret har sin egen uge-rytme, og
  // en knap i indstillinger til dem der vil have det nu.
  await maybeRegistry(db, fetchImpl, now, false);

  // Samme grund: vaerterne har deres egen rytme paa seks timer og deres egen
  // knap. En doed vaert koster ventetid per maaling, og det skal en
  // opdatering af kanallisten ikke betale for.
  try {
    await checkLogoHosts(db, fetchImpl, now, false);
  } catch {
    // Med vilje: logo-vaerter maa ikke kunne vaelte en kanal-synkronisering.
  }

  return result;
}

/**
 * Henter logo-registret nu, uanset hvor frisk det er.
 *
 * Ligger for sig selv frem for som et flag paa `syncAllSources`, saa den
 * eneste vej til en tvungen hentning er et bevidst tryk. Det var et flag, og
 * flaget fulgte med traek-ned.
 */
export async function refreshLogoRegistry(
  db: SqlDatabase,
  fetchImpl: FetchLike,
  now: Date = new Date(),
): Promise<void> {
  await maybeRegistry(db, fetchImpl, now, true);
}

/**
 * Henter kildens XMLTV-programoversigt hvis den har en og den er blevet gammel.
 *
 * Fejler den, gaar det ikke ud over kanalerne: en liste uden programoversigt
 * er stadig en liste man kan se tv fra. Fejlen samles op af kalderen gennem
 * `failed`, saa den kan siges.
 */
async function maybeXmltv(
  db: SqlDatabase,
  access: SourceAccess,
  fetchImpl: FetchLike,
  now: Date,
  force: boolean,
): Promise<void> {
  // Koeres for ALLE kilder, ogsaa dem uden egen XMLTV-adresse: de indbyggede
  // standard-feeds (DK/UK/US) gaelder alle, saa programoversigten er bred fra
  // start. Et panel har tit kanaler uden EPG, og filerne fylder hullerne.
  const { source } = access;

  const last = await getLastXmltvMs(db, source.id);
  if (!force && last !== null && now.getTime() - last < XMLTV_INTERVAL_MS) return;

  // Marker forsoeget **foer** hentningen, ikke efter. Ellers: doer eller
  // afbrydes appen midt i en stor parse, blev "sidst hentet" aldrig sat — og
  // saa proever den forfra hver eneste gang appen aabnes. Med en tung fil er
  // det en app der fryser ved hver start. EPG er ikke kritisk; ét forsoeg i
  // doegnet er rigeligt, ogsaa naar det gik galt. Naeste doegn proever den igen.
  // Marker forsoeget **foer** hentningen, saa en app der lukkes midt i parsen
  // ikke koerer forfra ved hver start.
  await setLastXmltvMs(db, source.id, now.getTime());
  // De indbyggede feeds foerst, saa kildens egne adresser oven i — afdupliceret,
  // saa den samme adresse ikke hentes to gange. syncXmltv laeser xmltvUrl, saa
  // vi giver den en kopi af kilden med den sammensatte adresse.
  const own = (source.xmltvUrl ?? '').split(/[\s,]+/).map((url) => url.trim()).filter((url) => url.length > 0);
  const merged = [...new Set([...DEFAULT_XMLTV_URLS, ...own])].join(' ');
  try {
    await syncXmltv(db, { ...source, xmltvUrl: merged }, fetchImpl);
    // Lykkedes (mindst én feed): behold doegnrytmen (tidsstemplet staar).
  } catch {
    // ALLE feeds fejlede (syncXmltv kaster kun da). Saet tidsstemplet tilbage,
    // saa den proever igen om en TIME i stedet for om et doegn — en midlertidig
    // netfejl maa ikke holde programoversigten vaek en hel dag. (Men ikke helt
    // nulstillet: den skal stadig ikke koere forfra ved hver app-start.)
    await setLastXmltvMs(db, source.id, now.getTime() - (XMLTV_INTERVAL_MS - XMLTV_RETRY_MS));
  }
}

/**
 * Nulstiller XMLTV-hentetiderne én gang, naar de indbyggede feeds er skiftet.
 *
 * Uden det ville en app-udgave med nye/andre EPG-feeds foerst hente dem naar
 * den gamle "sidst hentet" var et doegn gammel — saa den brede EPG lod vente paa
 * sig efter en opdatering. Sammenligner en gemt version med koden; er de ens,
 * goeres intet.
 */
async function maybeInvalidateXmltvDefaults(db: SqlDatabase): Promise<void> {
  const stored = await getSetting(db, XMLTV_DEFAULTS_VERSION_KEY);
  if (stored === String(XMLTV_DEFAULTS_VERSION)) return;
  // Alle kilders XMLTV-hentetid ryddes, saa maybeXmltv henter forfra naeste gang.
  await db.runAsync("DELETE FROM settings WHERE key LIKE 'last_xmltv_ms:%'");
  await setSetting(db, XMLTV_DEFAULTS_VERSION_KEY, String(XMLTV_DEFAULTS_VERSION));
}

/**
 * Henter det aabne logo-register hvis det er blevet gammelt.
 *
 * Fejler det, gaar det ikke ud over noget: registret er en **reserve** for de
 * kanaler hvor udbyderens egen logo-adresse mangler eller ikke kan naas. Uden
 * det staar kanalens forbogstaver, som foer.
 */
async function maybeRegistry(
  db: SqlDatabase,
  fetchImpl: FetchLike,
  now: Date,
  force: boolean,
): Promise<void> {
  if (!(await getLogoRegistryEnabled(db))) return;

  const last = await getLastSyncMs(db, REGISTRY_SOURCE);
  if (!force && last !== null && now.getTime() - last < REGISTRY_INTERVAL_MS) return;

  try {
    await syncLogoRegistry(db, fetchImpl);
    await setLastSyncMs(db, now.getTime(), REGISTRY_SOURCE);
    await setRegistryError(db, null);
    // Et nyt register kan kende kanaler det gamle ikke kendte. De der staar
    // uden logo, faar lov at proeve igen — de der har et, roeres ikke.
    await forgetLogoMisses();
  } catch (cause) {
    // Fejlen sluges ikke laengere. Den gjorde det foer, og resultatet var at
    // "Det aabne kanalregister er ikke hentet endnu" stod paa skaermen uden at
    // nogen — heller ikke jeg — kunne se **hvorfor**. En aarsag der ikke er
    // gemt noget sted, kan kun gaettes paa.
    await setRegistryError(db, cause instanceof Error ? cause.message : String(cause));
  }
}
