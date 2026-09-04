import type { Programme } from '@uhf-play/core';
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

export async function upsertProgrammes(
  db: SqlDatabase,
  programmes: Programme[],
): Promise<void> {
  for (const p of programmes) {
    await db.runAsync(
      `INSERT INTO programmes (channel_id, start_ms, stop_ms, title, description)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(channel_id, start_ms) DO UPDATE SET
         stop_ms     = excluded.stop_ms,
         title       = excluded.title,
         description = excluded.description`,
      [p.channelId, p.start.getTime(), p.stop.getTime(), p.title, p.description],
    );
  }
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
