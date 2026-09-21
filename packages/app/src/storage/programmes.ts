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

export async function upsertProgrammes(
  db: SqlDatabase,
  programmes: Programme[],
): Promise<void> {
  if (programmes.length === 0) return;

  // Afdupliker paa (channel_id, start_ms) FOER batchen: en fler-raekkers INSERT
  // med to ens noegler i samme saetning afvises af SQLite ("ON CONFLICT does not
  // support duplicate rows"). Den sidste vinder — praecis som en raekke-for-
  // raekke upsert ville ende.
  const byKey = new Map<string, Programme>();
  for (const p of programmes) byKey.set(`${p.channelId}\u0000${p.start.getTime()}`, p);
  const rows = [...byKey.values()];

  // Flere smaa transaktioner frem for én stor (se TX_ROWS). Inden i hver:
  // faa fler-raekkers INSERTs frem for én runAsync per program. En lille
  // hentning (nu-og-naeste, ~12 raekker) er stadig én transaktion.
  for (let start = 0; start < rows.length; start += TX_ROWS) {
    const txRows = rows.slice(start, start + TX_ROWS);
    await withTransaction(db, async () => {
      for (let i = 0; i < txRows.length; i += UPSERT_CHUNK) {
        const slice = txRows.slice(i, i + UPSERT_CHUNK);
        const placeholders = slice.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const args: (string | number | null)[] = [];
        for (const p of slice) {
          args.push(p.channelId, p.start.getTime(), p.stop.getTime(), p.title, p.description);
        }
        await db.runAsync(
          `INSERT INTO programmes (channel_id, start_ms, stop_ms, title, description)
           VALUES ${placeholders}
           ON CONFLICT(channel_id, start_ms) DO UPDATE SET
             stop_ms     = excluded.stop_ms,
             title       = excluded.title,
             description = excluded.description`,
          args,
        );
      }
    });
    // Luft mellem transaktionerne, saa laesninger kan komme til.
    if (start + TX_ROWS < rows.length) await new Promise((resolve) => setTimeout(resolve, 0));
  }
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

/** Holder databasen fra at vokse ubegraenset efterhaanden som EPG fornys. */
export async function deleteProgrammesBefore(
  db: SqlDatabase,
  cutoff: Date,
): Promise<void> {
  await db.runAsync('DELETE FROM programmes WHERE stop_ms <= ?', [cutoff.getTime()]);
}
