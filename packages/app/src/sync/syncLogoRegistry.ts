import {
  buildNameIndex,
  legacyNamesFor,
  normaliseChannelName,
  parseCsvRecords,
} from '@norstream/core';
import type { FetchLike, RegistryChannel } from '@norstream/core';
import type { SqlDatabase } from '../storage/types.js';
import { parseTvLogoPaths } from './tvLogos.js';

/**
 * Det aabne kanalregister.
 *
 * To filer: kanalerne med navne og land, og logoerne slaaet op paa kanalens
 * id. De hentes fra raw.githubusercontent.com, som er naabar over HTTPS —
 * i modsaetning til den billed-vaert brugerens eget panel oplyser, hvor
 * telefonen svarer `Host unreachable`.
 */
const CHANNELS_URL =
  'https://raw.githubusercontent.com/iptv-org/database/master/data/channels.csv';
const LOGOS_URL = 'https://raw.githubusercontent.com/iptv-org/database/master/data/logos.csv';

/**
 * Bredden vi helst vil have et logo under.
 *
 * En **praeference**, ikke en graense. Den var en graense — logoer bredere end
 * det blev kasseret — og det kostede 2.828 kanaler deres eneste logo, ni
 * procent af alle dem registret har et til. Det ramte blandt andet 6'eren,
 * Canal 9, Kanal 4, Kanal 5, TLC og TV 2 Fri, som alle kun har ét logo, og
 * det er 960 px bredt. Efterproevet ved at taelle i registrets egne filer.
 *
 * Baandbredden var en rigtig bekymring — de bredeste logoer i registret er
 * 16.784 px — men svaret er at vaelge det mindste der findes, ikke at smide
 * kanalen vaek fordi dens eneste logo er stort.
 */
const PREFERRED_WIDTH = 600;

export interface LogoRegistryResult {
  /** Kanaler i registret der havde et brugbart logo. */
  logos: number;
  /** Heraf dem der kom fra det andet arkiv, tv-logos. */
  fromArchive: number;
}

/**
 * Henter registret og gemmer et opslag fra normaliseret kanalnavn til logo.
 *
 * Navnet er noeglen, ikke registrets id: panelets kanaler har ikke registrets
 * id'er, og det eneste der binder de to sammen er navnet — renset for
 * landepraefiks og kvalitetsmaerker. Landet gemmes med, saa en dansk `TV 2`
 * ikke kan faa det norske logo.
 */
