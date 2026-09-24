import { buildXmltvUrl } from '@norstream/core';
import type { Programme, XtreamCredentials } from '@norstream/core';
import { streamSource } from '../net/doh.js';
import { upsertProgrammes } from '../storage/programmes.js';
import { getPanelEpgEnabled, getSetting, setSetting } from '../storage/settings.js';
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
 *  - Kun favoritter uden EPG-id (det guiden viser, og som ellers staar tomt),
 *    og kun et vindue paa tre doegn. Hundreder af kanaler, ikke 22.000.
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
/** Et loft saa en kaempe favoritliste ikke goer det tungt. */
const MAX_WANTED = 600;

const lastKey = (sourceId: string): string => `last_panel_epg_ms:${sourceId}`;

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
  if (last !== null && Number.isFinite(last)) {
    const age = now.getTime() - last;
    if (age < (options.force === true ? FORCE_MIN_MS : PANEL_EPG_INTERVAL_MS)) return null;
  }

  const wanted = await db.getAllAsync<WantedChannel>(
    `SELECT c.id AS key, c.name AS name, c.country AS country
     FROM favorites f
     JOIN channels c ON c.id = f.channel_id
     WHERE c.source_id = ? AND (c.epg_channel_id IS NULL OR c.epg_channel_id = '')
     ORDER BY f.position IS NULL, f.position
     LIMIT ${MAX_WANTED}`,
    [sourceId],
  );
  if (wanted.length === 0) return null;

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
    for (const { sourceId, creds } of sources) {
      try {
        await syncPanelEpg(db, sourceId, creds, options);
      } catch {
        // Med vilje: naeste kilde skal stadig have sin chance.
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
