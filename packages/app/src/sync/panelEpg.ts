import { XtreamClient, buildXmltvUrl, normaliseChannelName } from '@norstream/core';
import type { FetchLike, Programme, XtreamCredentials } from '@norstream/core';
import { eligibleParts, pinnedIp, streamSource } from '../net/doh.js';
import { upsertProgrammes } from '../storage/programmes.js';
import { deviceUtcOffset, nearTimeChange } from '../storage/epgFetch.js';
import { getPanelEpgEnabled, getSetting, setSetting } from '../storage/settings.js';
import { sportChannels } from '../storage/sport.js';
import type { SqlDatabase } from '../storage/types.js';
import { feedCountry, matchPanelEpg } from './panelEpgMatch.js';
import { withPanel } from './panelGate.js';
import { logEvent } from '../diagnostics/log.js';
import type { FeedChannel, WantedChannel } from './panelEpgMatch.js';

/**
 * EPG fra panelets egen XMLTV-fil (xmltv.php) til favoritter og arkivkanaler.
 *
 * Panelets `get_short_epg` virker kun for kanaler med et EPG-id (13 %, mest
 * de danske). TiviMate faar resten fra den store fil og matcher paa navn.
 * Det goer vi ogsaa, men med den laere fra v314–v318, hvor store EPG-filer
 * frøs boksen:
 *
 *  - Filen hentes og laeses i en baggrundstraad i native kode (PanelEpgModule),
 *    aldrig i JavaScript og aldrig hele i hukommelsen.
 *  - Alle favoritter (det guiden viser) og alle arkivkanaler, i vinduet
 *    syv dage bagud og to dage frem. Favoritter, ikke alle 22.000.
 *    Nu/naeste er ikke bevis for at resten af guiden er hentet (v388).
 *    Fra v342 ogsaa sportskanalerne "Find kampen" soeger i, for de fleste af
 *    dem (UK, US …) har intet EPG-id og fik ellers aldrig programmer — saa
 *    fandt Sport kun det danske. Fra v352 ALLE sportskanaler i pakken
 *    (hoejst FILE_SPORT_CAP), ikke kun de 150 panelet spoerges om per kanal:
 *    filen er én hentning, uanset hvor mange kanaler den daekker. Programmerne
 *    laeses ud i klumper (PROGRAMME_CHUNK feed-id'er ad gangen), saa JSON-svaret
 *    fra native aldrig bliver stort.
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
/** Hele syv kalenderdage, ogsaa foerste dags morgen og omkring sommertid. */
export function panelEpgFrom(now: Date): number {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 7);
  return from.getTime();
}
const AFTER_MS = 48 * 60 * 60_000;
/** Et sikkerhedsloft; langt over en normal favoritliste, saa alle favoritter kommer med. */
const MAX_WANTED = 5000;
/** En kanal "har EPG" hvis der ligger programmer i de naeste timer. */
const HAS_EPG_AHEAD_MS = 6 * 60 * 60_000;
/**
 * Hoejst saa mange sportskanaler filen bruges til (v352). Brugeren vil have
 * alt med; en pakke paa 22.000 kanaler har typisk et par tusind der ligner
 * sport. Bedste foerst (favoritter, favoritternes lande, resten), saa loftet
 * rammer de fjerneste.
 */
export const FILE_SPORT_CAP = 2500;
/** Feed-id'er per native laesning; hver er ét gennemloeb af filen, og svaret holdes paa faa MB. */
const PROGRAMME_CHUNK = 60;

