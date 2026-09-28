import { buildXmltvUrl } from '@norstream/core';
import type { Programme, XtreamCredentials } from '@norstream/core';
import { streamSource } from '../net/doh.js';
import { upsertProgrammes } from '../storage/programmes.js';
import { getPanelEpgEnabled, getSetting, setSetting } from '../storage/settings.js';
import { sportChannels } from '../storage/sport.js';
import type { SqlDatabase } from '../storage/types.js';
import { matchPanelEpg } from './panelEpgMatch.js';
import type { FeedChannel, WantedChannel } from './panelEpgMatch.js';

/**
 * EPG fra panelets egen XMLTV-fil (xmltv.php) til de favoritter panelet
 * ikke giver EPG for per kanal — i praksis UK, US m.fl.
 *
 * Panelets `get_short_epg` virker kun for kanaler med et EPG-id (13 %, mest
 * de danske). TiviMate faar resten fra den store fil og matcher paa navn.
 * Det goer vi ogsaa, men med den laere fra v314–v318, hvor store EPG-filer
 * frøs boksen:
 *
 *  - Filen hentes og laeses i en baggrundstraad i native kode (PanelEpgModule),
 *    aldrig i JavaScript og aldrig hele i hukommelsen.
 *  - Kun favoritter (det guiden viser) som panelet ikke giver EPG for per
 *    kanal, og kun et vindue paa tre doegn. Favoritter, ikke alle 22.000.
 *    Fra v342 ogsaa sportskanalerne "Find kampen" soeger i (hoejst 150,
 *    `storage/sport.ts`), for de fleste af dem (UK, US …) har intet EPG-id
 *    og fik ellers aldrig programmer — saa fandt Sport kun det danske.
 *  - Kun panelets fil. Ingen indbyggede DK/UK/US-feeds (se OVERDRAGELSE).
 *  - Matchning paa navn OG land; kan det ikke afgoeres, springes kanalen over.
 *  - Højst én gang i doegnet; "Hent" (force) hoejst én gang i timen.
 */
export interface PanelEpgNative {
  download(url: string, headersJson: string): Promise<string>;
  channels(path: string): Promise<string>;
  programmes(path: string, idsJson: string, fromMs: number, toMs: number): Promise<string>;
  remove(path: string): boolean;
}

export const PANEL_EPG_INTERVAL_MS = 24 * 60 * 60_000;
/** Hent (force) maa gerne koere den igen, men ikke ved hvert tryk. */
const FORCE_MIN_MS = 60 * 60_000;
/** Efter en fejl: proev igen om en time, ikke om et doegn. */
const RETRY_MS = 60 * 60_000;
const BEFORE_MS = 24 * 60 * 60_000;
const AFTER_MS = 48 * 60 * 60_000;
/** Et sikkerhedsloft; langt over en normal favoritliste, saa alle favoritter kommer med. */
const MAX_WANTED = 5000;
/** En kanal "har EPG" hvis der ligger programmer i de naeste timer. */
const HAS_EPG_AHEAD_MS = 6 * 60 * 60_000;

// "2": v321 tager alle favoritter med (ogsaa dem med EPG-id uden programmer).
// "3": v342 tager sportskanalerne med. Ny noegle hver gang, saa den koerer
// med det samme efter opdateringen i stedet for om et doegn.
const lastKey = (sourceId: string): string => `last_panel_epg3_ms:${sourceId}`;
/** De kanaler sidste koersel hentede for; aendrer listen sig, koeres der igen (hoejst hver time). */
const wantedKey = (sourceId: string): string => `panel_epg_wanted:${sourceId}`;

let inFlight: Promise<void> | null = null;

/** Koerslen der er i gang, om nogen — saa Sport kan vente paa den og soege igen. */
export function panelEpgInFlight(): Promise<void> | null {
  return inFlight;
}

let registered: PanelEpgNative | null = null;

/**
 * Appen registrerer det native modul ved start (App.tsx). Synkroniseringen
 * importerer det ikke selv: den koeres ogsaa i testene, uden React Native.
 */
export function registerPanelEpgNative(native: PanelEpgNative | null): void {
  registered = native;
}

export interface PanelEpgResult {
  /** Favoritter der fik en kanal i filen. */
  matched: number;
  /** Programmer skrevet. */
  programmes: number;
}

interface FeedProgramme {
  c: string;
  s: number;
  e: number;
  t: string;
  d?: string;
}

/**
 * Henter EPG fra panelets fil for én kilde, hvis det er tid. Svarer med null
 * naar der ikke blev gjort noget (slaaet fra, ingen modul, frisk, intet at hente).
 */
