import { createXmltvParser, normaliseChannelName } from '@norstream/core';
import type { FetchLike, Programme, Source } from '@norstream/core';
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
}

/**
 * Henter en M3U-kildes programoversigt og skriver den ind.
 *
 * En M3U-liste rummer ingen EPG. Det eneste baand mellem listen og en
 * XMLTV-fil er `tvg-id`, som parseren gemmer som kanalens `epgChannelId`.
 * Programmer for id'er der ikke findes i listen kasseres — en delt XMLTV-fil
 * daekker tit mange flere kanaler end den enkelte liste har.
 */
export async function syncXmltv(
  db: SqlDatabase,
  source: Source,
  fetchImpl: FetchLike,
): Promise<XmltvResult> {
  if (source.xmltvUrl === null || source.xmltvUrl.length === 0) {
    return { programmes: 0, matched: 0 };
  }

  const response = await fetchImpl(source.xmltvUrl);
  if (!response.ok) {
    throw new Error(`Programoversigten svarede HTTP ${response.status}`);
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

  // Ét opslag for hele kilden: en forespoergsel per programme ville vaere
  // titusinder af dem.
  const index = await channelIndex(db, source.id);

  const programmes: Programme[] = [];
  const matched = new Set<string>();
  const parser = createXmltvParser((programme) => {
    const key = lookup(index, programme.channelId);
    if (key === undefined) return;
    matched.add(key);
    programmes.push({ ...programme, channelId: key });
  });
  parser.write(xml);
  parser.end();

  await upsertProgrammes(db, programmes);
  return { programmes: programmes.length, matched: matched.size };
}

interface ChannelIndex {
  /** Kanaler slaaet op paa deres `tvg-id` / `epg_channel_id`. */
  byEpgId: Map<string, string>;
  /** Kanaler slaaet op paa deres normaliserede navn. */
  byName: Map<string, string>;
  /** Navne der gaar igen paa flere kanaler og derfor ikke maa bruges. */
  ambiguous: Set<string>;
}

/**
 * Opslag fra en XMLTV-kanal til appens kanalnoegle.
 *
 * `epg_channel_id` er den rigtige vej, men **87 % af panelets kanaler har
 * ingen**. Derfor er navnet med som anden vej: en XMLTV-fil skriver typisk
 * `channel="DR1.dk"`, og landeendelsen sat til side er det det samme som
 * kanalens navn renset for praefiks og kvalitetsmaerker.
 *
 * Navne der gaar igen paa flere kanaler i samme kilde bruges ikke. Panelet
 * har `DR1 HD` og `DR1 HEVC` som to raekker med samme normaliserede navn, og
 * programmerne ville ellers lande paa en tilfaeldig af dem.
 */
async function channelIndex(db: SqlDatabase, sourceId: string): Promise<ChannelIndex> {
  const rows = await db.getAllAsync<{
    id: string;
    epg_channel_id: string | null;
    match_key: string;
  }>('SELECT id, epg_channel_id, match_key FROM channels WHERE source_id = ?', [sourceId]);

  const byEpgId = new Map<string, string>();
  const byName = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const row of rows) {
    if (row.epg_channel_id !== null && row.epg_channel_id !== '') {
      byEpgId.set(row.epg_channel_id, row.id);
    }
    if (row.match_key === '') continue;
    if (byName.has(row.match_key)) ambiguous.add(row.match_key);
    else byName.set(row.match_key, row.id);
  }

  for (const key of ambiguous) byName.delete(key);
  return { byEpgId, byName, ambiguous };
}

/** XMLTV-kanalen til en kanalnoegle, eller `undefined`. */
function lookup(index: ChannelIndex, xmltvChannel: string): string | undefined {
  const direct = index.byEpgId.get(xmltvChannel);
  if (direct !== undefined) return direct;

  // `DR1.dk` -> `DR1`. Landeendelsen er ikke en del af kanalens navn.
  const withoutSuffix = xmltvChannel.replace(/\.[a-z]{2}$/i, '');
  return index.byName.get(normaliseChannelName(withoutSuffix));
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