// "2": v321 tager alle favoritter med (ogsaa dem med EPG-id uden programmer).
// "3": v342 sport; "4": v384 arkiv; "5": v388 fuld favorit-EPG og navnealiaser. Ny noegle, saa den koerer
// med det samme efter opdateringen i stedet for om et doegn.
const lastKey = (sourceId: string): string => `last_panel_epg5_ms:${sourceId}`;
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
  /** Kun ved frisk hentning: kanaler med faktisk skrevne programraekker. */
  channelIds?: string[];
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
export interface PanelEpgOptions {
  now?: Date;
  force?: boolean;
  native?: PanelEpgNative | null;
  /** Direkte bruger-aabning: hent en frisk fil uden time/doegn-cachen. */
  fresh?: boolean;
  /** Valgfri afgraensning, saa en dagsvisning kun opdaterer sin egen kanal. */
  channelIds?: readonly string[];
  shouldContinue?: () => boolean;
}

// Native bruger et faelles midlertidigt filnavn. Hele laesningen skal vaere
// afsluttet, inden en ny hentning kan erstatte filen efter et hurtigt skift.
let fileWork: Promise<void> = Promise.resolve();
export function syncPanelEpg(
  db: SqlDatabase,
  sourceId: string,
  creds: XtreamCredentials,
  options: PanelEpgOptions = {},
): Promise<PanelEpgResult | null> {
  const work = fileWork.then(() => readPanelEpg(db, sourceId, creds, options));
  fileWork = work.then(() => undefined, () => undefined);
  return work;
}