export async function syncLogoRegistry(
  db: SqlDatabase,
  fetchImpl: FetchLike,
): Promise<LogoRegistryResult> {
  const [channelsCsv, logosCsv] = await Promise.all([
    fetchText(fetchImpl, CHANNELS_URL),
    fetchText(fetchImpl, LOGOS_URL),
  ]);

  const channels: RegistryChannel[] = [];
  const byId = new Map<string, RegistryChannel>();
  for (const row of parseCsvRecords(channelsCsv)) {
    const id = row.id ?? '';
    const name = row.name ?? '';
    if (id.length === 0 || name.length === 0) continue;
    const channel: RegistryChannel = {
      id,
      name,
      altNames: (row.alt_names ?? '').split(';').map((value) => value.trim()).filter(Boolean),
      country: (row.country ?? '').toUpperCase(),
    };
    channels.push(channel);
    byId.set(id, channel);
  }

  // Bedste logo per kanal: i brug, og det smalleste der findes.
  const best = new Map<string, { url: string; width: number }>();
  for (const row of parseCsvRecords(logosCsv)) {
    const channelId = row.channel ?? '';
    const url = row.url ?? '';
    if (channelId.length === 0 || url.length === 0) continue;
    if ((row.in_use ?? '').toUpperCase() === 'FALSE') continue;

    const parsed = Number.parseInt(row.width ?? '', 10);
    // Ukendt bredde sorteres bagest frem for at blive kasseret: en adresse vi
    // ikke kender stoerrelsen paa, er stadig bedre end ingen adresse.
    const width = Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    const current = best.get(channelId);
    if (current === undefined || betterWidth(width, current.width)) {
      best.set(channelId, { url, width });
    }
  }

  // Navneopslaget bygges af de kanaler der faktisk har et logo.
  const withLogo = channels.filter((channel) => best.has(channel.id));
  const index = buildNameIndex(withLogo);

  const rows: [string, string, string][] = [];
  for (const [key, candidates] of index) {
    const countries = new Set(candidates.map((candidate) => candidate.country));
    for (const candidate of candidates) {
      const chosen = best.get(candidate.id);
      if (chosen === undefined) continue;
      const url = chosen.url;
      // Noeglen er navn + land: to lande maa gerne have hver sin `TV 2`.
      rows.push([`${key}:${candidate.country}`, candidate.country, url]);

      // Og registrets eget id. Det **er** standarden: registrets `id` er
      // XMLTV-id'et — `TV2News.dk`, `Kanal4.dk` — det samme som en M3U-liste
      // skriver i `tvg-id` og et Xtream-panel i `epg_channel_id`. Oplyser
      // kilden det, er der ikke noget at gaette paa; navneopslaget ovenfor er
      // reserven for de kanaler der ikke goer.
      rows.push([idKey(candidate.id), candidate.country, url]);

      // Findes navnet kun i ét land, kan det ogsaa slaas op uden at kende
      // landet — og de fleste af panelets kanaler har intet land vi kan
      // udlede. Gaar navnet igen paa tvaers af lande, laves den noegle ikke,
      // og saa faar kanalen ikke noget logo frem for et forkert et.
      if (countries.size === 1) rows.push([`${key}:*`, candidate.country, url]);

      // Og det navn kanalen hed foer. Panelerne er ikke fulgt med.
      for (const legacy of legacyNamesFor(key)) {
        rows.push([`${legacy}:${candidate.country}`, candidate.country, url]);
        if (countries.size === 1) rows.push([`${legacy}:*`, candidate.country, url]);
      }
    }
  }

  // Én transaktion. Uden den er det over to hundrede saerskilte skrivninger,
  // og SQLite lader ikke laesninger komme forbi en skrivning: kanallisten og
  // programoversigten ville staa i koe bag hver eneste af dem.
  // Andet arkiv, som **udfyldning**. iptv-org har land og XMLTV-id per kanal
  // og bliver ved med at vaere det foerste opslag; tv-logos er en liste af
  // filnavne, men den daekker 5.349 navne og lande iptv-org ikke har.
  // `INSERT OR IGNORE` nedenfor goer resten: en noegle der allerede findes,
  // bliver staaende.
  const archive = parseTvLogoPaths(await loadTvLogoPaths());
  let fromArchive = 0;
  for (const entry of archive) {
    const country = entry.country === '*' ? '' : entry.country;
    rows.push([`${entry.key}:${entry.country}`, country, entry.url]);
    for (const legacy of legacyNamesFor(entry.key)) {
      rows.push([`${legacy}:${entry.country}`, country, entry.url]);
    }
    fromArchive += 1;
  }

  await db.execAsync('BEGIN');
  try {
    await db.runAsync('DELETE FROM registry_logos');
    await insertInBatches(db, rows);
    await db.execAsync('COMMIT');
  } catch (cause) {
    // Uden det her ville en afbrudt skrivning efterlade en aaben transaktion,
    // og saa er **hele** databasen laast til appen bliver lukket ned.
    await db.execAsync('ROLLBACK').catch(() => undefined);
    throw cause;
  }
  return { logos: rows.length, fromArchive };
}

/**
 * Hvor mange raekker der skrives per saetning.
 *
 * SQLite har en graense paa 999 variabler i én saetning, og hver raekke bruger
 * tre. 300 raekker er 900 — under graensen med luft til overs.
 */
const BATCH = 300;

