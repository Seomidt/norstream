import type { Programme } from '@norstream/core';
import { withTransaction } from './transaction.js';
import type { SqlDatabase } from './types.js';

interface ProgrammeRow {
  channel_id: string;
  start_ms: number;
  stop_ms: number;
  title: string;
  description: string | null;
}

function toProgramme(row: ProgrammeRow): Programme {
  return {
    channelId: row.channel_id,
    title: row.title,
    description: row.description,
    start: new Date(row.start_ms),
    stop: new Date(row.stop_ms),
  };
}

/**
 * Fem kolonner pr. raekke; hold antal variabler under SQLites loft (999).
 * 180 * 5 = 900.
 */
const UPSERT_CHUNK = 180;

/**
 * Raekker per transaktion. En stor EPG-hentning skriver titusinder af raekker,
 * og SQLite lader **ingen laesning** komme forbi en aaben skrivning: laa det i
 * én transaktion, stod menuer, guide og lister og ventede paa den ("appen
 * foeles tung"). Ved at commite i klumper og give traaden luft imellem kan
 * laesningerne smutte ind mellem transaktionerne.
 */
const TX_ROWS = 1800;

export interface UpsertOptions {
  /**
   * Erstat det tidsrum batchen daekker per kanal (v360): foer batchen skrives,
   * slettes kanalens programmer der overlapper fra batchens foerste start til
   * dens sidste slut. Uden det blev et program der FLYTTEDE sig (ny starttid)
   * liggende ved siden af det nye, for noeglen er (kanal, starttid) — og saa
   * fandt Sport "haandbold 20:00" fra gaarsdagens oversigt, mens kanalen i
   * virkeligheden sendte basketball 19:30. Alt uden for batchens tidsrum roeres
   * ikke, saa fortiden (arkivet) bliver staaende.
   */
  replaceWindow?: boolean;
  /** Komplet, frisk kanaloversigt: erstat ogsaa et tomt svar atomisk. */
  replaceChannelIds?: readonly string[];
}

// Uafhaengige EPG-hentninger maa ikke flette deres slet/indsaet-trin.
// Koen er per database og bruges kun af EPG-skrivere.
const programmeWrites = new WeakMap<SqlDatabase, Promise<void>>();

export function upsertProgrammes(
  db: SqlDatabase,
  programmes: Programme[],
  options: UpsertOptions = {},
): Promise<void> {
  if (programmes.length === 0 && (options.replaceChannelIds?.length ?? 0) === 0) return Promise.resolve();
  const previous = programmeWrites.get(db) ?? Promise.resolve();
  const work = previous.then(() => writeProgrammes(db, programmes, options));
  // En mislykket skrivning maa ikke blokere det naeste friske svar.
  const tail = work.catch(() => undefined);
  programmeWrites.set(db, tail);
  void tail.then(() => { if (programmeWrites.get(db) === tail) programmeWrites.delete(db); });
  return work;
}