async function readPanelEpg(
  db: SqlDatabase,
  sourceId: string,
  creds: XtreamCredentials,
  options: PanelEpgOptions,
): Promise<PanelEpgResult | null> {
  const stopped = (): boolean => options.shouldContinue?.() === false;
  if (stopped()) return null;
  const native = options.native === undefined ? registered : options.native;
  if (native === null) return null;
  if (!(await getPanelEpgEnabled(db))) return null;

  const now = options.now ?? new Date();
  const lastRaw = await getSetting(db, lastKey(sourceId));
  const last = lastRaw === null ? null : Number(lastRaw);
  const age = last !== null && Number.isFinite(last) ? now.getTime() - last : Number.POSITIVE_INFINITY;
  // Aldrig oftere end hver time — heller ikke med "Hent".
  if (options.fresh !== true && age < FORCE_MIN_MS) return null;

  // Alle favoritter: get_short_epg kan give det aktuelle program uden at
  // getFullEpg giver resten. Et eneste program forude maa derfor ikke
  // blokere filens fulde oversigt. Filen hentes stadig hoejst dagligt.
  const nowMs = now.getTime();
  const wanted = await db.getAllAsync<WantedChannel>(
    `SELECT c.id AS key, c.name AS name, c.country AS country, c.epg_channel_id AS epgId
     FROM favorites f
     JOIN channels c ON c.id = f.channel_id
     WHERE c.source_id = ?
     ORDER BY f.position IS NULL, f.position
     LIMIT ${MAX_WANTED}`,
    [sourceId],
  );
  // Alle arkivkanaler, ogsaa dem der har EPG forude: fremtidige
  // programmer siger intet om hvorvidt sidste uges oversigt er hentet.
  const archives = await db.getAllAsync<WantedChannel>(
    `SELECT c.id AS key, c.name AS name, c.country AS country, c.epg_channel_id AS epgId
     FROM channels c LEFT JOIN favorites f ON f.channel_id = c.id
     WHERE c.source_id = ? AND c.has_archive = 1
     ORDER BY f.channel_id IS NULL, f.position, c.id`,
    [sourceId],
  );
  const favoriteKeys = new Set(wanted.map(entry => entry.key));
  for (const entry of archives) if (!favoriteKeys.has(entry.key)) {
    wanted.push(entry);
    favoriteKeys.add(entry.key);
  }
  // Sportskanalerne (v342): dem uden programmer forude, uanset EPG-id —
  // `refreshSportEpg` har allerede spurgt panelet per kanal for dem der kan.
  // v352: alle pakkens sportskanaler i rang-orden, ikke kun de 150 i `refresh`.
  const sportInfo = await sportChannels(db).catch(() => null);
  const sport =
    sportInfo === null
      ? []
      : [...sportInfo.sport]
          .filter((key) => key.startsWith(`${sourceId}:`))
          .sort((a, b) => (sportInfo.rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (sportInfo.rank.get(b) ?? Number.MAX_SAFE_INTEGER))
          .slice(0, FILE_SPORT_CAP);
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
  if (options.channelIds !== undefined) {
    const ids = [...new Set(options.channelIds)];
    if (ids.length === 0 || stopped()) return null;
    const selected: WantedChannel[] = [];
    // Hold ogsaa store favoritgrupper under Android SQLites variabelgraense.
    for (let i = 0; i < ids.length; i += 300) {
      if (stopped()) return null;
      const slice = ids.slice(i, i + 300);
      selected.push(...await db.getAllAsync<WantedChannel>(
        `SELECT c.id AS key, c.name AS name, c.country AS country, c.epg_channel_id AS epgId
         FROM channels c WHERE c.source_id = ? AND c.id IN (${slice.map(() => '?').join(',')})`,
        [sourceId, ...slice],
      ));
    }
    wanted.splice(0, wanted.length, ...selected);
  }
  if (wanted.length === 0 || stopped()) return null;

  // Én gang i doegnet — men er der kommet NYE kanaler at hente for (en ny
  // favorit, et nyt hold i Sport), koeres den igen efter en time i stedet for
  // om et doegn (v343). Det er derfor de to tidsgraenser er skilt ad ovenfor.
  // "Nye" = kanaler der ikke var med i nogen tidligere koersel. Kanaler filen
  // ikke kunne give noget, bliver ved med at mangle programmer, og de maa
  // ikke udloese en ny hentning hver time (v346: det gjorde de).
  const tried = new Set(((await getSetting(db, wantedKey(sourceId))) ?? '').split('\n').filter((key) => key.length > 0));
  const fresh = wanted.some((entry) => !tried.has(entry.key));
  if (options.fresh !== true && options.force !== true && age < PANEL_EPG_INTERVAL_MS && !fresh) return null;
  for (const entry of wanted) tried.add(entry.key);

  const source = streamSource(buildXmltvUrl(creds));
  const url = typeof source === 'string' ? source : source.uri;
  const headers = typeof source === 'string' ? {} : source.headers;

  let path: string | null = null;
  const startedAt = Date.now();
  try {
    // Filen er panelets ene forbindelse i flere minutter: i koe bag alt
    // synligt, som de andre baggrundskald (v350).
    path = await withPanel(true, () => {
      if (stopped()) return Promise.resolve(null);
      logEvent('baggrund', 'panel-fil: hentning starter (stor fil, i koe bag alt synligt)');
      return native.download(url, JSON.stringify(headers));
    });
    if (path === null || stopped()) return null;
    await setSetting(db, wantedKey(sourceId), [...tried].sort().join('\n'));
    await setSetting(db, lastKey(sourceId), String(now.getTime()));
    if (stopped()) return null;
    const feed = JSON.parse(await native.channels(path)) as FeedChannel[];
    if (stopped()) return null;
    const matches = matchPanelEpg(wanted, feed);
    logEvent('baggrund', `panel-fil: hentet paa ${Math.round((Date.now() - startedAt) / 1000)} s, ${feed.length} kanaler i filen, ${matches.size} af ${wanted.length} fundet`);
    if (matches.size === 0) return options.fresh === true
      ? { matched: 0, programmes: 0, channelIds: [] } : { matched: 0, programmes: 0 };

    const from = panelEpgFrom(now);
    const to = now.getTime() + AFTER_MS;
    // I klumper: hver klump er ét gennemloeb af filen i native kode og et
    // JSON-svar paa faa MB, skrevet foer den naeste laeses (v352).
    const feedIds = [...matches.keys()];
    let written = 0;
    const writtenChannels = new Set<string>();
    for (let i = 0; i < feedIds.length; i += PROGRAMME_CHUNK) {
      if (stopped()) return null;
      const slice = feedIds.slice(i, i + PROGRAMME_CHUNK);
      const found = JSON.parse(await native.programmes(path, JSON.stringify(slice), from, to)) as FeedProgramme[];
      if (stopped()) return null;
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
      // replaceWindow (v360): dagens fil erstatter gaarsdagens i det tidsrum den
      // daekker — et flyttet program maa ikke blive liggende ved siden af.
      await upsertProgrammes(db, programmes, { replaceWindow: true });
      written += programmes.length;
      for (const programme of programmes) writtenChannels.add(programme.channelId);
    }
    let matched = 0;
    for (const keys of matches.values()) matched += keys.length;
    logEvent('baggrund', `panel-fil: ${written} programmer skrevet for ${matched} kanaler, i alt ${Math.round((Date.now() - startedAt) / 1000)} s`);
    return options.fresh === true
      ? { matched, programmes: written, channelIds: [...writtenChannels] } : { matched, programmes: written };
  } catch (cause) {
    // Proev igen om en time frem for om et doegn: en midlertidig netfejl maa
    // ikke holde programoversigten vaek en hel dag.
    if (!stopped()) await setSetting(db, lastKey(sourceId), String(now.getTime() - (PANEL_EPG_INTERVAL_MS - RETRY_MS)));
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

/** Adresser (med panelets kodeord i stien) maa aldrig naa skaermen. */
/** Basen uden brugernavn/kodeord (de staar aldrig i den): skema, navn, port og evt. sti. */
function describeBase(baseUrl: string): string {
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)/i.exec(baseUrl.trim());
  if (match === null) return 'kunne ikke læses (ikke http/https)';
  const path = (match[3] ?? '').replace(/\/+$/, '');
  return `${match[1]}://${match[2]}${path.length > 0 ? `${path}  ← bemærk stien` : ''}`;
}

function safeText(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.replace(/https?:\/\/\S+/g, '[adresse]').slice(0, 200);
}

/**
 * "Test programoversigten" i Indstillinger (v345): koerer hele vejen for én
 * kilde uden tidsgraenser og fortaeller hvad der skete i hvert trin — er
 * modulet der, hvad panelet svarer per kanal, kom filen ned, hvor mange
 * kanaler den har, hvilke favoritter der blev parret og hvilke ikke (og
 * hvad filen kalder dem). Uden det kunne ingen se HVOR en tom guide gik
 * galt. Skriver ogsaa de programmer der blev fundet, saa testen retter det
 * den kan.
 */
export async function diagnosePanelEpg(
  db: SqlDatabase,
  sourceId: string,
  creds: XtreamCredentials,
  fetchImpl: FetchLike,
  options: { now?: Date; native?: PanelEpgNative | null } = {},
): Promise<string> {
  const lines: string[] = [];
  const native = options.native === undefined ? registered : options.native;
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  if (!(await getPanelEpgEnabled(db))) lines.push('Hent fra panelets fil er slået FRA i indstillingerne.');
  if (native === null) lines.push('Det native modul til filen mangler (ikke Android?).');

  const wanted = await db.getAllAsync<WantedChannel>(
    `SELECT c.id AS key, c.name AS name, c.country AS country, c.epg_channel_id AS epgId
     FROM favorites f JOIN channels c ON c.id = f.channel_id
     WHERE c.source_id = ?
       AND NOT EXISTS (SELECT 1 FROM programmes p WHERE p.channel_id = c.id AND p.stop_ms > ? AND p.start_ms < ?)
     ORDER BY f.position IS NULL, f.position LIMIT ${MAX_WANTED}`,
    [sourceId, nowMs, nowMs + HAS_EPG_AHEAD_MS],
  );
  const total = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM favorites f JOIN channels c ON c.id = f.channel_id WHERE c.source_id = ?',
    [sourceId],
  );
  lines.push(`Favoritter fra kilden: ${total?.n ?? 0}, uden programmer forude: ${wanted.length}.`);
  // v358: gaar kaldene paa panelets navn, eller via en husket adresse (DNS-noedudgangen)?
  const parts = eligibleParts(creds.baseUrl);
  const pinned = parts === null ? null : pinnedIp(parts.host);
  lines.push(pinned === null ? 'Vejen til panelet: på navnet.' : 'Vejen til panelet: via en husket adresse (DNS-nødudgangen), navnet kunne ikke slås op.');
  // v359: samme adresse og samme login som kanallisten — svarer panelet
  // forskelligt paa de forskellige kald? Adressen vises uden brugernavn og
  // kodeord (de er aldrig en del af basen), saa to bokse kan sammenlignes.
  lines.push(`Adresse: ${describeBase(creds.baseUrl)}`);
  const client = new XtreamClient(creds, fetchImpl);
  try {
    await client.authenticate();
    lines.push('Login (player_api.php): OK.');
  } catch (cause) {
    lines.push(`Login (player_api.php): ${safeText(cause)}`);
  }
  try {
    const categories = await client.getLiveCategories();
    lines.push(`Kanalkategorier fra panelet: ${categories.length}.`);
  } catch (cause) {
    lines.push(`Kanalkategorier fra panelet: ${safeText(cause)}`);
  }
  lines.push(...await describeTimes(db, sourceId, client, now));
  const first = wanted[0];
  if (first !== undefined) {
    lines.push(`Første: "${first.name}" → navn ${normaliseChannelName(first.name) || '(tomt)'}, land ${first.country || '(ukendt)'}, EPG-id ${first.epgId ?? '(intet)'}.`);
    // Panelet per kanal: giver det noget for denne?
    try {
      const streamId = first.key.slice(first.key.indexOf(':') + 1);
      const batch = await new XtreamClient(creds, fetchImpl).getShortEpg(streamId, 3);
      lines.push(`Panelet per kanal (get_short_epg): ${batch.length} programmer for den.`);
    } catch (cause) {
      lines.push(`Panelet per kanal svarede ikke: ${safeText(cause)}`);
    }
  }
  if (native === null || wanted.length === 0) return lines.join('\n');

  const source = streamSource(buildXmltvUrl(creds));
  const url = typeof source === 'string' ? source : source.uri;
  const headers = typeof source === 'string' ? {} : source.headers;
  let path: string | null = null;
  try {
    const started = Date.now();
    path = await native.download(url, JSON.stringify(headers));
    const feed = JSON.parse(await native.channels(path)) as FeedChannel[];
    lines.push(`Filen hentet på ${Math.round((Date.now() - started) / 1000)} s: ${feed.length} kanaler i filen.`);
    const matches = matchPanelEpg(wanted, feed);
    const matchedKeys = new Set([...matches.values()].flat());
    lines.push(`Parret: ${matchedKeys.size} af ${wanted.length} favoritter.`);
    const byName = new Map<string, FeedChannel[]>();
    for (const channel of feed) {
      for (const name of [...channel.n, channel.id.replace(/\.[a-z]{2}$/i, '')]) {
        const key = normaliseChannelName(name);
        if (key.length === 0) continue;
        const list = byName.get(key);
        if (list === undefined) byName.set(key, [channel]);
        else if (!list.includes(channel)) list.push(channel);
      }
    }
    let shown = 0;
    for (const channel of wanted) {
      if (matchedKeys.has(channel.key) || shown >= 6) continue;
      shown += 1;
      const key = normaliseChannelName(channel.name);
      const same = byName.get(key) ?? [];
      if (same.length > 0) {
        lines.push(
          `Ikke parret: "${channel.name}" (land ${channel.country || '?'}) — filen har ${same.length} med samme navn: ${same
            .slice(0, 3)
            .map((c) => `${c.id} [${feedCountry(c) || 'uden land'}]`)
            .join(', ')}.`,
        );
      } else {
        const stem = key.slice(0, 3);
        const near = [...byName.keys()].filter((k) => stem.length > 0 && k.startsWith(stem)).slice(0, 4);
        lines.push(`Ikke parret: "${channel.name}" → ${key || '(tomt)'}; filen har intet med det navn${near.length > 0 ? ` (tættest: ${near.join(', ')})` : ''}.`);
      }
    }
    if (matches.size === 0) return lines.join('\n');
    const found = JSON.parse(
      await native.programmes(path, JSON.stringify([...matches.keys()]), panelEpgFrom(now), nowMs + AFTER_MS),
    ) as FeedProgramme[];
    const programmes: Programme[] = [];
    for (const entry of found) {
      for (const key of matches.get(entry.c) ?? []) {
        programmes.push({ channelId: key, start: new Date(entry.s), stop: new Date(entry.e), title: entry.t, description: entry.d ?? null });
      }
    }
    await upsertProgrammes(db, programmes, { replaceWindow: true });
    lines.push(`Programmer fra filen for de parrede: ${programmes.length} (skrevet ind).`);
    if (programmes.length === 0) lines.push('Filen har kanalerne, men ingen programmer for dem i vinduet (syv dage tilbage–om to dage).');
  } catch (cause) {
    lines.push(`Filen kunne ikke hentes/læses: ${safeText(cause)}`);
  } finally {
    if (path !== null) {
      try {
        native.remove(path);
      } catch {
        // Cachen ryddes ogsaa af systemet.
      }
    }
  }
  return lines.join('\n');
}

/** Minutter som "+1" eller "+2:30". */
function utcText(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const rest = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${rest === 0 ? '' : `:${String(rest).padStart(2, '0')}`}`;
}

function localClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * v423: tiderne side om side, saa en time forkert kan ses med det samme i
 * stedet for at blive gaettet: panelets ur og zone, boksens ur og hvad
 * panelet lige nu siger om den foerste favorits udsendelser (vist i boksens
 * tid). Ingen adresser.
 */
async function describeTimes(db: SqlDatabase, sourceId: string, client: XtreamClient, now: Date): Promise<string[]> {
  const lines: string[] = [];
  const device = deviceUtcOffset(now.getTime());
  try {
    const clock = await client.getPanelClock();
    lines.push(clock === null
      ? `Panelets ur: oplyses ikke. Boksen: ${utcText(device)}.`
      : `Panelets ur: ${utcText(clock.offsetMinutes)}${clock.timeZone === undefined ? ' (zone ikke bekræftet)' : `, zone ${clock.timeZone}`}. Boksen: ${utcText(device)}.`);
  } catch (cause) {
    lines.push(`Panelets ur kunne ikke læses: ${safeText(cause)}`);
  }
  if (nearTimeChange(now.getTime())) {
    lines.push('Uret er skiftet mellem sommer- og vintertid inden for tre døgn: oversigten fornyes hver time, til udbyderen har rettet sin.');
  }
  const favourite = await db.getFirstAsync<{ key: string; name: string }>(
    `SELECT c.id AS key, c.name AS name FROM favorites f JOIN channels c ON c.id = f.channel_id
     WHERE c.source_id = ? ORDER BY f.position IS NULL, f.position LIMIT 1`,
    [sourceId],
  );
  if (favourite === null) return lines;
  try {
    const streamId = favourite.key.slice(favourite.key.indexOf(':') + 1);
    const batch = await client.getShortEpg(streamId, 3);
    lines.push(batch.length === 0
      ? `Tider fra panelet for "${favourite.name}": ingen programmer.`
      : `Tider fra panelet for "${favourite.name}" (boksens tid): ${batch.map((p) => `${localClock(p.start)}–${localClock(p.stop)} ${p.title}`).join('; ')}.`);
  } catch (cause) {
    lines.push(`Tider fra panelet for "${favourite.name}": ${safeText(cause)}`);
  }
  return lines;
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