/**
 * Skriver registret i store slurke frem for én raekke ad gangen.
 *
 * Registret er omkring 36.000 raekker. Med ét kald per raekke er det 36.000
 * ture over broen til SQLite, og paa en telefon tager det minutter — minutter
 * hvor synkroniseringen ikke naar frem til kanalerne. Det er ikke en
 * finpudsning: det er forskellen paa en app der henter sine kanaler og en der
 * ser ud til at haenge.
 */
/**
 * Filnavnene fra tv-logos.
 *
 * Hentes foerst her, saa de 302 kB kun bliver laest naar registret faktisk
 * opdateres — én gang om ugen — og ikke ved hver opstart.
 */
async function loadTvLogoPaths(): Promise<string[]> {
  const module: unknown = await import('../../assets/tv-logos.json');
  const value = (module as { default?: unknown }).default ?? module;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function insertInBatches(
  db: SqlDatabase,
  rows: readonly [string, string, string][],
): Promise<void> {
  for (let index = 0; index < rows.length; index += BATCH) {
    const slice = rows.slice(index, index + BATCH);
    const values = slice.map(() => '(?, ?, ?)').join(', ');
    await db.runAsync(
      `INSERT OR IGNORE INTO registry_logos (key, country, url) VALUES ${values}`,
      slice.flat(),
    );
  }
}

/**
 * Noeglen for et XMLTV-id.
 *
 * Smaa bogstaver: paneler og lister skriver det samme id med forskelligt
 * store bogstaver, og et opslag der skelner ville tabe halvdelen.
 */
export function idKey(id: string): string {
  return `id:${id.trim().toLowerCase()}`;
}

function betterWidth(candidate: number, current: number): boolean {
  const candidateOk = candidate <= PREFERRED_WIDTH;
  const currentOk = current <= PREFERRED_WIDTH;
  // Under praeferencen slaar over den. Derudover: det smalleste vinder.
  if (candidateOk !== currentOk) return candidateOk;
  return candidate < current;
}

/**
 * Slaar et logo op for et panelnavn og et land.
 *
 * Uden land gives der op naar navnet gaar igen paa tvaers af lande — et
 * forkert logo paa en kanal der ser rigtig ud, opdager man aldrig.
 */
export async function registryLogoFor(
  db: SqlDatabase,
  name: string,
  country: string | null,
  /** Kildens `epg_channel_id` / `tvg-id`, hvis den oplyser et. */
  epgChannelId: string | null = null,
): Promise<string | null> {
  // Id'et foerst. Det er et opslag og ikke et gaet.
  if (epgChannelId !== null && epgChannelId.trim().length > 0) {
    const byId = await db.getFirstAsync<{ url: string }>(
      'SELECT url FROM registry_logos WHERE key = ?',
      [idKey(epgChannelId)],
    );
    if (byId) return byId.url;
  }

  const key = normaliseChannelName(name);
  if (key.length === 0) return null;

  // Landet foerst, derefter '*'-noeglen, som kun findes for navne der er
  // entydige paa tvaers af lande. Samme to opslag som SQL-sammenkoblingen i
  // `listChannels` — de to maa ikke kunne give hvert sit svar.
  if (country !== null) {
    const row = await db.getFirstAsync<{ url: string }>(
      'SELECT url FROM registry_logos WHERE key = ?',
      [`${key}:${country.toUpperCase()}`],
    );
    if (row) return row.url;
  }

  const anyCountry = await db.getFirstAsync<{ url: string }>(
    'SELECT url FROM registry_logos WHERE key = ?',
    [`${key}:*`],
  );
  return anyCountry?.url ?? null;
}

async function fetchText(fetchImpl: FetchLike, url: string): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Registret svarede HTTP ${response.status}`);
  const text = (response as { text?: unknown }).text;
  if (typeof text !== 'function') throw new Error('Registret kunne ikke laeses');
  const value: unknown = await (text as () => unknown).call(response);
  if (typeof value !== 'string') throw new Error('Registret kunne ikke laeses');
  return value;
}