export async function syncPanelEpg(
  db: SqlDatabase,
  sourceId: string,
  creds: XtreamCredentials,
  options: { now?: Date; force?: boolean; native?: PanelEpgNative | null } = {},
): Promise<PanelEpgResult | null> {
  const native = options.native === undefined ? registered : options.native;
  if (native === null) return null;
  if (!(await getPanelEpgEnabled(db))) return null;

  const now = options.now ?? new Date();
  const lastRaw = await getSetting(db, lastKey(sourceId));
  const last = lastRaw === null ? null : Number(lastRaw);
  const age = last !== null && Number.isFinite(last) ? now.getTime() - last : Number.POSITIVE_INFINITY;
  // Aldrig oftere end hver time — heller ikke med "Hent".
  if (age < FORCE_MIN_MS) return null;

  // Alle favoritter uden programmer i de naeste timer, uanset EPG-id (v343).
  // Foer skulle panelet foerst vaere spurgt per kanal (epg_fetch) foer en
  // favorit MED EPG-id kom med; koerte den daglige hentning foer det, stod
  // favoritterne uden EPG et doegn, mens sportskanalerne fik deres. Dem der
  // allerede har EPG, roeres stadig ikke — ellers blev hundredvis af danske
  // favoritter skrevet dobbelt.
  const nowMs = now.getTime();
  const wanted = await db.getAllAsync<WantedChannel>(
    `SELECT c.id AS key, c.name AS name, c.country AS country, c.epg_channel_id AS epgId
     FROM favorites f
     JOIN channels c ON c.id = f.channel_id
     WHERE c.source_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM programmes p WHERE p.channel_id = c.id AND p.stop_ms > ? AND p.start_ms < ?
       )
     ORDER BY f.position IS NULL, f.position
     LIMIT ${MAX_WANTED}`,
    [sourceId, nowMs, nowMs + HAS_EPG_AHEAD_MS],
  );
  // Sportskanalerne (v342): dem uden programmer forude, uanset EPG-id —
  // `refreshSportEpg` har allerede spurgt panelet per kanal for dem der kan.
  const sportInfo = await sportChannels(db).catch(() => null);
  const sport = sportInfo === null ? [] : sportInfo.refresh.filter((key) => sportInfo.sport.has(key) && key.startsWith(`${sourceId}:`));
  const known = new Set(wanted.map((entry) => entry.key));
  for (let i = 0; i < sport.length; i += 300) {
    const slice = sport.slice(i, i + 300).filter((key) => !known.has(key));
    if (slice.length === 0) continue;
    const placeholders = slice.map(() => '?').join(', ');
    const rows = await db.getAllAsync<WantedChannel>(
      `SELECT c.id AS key, c.name AS name, c.country AS country, c.epg_channel_id AS epgId
       FROM channels c
       WHERE c.id IN (${placeholders})
         AND NOT EXISTS (
           SELECT 1 FROM programmes p WHERE p.channel_id = c.id AND p.stop_ms > ? AND p.start_ms < ?
         )`,
      [...slice, nowMs, nowMs + HAS_EPG_AHEAD_MS],
    );
    for (const row of rows) {
      known.add(row.key);
      wanted.push(row);
    }
  }
  if (wanted.length === 0) return null;

  // Én gang i doegnet — men er der kommet NYE kanaler at hente for (en ny
  // favorit, et nyt hold i Sport), koeres den igen efter en time i stedet for
  // om et doegn (v343). Det er derfor de to tidsgraenser er skilt ad ovenfor.
  const wantedNow = wanted.map((entry) => entry.key).sort().join('\n');
  const wantedBefore = (await getSetting(db, wantedKey(sourceId))) ?? '';
  if (options.force !== true && age < PANEL_EPG_INTERVAL_MS && wantedNow === wantedBefore) return null;
  await setSetting(db, wantedKey(sourceId), wantedNow);

  // Marker foer hentningen: lukkes appen midt i, skal den ikke starte forfra
  // ved hver aabning (samme laere som XMLTV i v298).
  await setSetting(db, lastKey(sourceId), String(now.getTime()));

  const source = streamSource(buildXmltvUrl(creds));
  const url = typeof source === 'string' ? source : source.uri;
  const headers = typeof source === 'string' ? {} : source.headers;

  let path: string | null = null;
  try {
    path = await native.download(url, JSON.stringify(headers));
    const feed = JSON.parse(await native.channels(path)) as FeedChannel[];
    const matches = matchPanelEpg(wanted, feed);
    if (matches.size === 0) return { matched: 0, programmes: 0 };

    const from = now.getTime() - BEFORE_MS;
    const to = now.getTime() + AFTER_MS;
    const found = JSON.parse(await native.programmes(path, JSON.stringify([...matches.keys()]), from, to)) as FeedProgramme[];

    const programmes: Programme[] = [];
    for (const entry of found) {
      const keys = matches.get(entry.c);
      if (keys === undefined) continue;
      for (const key of keys) {
        programmes.push({
          channelId: key,
          start: new Date(entry.s),
          stop: new Date(entry.e),
          title: entry.t,
          description: entry.d ?? null,
        });
      }
    }
    await upsertProgrammes(db, programmes);
    let matched = 0;
    for (const keys of matches.values()) matched += keys.length;
    return { matched, programmes: programmes.length };
  } catch (cause) {
    // Proev igen om en time frem for om et doegn: en midlertidig netfejl maa
    // ikke holde programoversigten vaek en hel dag.
    await setSetting(db, lastKey(sourceId), String(now.getTime() - (PANEL_EPG_INTERVAL_MS - RETRY_MS)));
    throw cause;
  } finally {
    if (path !== null) {
      try {
        native.remove(path);
      } catch {
        // Cachen ryddes ogsaa af systemet.
      }
    }
  }
}

let running: Promise<void> | null = null;

/**
 * Koerer panel-EPG for kilderne én ad gangen, i baggrunden — kaldet venter
 * ikke. Koerer den allerede, goeres intet. Fejl sluges: EPG er aldrig
 * vigtigere end at appen virker.
 */
export function startPanelEpg(
  db: SqlDatabase,
  sources: ReadonlyArray<{ sourceId: string; creds: XtreamCredentials }>,
  options: { now?: Date; force?: boolean } = {},
): Promise<void> | null {
  if (running !== null || registered === null || sources.length === 0) return null;
  running = (async () => {
    // Samme loefte udadtil (panelEpgInFlight), saa Sport kan vente paa den.
    for (const { sourceId, creds } of sources) {
      try {
        await syncPanelEpg(db, sourceId, creds, options);
      } catch {
        // Med vilje: naeste kilde skal stadig have sin chance.
      }
    }
  })().finally(() => {
    running = null;
    inFlight = null;
  });
  inFlight = running;
  return running;
}