async function writeProgrammes(
  db: SqlDatabase,
  programmes: Programme[],
  options: UpsertOptions = {},
): Promise<void> {
  if (programmes.length === 0 && (options.replaceChannelIds?.length ?? 0) === 0) return;

  // Afdupliker paa (channel_id, start_ms) FOER batchen: en fler-raekkers INSERT
  // med to ens noegler i samme saetning afvises af SQLite ("ON CONFLICT does not
  // support duplicate rows"). Den sidste vinder — praecis som en raekke-for-
  // raekke upsert ville ende.
  const byKey = new Map<string, Programme>();
  for (const p of programmes) byKey.set(`${p.channelId}\u0000${p.start.getTime()}`, p);
  const rows = [...byKey.values()];

  const channels = new Map<string, Programme[]>();
  for (const row of rows) {
    const channelRows = channels.get(row.channelId);
    if (channelRows === undefined) channels.set(row.channelId, [row]);
    else channelRows.push(row);
  }

  const replaceChannels = new Set(options.replaceChannelIds ?? []);
  for (const channelId of replaceChannels) {
    if (!channels.has(channelId)) channels.set(channelId, []);
  }

  // Giv traaden luft mellem kanaler, men udskift hele kanalens vindue i
  // samme transaktion. En enkelt stor kanal maa derfor overskride TX_ROWS.
  let pendingChannels: Array<[string, Programme[]]> = [];
  let pendingCount = 0;
  const writeChunk = async (): Promise<void> => {
    await withTransaction(db, async () => {
      const chunkRows: Programme[] = [];
      for (const [channelId, channelRows] of pendingChannels) {
        if (replaceChannels.has(channelId)) {
          // En fuld HTTP-succes med nul programmer skal ogsaa kunne rydde
          // den gamle oversigt. Fejlede HTTP-kald kommer aldrig herind.
          await db.runAsync('DELETE FROM programmes WHERE channel_id = ?', [channelId]);
        } else if (options.replaceWindow === true && channelRows.length > 0) {
          let from = Number.POSITIVE_INFINITY;
          let to = Number.NEGATIVE_INFINITY;
          for (const row of channelRows) {
            from = Math.min(from, row.start.getTime());
            to = Math.max(to, row.stop.getTime());
          }
          await db.runAsync('DELETE FROM programmes WHERE channel_id = ? AND stop_ms > ? AND start_ms < ?', [channelId, from, to]);
        }
        for (const row of channelRows) chunkRows.push(row);
      }
      for (let i = 0; i < chunkRows.length; i += UPSERT_CHUNK) {
        const slice = chunkRows.slice(i, i + UPSERT_CHUNK);
        const placeholders = slice.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const args: (string | number | null)[] = [];
        for (const row of slice) args.push(row.channelId, row.start.getTime(), row.stop.getTime(), row.title, row.description);
        await db.runAsync(
          `INSERT INTO programmes (channel_id, start_ms, stop_ms, title, description)
           VALUES ${placeholders}
           ON CONFLICT(channel_id, start_ms) DO UPDATE SET
             stop_ms = excluded.stop_ms, title = excluded.title, description = excluded.description`,
          args,
        );
      }
    });
    pendingChannels = [];
    pendingCount = 0;
  };
  for (const entry of channels) {
    if (pendingChannels.length > 0 && pendingCount + entry[1].length > TX_ROWS) {
      await writeChunk();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    pendingChannels.push(entry);
    pendingCount += entry[1].length;
  }
  if (pendingChannels.length > 0) await writeChunk();
}

/**
 * Titlen paa det program der sendes NU for hver af kanalerne, i ét opslag.
 *
 * Kanallisten og forsiden skal vise "nu"-titlen for en hel skaermfuld ad
 * gangen. Et `getNowNext` per kanal var titusinder af rows delt op i to
 * forespoergsler hver — serielt, ved hvert scroll-stop. Her er det én
 * forespoergsel per klump kanaler. Ved overlap vinder den der begyndte senest,
 * samme valg som `getNowNext` (ORDER BY start_ms DESC LIMIT 1).
 */
export async function nowTitlesFor(
  db: SqlDatabase,
  channelIds: readonly string[],
  now: Date,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  if (channelIds.length === 0) return titles;
  const ms = now.getTime();
  // SQLites variabel-loft (999): del kanalerne i klumper, saa selv en meget
  // lang liste slaas op i faa forespoergsler.
  const CHUNK = 400;
  const chosenStart = new Map<string, number>();
  for (let i = 0; i < channelIds.length; i += CHUNK) {
    const slice = channelIds.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '?').join(', ');
    const rows = await db.getAllAsync<{ channel_id: string; title: string; start_ms: number }>(
      `SELECT channel_id, title, start_ms FROM programmes
       WHERE channel_id IN (${placeholders}) AND start_ms <= ? AND stop_ms > ?`,
      [...slice, ms, ms],
    );
    for (const row of rows) {
      const prior = chosenStart.get(row.channel_id);
      if (prior === undefined || row.start_ms > prior) {
        chosenStart.set(row.channel_id, row.start_ms);
        titles.set(row.channel_id, row.title);
      }
    }
  }
  return titles;
}

/**
 * Programmer der overlapper vinduet, ikke kun dem der ligger helt inde i det:
 * guiden skal vise en udsendelse der allerede er begyndt.
 */
export async function listProgrammes(
  db: SqlDatabase,
  epgChannelId: string,
  from: Date,
  to: Date,
): Promise<Programme[]> {
  const rows = await db.getAllAsync<ProgrammeRow>(
    `SELECT * FROM programmes
     WHERE channel_id = ? AND stop_ms > ? AND start_ms < ?
     ORDER BY start_ms`,
    [epgChannelId, from.getTime(), to.getTime()],
  );
  return rows.map(toProgramme);
}

/**
 * Det igangvaerende program og det foelgende. `now.start` er hvad
 * start-forfra bygger sin timeshift-URL ud fra.
 *
 * Hvis der ikke sendes noget i ojeblikkket, finder vi stadig det foelgende program
 * (f.eks. naar EPG-vinduet er aabent men der er en pause mellem to udsendelser).
 */
