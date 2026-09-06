import { buildNameIndex, normaliseChannelName, parseCsvRecords } from '@norstream/core';
import type { FetchLike, RegistryChannel } from '@norstream/core';
import type { SqlDatabase } from '../storage/types.js';

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
 * Stoerste logo vi gider gemme adressen paa.
 *
 * Registret har flere stoerrelser af samme logo. Et paa 2000 px bruges til en
 * firkant paa 44 — det er spildt baandbredde hver gang en liste ruller forbi.
 */
const MAX_WIDTH = 600;

export interface LogoRegistryResult {
  /** Kanaler i registret der havde et brugbart logo. */
  logos: number;
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

  // Bedste logo per kanal: i brug, og ikke stoerre end noedvendigt.
  const best = new Map<string, string>();
  for (const row of parseCsvRecords(logosCsv)) {
    const channelId = row.channel ?? '';
    const url = row.url ?? '';
    if (channelId.length === 0 || url.length === 0) continue;
    if ((row.in_use ?? '').toUpperCase() === 'FALSE') continue;
    const width = Number.parseInt(row.width ?? '', 10);
    if (Number.isFinite(width) && width > MAX_WIDTH) continue;
    if (!best.has(channelId)) best.set(channelId, url);
  }

  // Navneopslaget bygges af de kanaler der faktisk har et logo.
  const withLogo = channels.filter((channel) => best.has(channel.id));
  const index = buildNameIndex(withLogo);

  const rows: [string, string, string][] = [];
  for (const [key, candidates] of index) {
    const countries = new Set(candidates.map((candidate) => candidate.country));
    for (const candidate of candidates) {
      const url = best.get(candidate.id);
      if (url === undefined) continue;
      // Noeglen er navn + land: to lande maa gerne have hver sin `TV 2`.
      rows.push([`${key}:${candidate.country}`, candidate.country, url]);

      // Findes navnet kun i ét land, kan det ogsaa slaas op uden at kende
      // landet — og de fleste af panelets kanaler har intet land vi kan
      // udlede. Gaar navnet igen paa tvaers af lande, laves den noegle ikke,
      // og saa faar kanalen ikke noget logo frem for et forkert et.
      if (countries.size === 1) rows.push([`${key}:*`, candidate.country, url]);
    }
  }

  // Én transaktion. Uden den er det over to hundrede saerskilte skrivninger,
  // og SQLite lader ikke laesninger komme forbi en skrivning: kanallisten og
  // programoversigten ville staa i koe bag hver eneste af dem.
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
  return { logos: rows.length };
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
 * Slaar et logo op for et panelnavn og et land.
 *
 * Uden land gives der op naar navnet gaar igen paa tvaers af lande — et
 * forkert logo paa en kanal der ser rigtig ud, opdager man aldrig.
 */
export async function registryLogoFor(
  db: SqlDatabase,
  name: string,
  country: string | null,
): Promise<string | null> {
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
