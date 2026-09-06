import { createXmltvParser } from '@norstream/core';
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

  // Kanalens noegle slaas op paa tvg-id. Ét opslag for hele kilden: en
  // forespoergsel per programme ville vaere titusinder af dem.
  const byEpgId = await epgIdIndex(db, source.id);

  const programmes: Programme[] = [];
  const matched = new Set<string>();
  const parser = createXmltvParser((programme) => {
    const key = byEpgId.get(programme.channelId);
    if (key === undefined) return;
    matched.add(key);
    programmes.push({ ...programme, channelId: key });
  });
  parser.write(xml);
  parser.end();

  await upsertProgrammes(db, programmes);
  return { programmes: programmes.length, matched: matched.size };
}

async function epgIdIndex(db: SqlDatabase, sourceId: string): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ id: string; epg_channel_id: string }>(
    `SELECT id, epg_channel_id FROM channels
     WHERE source_id = ? AND epg_channel_id IS NOT NULL AND epg_channel_id <> ''`,
    [sourceId],
  );
  const index = new Map<string, string>();
  for (const row of rows) index.set(row.epg_channel_id, row.id);
  return index;
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