export async function getNowNext(
  db: SqlDatabase,
  epgChannelId: string,
  now: Date,
): Promise<{ now: Programme | null; next: Programme | null }> {
  const ms = now.getTime();

  const current = await db.getFirstAsync<ProgrammeRow>(
    `SELECT * FROM programmes
     WHERE channel_id = ? AND start_ms <= ? AND stop_ms > ?
     ORDER BY start_ms DESC LIMIT 1`,
    [epgChannelId, ms, ms],
  );

  if (current) {
    // Der sendes noget nu: naeste program er det foerste der starter ved eller efter sluttidspunktet
    const following = await db.getFirstAsync<ProgrammeRow>(
      `SELECT * FROM programmes
       WHERE channel_id = ? AND start_ms >= ?
       ORDER BY start_ms LIMIT 1`,
      [epgChannelId, current.stop_ms],
    );

    return {
      now: toProgramme(current),
      next: following ? toProgramme(following) : null,
    };
  }

  // Intet program nu: find det foerste program der starter i fremtiden
  const following = await db.getFirstAsync<ProgrammeRow>(
    `SELECT * FROM programmes
     WHERE channel_id = ? AND start_ms > ?
     ORDER BY start_ms LIMIT 1`,
    [epgChannelId, ms],
  );

  return {
    now: null,
    next: following ? toProgramme(following) : null,
  };
}

/**
 * Programmerne for mange kanaler i ét vindue, i ét opslag per klump
 * (v340: "I aften" paa forsiden og kanallisten oven paa afspilleren).
 * Overlappende, som `listProgrammes`; sorteret paa starttid.
 */
export async function listProgrammesFor(
  db: SqlDatabase,
  channelIds: readonly string[],
  from: Date,
  to: Date,
): Promise<Programme[]> {
  const out: Programme[] = [];
  if (channelIds.length === 0) return out;
  const CHUNK = 400;
  const unique = [...new Set(channelIds)];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '?').join(', ');
    const rows = await db.getAllAsync<ProgrammeRow>(
      `SELECT channel_id, start_ms, stop_ms, title, description FROM programmes
       WHERE channel_id IN (${placeholders}) AND stop_ms > ? AND start_ms < ?
       ORDER BY start_ms`,
      [...slice, from.getTime(), to.getTime()],
    );
    for (const row of rows) out.push(toProgramme(row));
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Hele det aktuelle program til forsidens kort, uden opslag paa "naeste". */
export async function nowProgrammesFor(
  db: SqlDatabase,
  channelIds: readonly string[],
  now: Date,
): Promise<Map<string, Programme>> {
  const result = new Map<string, Programme>();
  const ids = [...new Set(channelIds)];
  const ms = now.getTime();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const rows = await db.getAllAsync<ProgrammeRow>(
      `SELECT * FROM programmes WHERE channel_id IN (${chunk.map(() => '?').join(', ')})
       AND start_ms <= ? AND stop_ms > ?`,
      [...chunk, ms, ms],
    );
    for (const row of rows) {
      const prior = result.get(row.channel_id);
      if (prior === undefined || row.start_ms > prior.start.getTime()) {
        result.set(row.channel_id, toProgramme(row));
      }
    }
  }
  return result;
}

export interface NowNextPair {
  now: Programme | null;
  next: Programme | null;
}

/**
 * "Nu og naeste" for mange kanaler paa én gang — til kanallisten oven paa
 * afspilleren (v340), hvor et `getNowNext` per raekke ville vaere to
 * forespoergsler per kanal. Samme valg som `getNowNext`: ved overlap vinder
 * det program der begyndte senest; "naeste" er det foerste efter det.
 */
export async function nowNextFor(
  db: SqlDatabase,
  channelIds: readonly string[],
  now: Date,
): Promise<Map<string, NowNextPair>> {
  const result = new Map<string, NowNextPair>();
  if (channelIds.length === 0) return result;
  const ms = now.getTime();
  // Seks timer frem er nok til "naeste" paa enhver kanal med programdata.
  const programmes = await listProgrammesFor(db, channelIds, now, new Date(ms + 6 * 3_600_000));
  const byChannel = new Map<string, Programme[]>();
  for (const programme of programmes) {
    const list = byChannel.get(programme.channelId);
    if (list === undefined) byChannel.set(programme.channelId, [programme]);
    else list.push(programme);
  }
  for (const [channelId, list] of byChannel) {
    let current: Programme | null = null;
    for (const programme of list) {
      if (programme.start.getTime() <= ms && programme.stop.getTime() > ms) current = programme;
    }
    const after = current === null ? ms : current.stop.getTime() - 1;
    const next = list.find((programme) => programme !== current && programme.start.getTime() > after) ?? null;
    result.set(channelId, { now: current, next });
  }
  return result;
}

/** Holder databasen fra at vokse ubegraenset efterhaanden som EPG fornys. */
export async function deleteProgrammesBefore(
  db: SqlDatabase,
  cutoff: Date,
): Promise<void> {
  await db.runAsync('DELETE FROM programmes WHERE stop_ms <= ?', [cutoff.getTime()]);
}
