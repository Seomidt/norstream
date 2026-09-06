import type { Programme } from '@norstream/core';
import type { RecordingState } from '../features/recordings/plan.js';
import type { SqlDatabase } from './types.js';

export interface Recording {
  id: string;
  channelId: string;
  channelName: string;
  title: string;
  description: string | null;
  start: Date;
  stop: Date;
  archiveDays: number;
  state: RecordingState;
  /** Filen paa enheden, naar den er hentet. */
  fileUri: string | null;
  bytes: number;
  /** Dansk forklaring paa hvorfor det gik galt, eller null. */
  error: string | null;
  createdAt: Date;
}

interface RecordingRow {
  id: string;
  channel_id: string;
  channel_name: string;
  title: string;
  description: string | null;
  start_ms: number;
  stop_ms: number;
  archive_days: number;
  state: string;
  file_uri: string | null;
  bytes: number;
  error: string | null;
  created_at: number;
}

const STATES: readonly RecordingState[] = [
  'planned',
  'downloading',
  'done',
  'failed',
  'expired',
];

function toState(value: string): RecordingState {
  // En ukendt tilstand kan kun komme af en aeldre eller nyere udgave af appen.
  // "planned" er det sikre valg: den bliver vurderet forfra af reglerne.
  return STATES.includes(value as RecordingState) ? (value as RecordingState) : 'planned';
}

function toRecording(row: RecordingRow): Recording {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    title: row.title,
    description: row.description,
    start: new Date(row.start_ms),
    stop: new Date(row.stop_ms),
    archiveDays: row.archive_days,
    state: toState(row.state),
    fileUri: row.file_uri,
    bytes: row.bytes,
    error: row.error,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Optagelsens noegle er kanal plus starttidspunkt.
 *
 * Ikke et loebenummer: bestiller man den samme udsendelse to gange — fra
 * guiden og fra afspilleren — skal det vaere den samme optagelse, ikke to
 * hentninger af den samme time.
 */
export function recordingId(channelId: string, start: Date): string {
  return `${channelId}:${start.getTime()}`;
}

export async function scheduleRecording(
  db: SqlDatabase,
  channel: { id: string; name: string; archiveDays: number },
  programme: Programme,
  now: Date = new Date(),
): Promise<string> {
  const id = recordingId(channel.id, programme.start);
  // DO NOTHING frem for at overskrive: er hentningen i gang eller faerdig, maa
  // et tryk mere ikke saette den tilbage til "bestilt".
  await db.runAsync(
    `INSERT INTO recordings
       (id, channel_id, channel_name, title, description, start_ms, stop_ms,
        archive_days, state, file_uri, bytes, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', NULL, 0, NULL, ?)
     ON CONFLICT(id) DO NOTHING`,
    [
      id,
      channel.id,
      channel.name,
      programme.title,
      programme.description,
      programme.start.getTime(),
      programme.stop.getTime(),
      channel.archiveDays,
      now.getTime(),
    ],
  );
  return id;
}

/** Nyeste udsendelse foerst — det er den man leder efter. */
export async function listRecordings(db: SqlDatabase): Promise<Recording[]> {
  const rows = await db.getAllAsync<RecordingRow>(
    'SELECT * FROM recordings ORDER BY start_ms DESC',
  );
  return rows.map(toRecording);
}

export async function getRecording(db: SqlDatabase, id: string): Promise<Recording | null> {
  const row = await db.getFirstAsync<RecordingRow>('SELECT * FROM recordings WHERE id = ?', [
    id,
  ]);
  return row ? toRecording(row) : null;
}

export interface RecordingPatch {
  state?: RecordingState;
  fileUri?: string | null;
  bytes?: number;
  error?: string | null;
}

export async function updateRecording(
  db: SqlDatabase,
  id: string,
  patch: RecordingPatch,
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.state !== undefined) {
    sets.push('state = ?');
    params.push(patch.state);
  }
  if (patch.fileUri !== undefined) {
    sets.push('file_uri = ?');
    params.push(patch.fileUri);
  }
  if (patch.bytes !== undefined) {
    sets.push('bytes = ?');
    params.push(patch.bytes);
  }
  if (patch.error !== undefined) {
    sets.push('error = ?');
    params.push(patch.error);
  }
  if (sets.length === 0) return;
  params.push(id);
  await db.runAsync(`UPDATE recordings SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteRecording(db: SqlDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM recordings WHERE id = ?', [id]);
}

/**
 * Er der bestilt optagelse af netop den udsendelse? Bruges til at vise
 * knappen som allerede trykket, saa man ikke staar og gaetter.
 */
export async function isScheduled(
  db: SqlDatabase,
  channelId: string,
  start: Date,
): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM recordings WHERE id = ?',
    [recordingId(channelId, start)],
  );
  return row !== null && row !== undefined;
}
