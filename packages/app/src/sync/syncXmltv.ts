import { createXmltvParser, normaliseChannelName } from '@norstream/core';
import type { FetchLike, Programme, Source, XmltvParser } from '@norstream/core';
import { gunzipSync, strFromU8 } from 'fflate';
import { upsertProgrammes } from '../storage/programmes.js';
import type { SqlDatabase } from '../storage/types.js';

/**
 * Hvor stor en programoversigt vi overhovedet forsoeger at laese.
 *
 * Brugerens eget panel leverer en XMLTV-fil paa 98 MB. Den naaede aldrig frem
 * inden for en rimelig timeout, og det var grunden til at hele EPG-vejen blev
 * lagt om til `get_short_epg`. React Natives fetch giver ingen stroem at laese
 * i bidder — kun en faerdig streng — saa en fil i den stoerrelse ville blive
 * bygget i hukommelsen paa telefonen foer den overhovedet kunne parses.
 *
 * Fyrre megabyte er rigeligt til en liste med et par hundrede kanaler, og
 * graensen giver en besked man kan handle paa i stedet for en app der doer.
 */
const MAX_BYTES = 40 * 1_000_000;

export interface XmltvResult {
  /** Programmer skrevet til databasen. */
  programmes: number;
  /** Kanaler i listen som oversigten havde programmer for. */
  matched: number;
  /** Kanaler der fik et logo fra filen. */
  logos: number;
}

/**
 * Henter en kildes programoversigt(er) og skriver dem ind.
 *
 * En M3U-liste rummer ingen EPG, og et panel har tit huller; en XMLTV-fil
 * fylder dem. Baandet mellem kanal og fil er `tvg-id` (kanalens `epgChannelId`)
 * — og ellers **navnet** (se channelIndex). Programmer for id'er/navne der ikke
 * findes i kilden kasseres; en delt XMLTV-fil daekker tit mange flere kanaler.
 *
 * Feltet kan rumme **flere adresser** (adskilt med mellemrum, komma eller
 * linjeskift), saa man kan lgge fx DK + UK + US oveni hinanden. Hver adresse
 * maa gerne vaere gzippet (`.xml.gz`); den pakkes ud i appen. Fejler én adresse
 * (nede, for stor), springes den bare over, og de oevrige koerer videre.
 */
export async function syncXmltv(
  db: SqlDatabase,
  source: Source,
  fetchImpl: FetchLike,
): Promise<XmltvResult> {
  const urls = splitUrls(source.xmltvUrl);
  if (urls.length === 0) {
    return { programmes: 0, matched: 0, logos: 0 };
  }

  // Ét opslag for hele kilden: en forespoergsel per programme ville vaere
  // titusinder af dem. Deles af alle adresserne.
  const index = await channelIndex(db, source.id);

  const programmes: Programme[] = [];
  const matched = new Set<string>();
  const logos = new Map<string, string>();
  // Feed-kanalens id -> appens kanaler, udledt af dens <display-name>. Bruges
  // som **anden vej** til at matche programmer: har en feed-kanal et ukendt id
  // (`I2.dr1.dk`) men et genkendeligt navn (`DR1`), rammer programmerne
  // alligevel. `<channel>` staar foer `<programme>` i en XMLTV-fil, saa kortet
  // er fyldt naar programmerne kommer.
  const feedIdToKeys = new Map<string, string[]>();

  // Med flere adresser maa én daarlig ikke tage de andre med sig; men fejler
  // ALLE (fx den ene adresse man har skrevet er nede eller for stor), kastes
  // fejlen videre, saa kaldet ved at intet lykkedes.
  let anySucceeded = false;
  let lastError: unknown = null;

  for (const url of urls) {
    let xml: string;
    try {
      xml = await fetchXmltv(fetchImpl, url);
      anySucceeded = true;
    } catch (cause) {
      lastError = cause;
      continue;
    }
    const parser = createXmltvParser(
      (programme) => {
        // Programmet haenges paa ALLE kanaler med det navn — panelet har
        // `DR1 HD`, `DR1 HEVC`, `DR1 FHD` som hver sin raekke, og de skal alle
        // have EPG'en. Rammer id'et ikke, proeves feed-kanalens navne.
        let keys = keysFor(index, programme.channelId);
        if (keys.length === 0) keys = feedIdToKeys.get(programme.channelId) ?? [];
        for (const key of keys) {
          matched.add(key);
          programmes.push({ ...programme, channelId: key });
        }
      },
      (channel) => {
        // Kort feed-kanalens navne til appens kanaler, saa programmer med et
        // ukendt id stadig kan rammes paa navnet.
        const keys = new Set<string>();
        for (const name of channel.displayNames) {
          for (const key of index.byName.get(normaliseChannelName(name)) ?? []) keys.add(key);
        }
        if (keys.size > 0) feedIdToKeys.set(channel.id, [...keys]);

        // Logoerne staar i <channel><icon>. Til et logo kraeves et ENTYDIGT
        // navn: et forkert logo paa en kanal der ser rigtig ud er vaerre end
        // intet. (EPG er anderledes — den maa gerne paa alle varianter.)
        if (channel.iconUrl === null) return;
        let logoKey = logoLookup(index, channel.id);
        for (const name of channel.displayNames) {
          if (logoKey !== undefined) break;
          logoKey = lookupName(index, name);
        }
        if (logoKey !== undefined && !logos.has(logoKey)) logos.set(logoKey, channel.iconUrl);
      },
    );
    await writeChunked(parser, xml);
  }

  if (!anySucceeded && lastError !== null) throw lastError;

  await upsertProgrammes(db, programmes);
  await replaceXmltvLogos(db, source.id, logos);
  return { programmes: programmes.length, matched: matched.size, logos: logos.size };
}

