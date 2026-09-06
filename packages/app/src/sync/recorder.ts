import { buildTimeshiftUrl, parseChannelKey } from '@norstream/core';
import type { XtreamCredentials } from '@norstream/core';
import { recordingAction } from '../features/recordings/plan.js';
import { listRecordings, updateRecording } from '../storage/recordings.js';
import type { Recording } from '../storage/recordings.js';
import { getPanelOffsetMinutes, getTimeshiftDialect } from '../storage/settings.js';
import type { SqlDatabase } from '../storage/types.js';

/**
 * Hentningen af én optagelse, som appen ellers laver med expo-file-system.
 *
 * Grænsefladen findes for at kunne teste det her lag. Reglerne for hvornaar
 * der hentes, hvad der sker naar det gaar galt, og hvad brugeren faar at vide,
 * er det eneste sted der reelt kan gaa noget galt — og det er samtidig det
 * eneste der ikke kraever en telefon at afproeve.
 */
export interface RecordingStore {
  /** Henter URL'en ned og returnerer hvor filen ligger, og hvor stor den er. */
  download(
    url: string,
    id: string,
    onProgress?: (bytesWritten: number) => void,
  ): Promise<{ uri: string; bytes: number }>;
  /** Sletter en hentet fil. Maa ikke kaste hvis filen ikke findes. */
  remove(uri: string): Promise<void>;
}

/**
 * Mindste stoerrelse vi tror paa.
 *
 * Et panel der ikke vil levere arkivet svarer ofte med noget kort og
 * velmenende — en spilleliste, en fejlside, en omdirigering — og hentningen
 * *lykkes*. Uden den her graense ville listen fyldes med optagelser der ser
 * faerdige ud og er tomme naar man aabner dem. Under to hundrede kilobyte er
 * ikke en udsendelse, uanset hvor kort den er.
 */
const MIN_PLAUSIBLE_BYTES = 200_000;

export interface RunRecordingsResult {
  fetched: number;
  failed: number;
  expired: number;
}

/**
 * Henter de optagelser der er klar, én ad gangen.
 *
 * Én ad gangen er ikke forsigtighed, det er et krav: panelet tillader én
 * forbindelse, og en hentning bruger den. To samtidige ville afvise hinanden.
 * Af samme grund bestemmer **kalderen** hvornaar der koeres — en hentning der
 * gaar i gang mens brugeren ser tv, afbryder afspilningen.
 */
export async function runRecordings(
  db: SqlDatabase,
  credsBySource: ReadonlyMap<string, XtreamCredentials>,
  store: RecordingStore,
  now: Date = new Date(),
  onChange?: () => void,
  onProgress?: (id: string, bytesWritten: number) => void,
): Promise<RunRecordingsResult> {
  const result: RunRecordingsResult = { fetched: 0, failed: 0, expired: 0 };
  const pending = (await listRecordings(db)).filter((recording) => {
    const action = recordingAction(
      { state: recording.state, stopMs: recording.stop.getTime(), archiveDays: recording.archiveDays },
      now,
    );
    if (action === 'expire') return true;
    return action === 'fetch';
  });

  for (const recording of pending) {
    const action = recordingAction(
      { state: recording.state, stopMs: recording.stop.getTime(), archiveDays: recording.archiveDays },
      now,
    );

    if (action === 'expire') {
      await updateRecording(db, recording.id, {
        state: 'expired',
        error: 'Udsendelsen var ude af udbyderens arkiv, før den kunne hentes.',
      });
      result.expired += 1;
      onChange?.();
      continue;
    }

    const sourceId = parseChannelKey(recording.channelId)?.sourceId ?? null;
    const creds = sourceId === null ? undefined : credsBySource.get(sourceId);
    // Kilden kan vaere fjernet siden optagelsen blev bestilt, eller vaere en
    // M3U-liste uden arkiv. Begge dele skal siges, ikke proeves i det uendelige.
    if (sourceId === null || creds === undefined) {
      await updateRecording(db, recording.id, {
        state: 'failed',
        error: 'Kilden findes ikke længere, så udsendelsen kan ikke hentes.',
      });
      result.failed += 1;
      onChange?.();
      continue;
    }

    const dialect = await getTimeshiftDialect(db, sourceId);
    if (dialect === null) {
      await updateRecording(db, recording.id, {
        state: 'failed',
        error: 'Appen har ikke fundet vejen til udbyderens arkiv endnu.',
      });
      result.failed += 1;
      onChange?.();
      continue;
    }

    await fetchOne(
      db,
      creds,
      dialect,
      await getPanelOffsetMinutes(db, sourceId),
      store,
      recording,
      result,
      onChange,
      onProgress,
    );
  }

  return result;
}

async function fetchOne(
  db: SqlDatabase,
  creds: XtreamCredentials,
  dialect: 'php' | 'path',
  panelOffsetMinutes: number,
  store: RecordingStore,
  recording: Recording,
  result: RunRecordingsResult,
  onChange?: () => void,
  onProgress?: (id: string, bytesWritten: number) => void,
): Promise<void> {
  const durationMinutes = Math.ceil(
    (recording.stop.getTime() - recording.start.getTime()) / 60_000,
  );
  // 'ts', ikke 'm3u8': en hentet spilleliste er faa kilobyte tekst der peger
  // paa segmenter arkivet sletter igen. Det ville se ud som en optagelse i
  // listen og vaere tom naar den blev aabnet.
  const url = buildTimeshiftUrl(
    creds,
    parseChannelKey(recording.channelId)?.streamId ?? recording.channelId,
    recording.start,
    durationMinutes,
    dialect,
    panelOffsetMinutes,
    'ts',
  );

  await updateRecording(db, recording.id, { state: 'downloading', error: null });
  onChange?.();

  try {
    // Fremdriften gaar til skaermen, ikke til databasen: en skrivning i
    // sekundet gennem en times hentning er slid uden formaal, og tallet er
    // kun til at se paa mens det staar paa.
    const file = await store.download(url, recording.id, (bytesWritten) => {
      onProgress?.(recording.id, bytesWritten);
    });

    if (file.bytes < MIN_PLAUSIBLE_BYTES) {
      await store.remove(file.uri);
      await updateRecording(db, recording.id, {
        state: 'failed',
        fileUri: null,
        bytes: 0,
        error: 'Udbyderen sendte ikke selve udsendelsen. Prøv igen senere.',
      });
      result.failed += 1;
      onChange?.();
      return;
    }

    await updateRecording(db, recording.id, {
      state: 'done',
      fileUri: file.uri,
      bytes: file.bytes,
      error: null,
    });
    result.fetched += 1;
  } catch (cause) {
    // Den raa fejl maa ikke vises: den kommer fra netvaerkslaget og indeholder
    // rutinemaessigt URL'en, som har panelets adgangskode i sig.
    void cause;
    await updateRecording(db, recording.id, {
      state: 'failed',
      error: 'Hentningen fra arkivet mislykkedes. Prøv igen.',
    });
    result.failed += 1;
  }
  onChange?.();
}