/**
 * Bidstoerrelse naar filen fodres til parseren. Stor nok til at yields ikke
 * koster maerkbart, lille nok til at hovedtraaden aander mellem dem.
 */
const PARSE_CHUNK = 256 * 1024;

/**
 * Fodrer XMLTV-teksten til parseren i bidder og giver hovedtraaden luft mellem
 * hver.
 *
 * Det er hele grunden til at det her findes: en samlet fil paa titusinder af
 * kanaler er ~30 MB tekst, og `parser.write` paa det hele paa én gang loeber
 * synkront igennem alt sammen — paa en tv-boks er det sekunder hvor intet kan
 * klikkes, altsaa en frossen app. Delt op i bidder med et `setTimeout(0)`
 * imellem naar UI'en at tegne og reagere undervejs. Parseren beholder selv en
 * hale mellem bidder, saa et element delt over to bidder ikke tabes.
 */
async function writeChunked(parser: XmltvParser, xml: string): Promise<void> {
  for (let i = 0; i < xml.length; i += PARSE_CHUNK) {
    parser.write(xml.slice(i, i + PARSE_CHUNK));
    await yieldToUi();
  }
  parser.end();
}

/** Slipper hovedtraaden fri én runde, saa tegning og tryk kan komme til. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Én eller flere adresser i feltet, adskilt med mellemrum, komma eller linjeskift. */
function splitUrls(field: string | null): string[] {
  if (field === null) return [];
  return field
    .split(/[\s,]+/)
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

/**
 * Henter én XMLTV-adresse som tekst — pakker den ud, hvis den er gzippet.
 *
 * Gzippet genkendes paa endelsen `.gz` eller paa filens to foerste bytes
 * (0x1f 0x8b), saa en server der ikke saetter den rigtige content-type ogsaa
 * fanges. Baade den pakkede og den upakkede stoerrelse holdes under et loft, saa
 * en kmpefil ikke sprnger hukommelsen paa en tv-boks.
 */
async function fetchXmltv(fetchImpl: FetchLike, url: string): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Programoversigten svarede HTTP ${response.status}`);
  }

  const looksGzipped = /\.gz($|\?)/i.test(url) || /gzip/i.test(contentType(response) ?? '');
  if (looksGzipped && typeof response.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > COMPRESSED_MAX_BYTES) {
      throw new Error('Den pakkede programoversigt er for stor.');
    }
    const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const out = isGzip ? gunzipSync(bytes) : bytes;
    if (out.length > MAX_BYTES) {
      throw new Error('Programoversigten er for stor, når den pakkes ud.');
    }
    return strFromU8(out);
  }

  const declared = contentLength(response);
  if (declared !== null && declared > MAX_BYTES) {
    throw new Error(
      `Programoversigten fylder ${Math.round(declared / 1_000_000)} MB. ` +
        'Det er for meget til at hente på en telefon.',
    );
  }
  const xml = await readText(response);
  if (xml.length > MAX_BYTES) {
    throw new Error('Programoversigten er for stor til at hente på en telefon.');
  }
  return xml;
}

/** Loft paa den pakkede fil, saa vi ikke henter gigabyte foer vi opdager stoerrelsen. */
const COMPRESSED_MAX_BYTES = 25 * 1_000_000;

/**
 * Skriver filens logoer ind for kilden. De gamle for samme kilde ryddes
 * foerst, saa en kanal der er roeget ud af filen ikke beholder et logo fra
 * den.
 */
async function replaceXmltvLogos(
  db: SqlDatabase,
  sourceId: string,
  logos: ReadonlyMap<string, string>,
): Promise<void> {
  await db.runAsync("DELETE FROM xmltv_logos WHERE channel_key LIKE ? ESCAPE '\\'", [
    `${sourceId}:%`,
  ]);
  for (const [key, url] of logos) {
    await db.runAsync('INSERT OR REPLACE INTO xmltv_logos (channel_key, url) VALUES (?, ?)', [
      key,
      url,
    ]);
  }
}

interface ChannelIndex {
  /** Kanaler slaaet op paa deres `tvg-id` / `epg_channel_id`. */
  byEpgId: Map<string, string>;
  /**
   * Navn -> ALLE kanaler med det navn. Panelet har `DR1 HD`, `DR1 HEVC`,
   * `DR1 FHD` — samme kanal i tre kvaliteter, samme normaliserede navn. Til
   * **programmer** skal de alle rammes; derfor en liste, ikke ét id (og ingen
   * "flertydig, derfor droppet" — det var netop det, der efterlod stort set
   * hele panelet uden EPG fra filerne).
   */
  byName: Map<string, string[]>;
}

/**
 * Opslag fra en XMLTV-kanal til appens kanalnoegler.
 *
 * `epg_channel_id` er den rigtige vej, men de fleste af panelets kanaler har
 * ingen. Derfor er navnet med som anden vej: en XMLTV-fil skriver typisk
 * `channel="DR1.dk"`, og landeendelsen sat til side er det samme som kanalens
 * navn renset for praefiks og kvalitetsmaerker (`DNK| DR1 HD` -> `DR1`).
 */
async function channelIndex(db: SqlDatabase, sourceId: string): Promise<ChannelIndex> {
  const rows = await db.getAllAsync<{
    id: string;
    epg_channel_id: string | null;
    match_key: string;
  }>('SELECT id, epg_channel_id, match_key FROM channels WHERE source_id = ?', [sourceId]);

  const byEpgId = new Map<string, string>();
  const byName = new Map<string, string[]>();

  for (const row of rows) {
    if (row.epg_channel_id !== null && row.epg_channel_id !== '') {
      byEpgId.set(row.epg_channel_id, row.id);
    }
    if (row.match_key === '') continue;
    const list = byName.get(row.match_key);
    if (list === undefined) byName.set(row.match_key, [row.id]);
    else list.push(row.id);
  }

  return { byEpgId, byName };
}

/**
 * Alle appens kanaler en XMLTV-kanal peger paa. Id'et foerst (entydigt), ellers
 * navnet — som kan ramme flere kvalitets-varianter, og det skal det.
 */
function keysFor(index: ChannelIndex, xmltvChannel: string): string[] {
  const direct = index.byEpgId.get(xmltvChannel);
  if (direct !== undefined) return [direct];

  // `DR1.dk` -> `DR1`. Landeendelsen er ikke en del af kanalens navn.
  const withoutSuffix = xmltvChannel.replace(/\.[a-z]{2}$/i, '');
  return index.byName.get(normaliseChannelName(withoutSuffix)) ?? [];
}

/**
 * Kanalen bag filens id til et **logo** — kun naar navnet er entydigt.
 * Et forkert logo maa ikke lande paa en kanal der ser rigtig ud.
 */
function logoLookup(index: ChannelIndex, xmltvChannel: string): string | undefined {
  const direct = index.byEpgId.get(xmltvChannel);
  if (direct !== undefined) return direct;
  const withoutSuffix = xmltvChannel.replace(/\.[a-z]{2}$/i, '');
  const list = index.byName.get(normaliseChannelName(withoutSuffix));
  return list !== undefined && list.length === 1 ? list[0] : undefined;
}

/**
 * Kanalen bag et af filens visningsnavne — `<display-name>DR1</display-name>`
 * — til et logo. Kun navne der peger paa praecis én kanal i kilden, saa et
 * logo ikke lander paa en tilfaeldig af flere varianter.
 */
function lookupName(index: ChannelIndex, displayName: string): string | undefined {
  const key = normaliseChannelName(displayName);
  if (key.length === 0) return undefined;
  const list = index.byName.get(key);
  return list !== undefined && list.length === 1 ? list[0] : undefined;
}

function contentType(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null;
  const headers = (response as { headers?: unknown }).headers;
  if (typeof headers !== 'object' || headers === null) return null;
  const get = (headers as { get?: unknown }).get;
  if (typeof get !== 'function') return null;
  try {
    const value = (get as (key: string) => unknown).call(headers, 'content-type');
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function contentLength(response: unknown): number | null {
  if (typeof response !== 'object' || response === null) return null;
  const headers = (response as { headers?: unknown }).headers;
  if (typeof headers !== 'object' || headers === null) return null;
  const get = (headers as { get?: unknown }).get;
  if (typeof get !== 'function') return null;
  try {
    const value = (get as (key: string) => unknown).call(headers, 'content-length');
    const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readText(response: unknown): Promise<string> {
  if (typeof response === 'object' && response !== null) {
    const text = (response as { text?: unknown }).text;
    if (typeof text === 'function') {
      const value: unknown = await (text as () => unknown).call(response);
      if (typeof value === 'string') return value;
    }
  }
  throw new Error('Programoversigten kunne ikke laeses som tekst');
}
