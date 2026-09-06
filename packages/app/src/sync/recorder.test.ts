import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Programme, XtreamCredentials } from '@norstream/core';
import { channelKey } from '@norstream/core';
import { migrate } from '../storage/schema.js';
import { setPanelOffsetMinutes, setTimeshiftDialect } from '../storage/settings.js';
import {
  getRecording,
  listRecordings,
  scheduleRecording,
  updateRecording,
} from '../storage/recordings.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { runRecordings } from './recorder.js';
import type { RecordingStore } from './recorder.js';

const creds: XtreamCredentials = {
  baseUrl: 'http://panel.example:8080',
  username: 'USER',
  password: 'HEMMELIG',
};

const NOW = new Date('2026-09-06T20:00:00.000Z');
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Alt her kommer fra én kilde; noeglen er kilde + kanalens eget id. */
const SOURCE = 'src1';
const sources = new Map([[SOURCE, creds]]);
const CHANNEL = { id: channelKey(SOURCE, '247634'), name: 'DR1', archiveDays: 7 };

function programme(startMs: number, lengthMs = HOUR): Programme {
  return {
    channelId: CHANNEL.id,
    title: 'Bjerget',
    description: null,
    start: new Date(startMs),
    stop: new Date(startMs + lengthMs),
  };
}

function store(overrides: Partial<RecordingStore> = {}): RecordingStore & {
  urls: string[];
} {
  const urls: string[] = [];
  return {
    urls,
    download: vi.fn(async (url: string) => {
      urls.push(url);
      return { uri: `file:///recordings/${urls.length}.ts`, bytes: 500_000 };
    }),
    remove: vi.fn(async () => undefined),
    ...overrides,
  } as RecordingStore & { urls: string[] };
}

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  // Dialekt og tidszone hoerer til kilden nu, og optageren laeser dem derfra.
  await setTimeshiftDialect(db, 'php', SOURCE);
  await setPanelOffsetMinutes(db, 120, SOURCE);
});

describe('runRecordings', () => {
  it('henter en udsendelse der er sendt faerdig', async () => {
    const id = await scheduleRecording(db, CHANNEL, programme(NOW.getTime() - 2 * HOUR), NOW);
    const files = store();

    const result = await runRecordings(db, sources, files, NOW);

    expect(result).toEqual({ fetched: 1, failed: 0, expired: 0 });
    const recording = await getRecording(db, id);
    expect(recording?.state).toBe('done');
    expect(recording?.fileUri).toBe('file:///recordings/1.ts');
    expect(recording?.bytes).toBe(500_000);
  });

  it('bygger arkiv-URLen med panelets tidszone og udsendelsens laengde', async () => {
    await scheduleRecording(db, CHANNEL, programme(NOW.getTime() - 2 * HOUR), NOW);
    const files = store();

    await runRecordings(db, sources, files, NOW);

    // 18:00 UTC + 120 minutters paneloffset = 20:00 paa panelets ur.
    expect(files.urls[0]).toContain('start=2026-09-06%3A20-00');
    expect(files.urls[0]).toContain('duration=60');
    expect(files.urls[0]).toContain('stream=247634');
  });

  it('rører ikke en udsendelse der ikke er sendt endnu', async () => {
    await scheduleRecording(db, CHANNEL, programme(NOW.getTime() + HOUR), NOW);
    const files = store();

    const result = await runRecordings(db, sources, files, NOW);

    expect(result.fetched).toBe(0);
    expect(files.download).not.toHaveBeenCalled();
    expect((await listRecordings(db))[0]?.state).toBe('planned');
  });

  it('markerer den som fejlet uden at afsloere URLen', async () => {
    const id = await scheduleRecording(db, CHANNEL, programme(NOW.getTime() - 2 * HOUR), NOW);
    const files = store({
      download: vi.fn(async () => {
        // Netvaerkslag skriver rutinemaessigt den fejlende URL i beskeden, og
        // arkiv-URLen har panelets adgangskode i sig.
        throw new Error(`ENOTFOUND http://panel.example:8080/streaming/timeshift.php?password=HEMMELIG`);
      }),
    });

    const result = await runRecordings(db, sources, files, NOW);

    expect(result).toEqual({ fetched: 0, failed: 1, expired: 0 });
    const recording = await getRecording(db, id);
    expect(recording?.state).toBe('failed');
    expect(recording?.error).not.toContain('HEMMELIG');
    expect(recording?.error).toContain('Prøv igen');
  });

  it('proever en fejlet igen naeste gang', async () => {
    const id = await scheduleRecording(db, CHANNEL, programme(NOW.getTime() - 2 * HOUR), NOW);
    await updateRecording(db, id, { state: 'failed', error: 'noget gik galt' });

    const result = await runRecordings(db, sources, store(), NOW);

    expect(result.fetched).toBe(1);
    expect((await getRecording(db, id))?.error).toBeNull();
  });

  it('opgiver en der er faldet ud af arkivet', async () => {
    const id = await scheduleRecording(db, CHANNEL, programme(NOW.getTime() - 9 * DAY), NOW);
    const files = store();

    const result = await runRecordings(db, sources, files, NOW);

    expect(result).toEqual({ fetched: 0, failed: 0, expired: 1 });
    expect(files.download).not.toHaveBeenCalled();
    expect((await getRecording(db, id))?.state).toBe('expired');
  });

  it('henter én ad gangen, fordi panelet kun tillader én forbindelse', async () => {
    await scheduleRecording(db, CHANNEL, programme(NOW.getTime() - 2 * HOUR), NOW);
    await scheduleRecording(db, CHANNEL, programme(NOW.getTime() - 4 * HOUR), NOW);

    let inFlight = 0;
    let peak = 0;
    const files = store({
      download: vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { uri: 'file:///x.ts', bytes: 500_000 };
      }),
    });

    const result = await runRecordings(db, sources, files, NOW);

    expect(result.fetched).toBe(2);
    expect(peak).toBe(1);
  });

  it('rører ikke det der allerede er hentet', async () => {
    const id = await scheduleRecording(db, CHANNEL, programme(NOW.getTime() - 2 * HOUR), NOW);
    await updateRecording(db, id, { state: 'done', fileUri: 'file:///a.ts' });
    const files = store();

    await runRecordings(db, sources, files, NOW);

    expect(files.download).not.toHaveBeenCalled();
  });

  it('melder fremdrift undervejs', async () => {
    const id = await scheduleRecording(db, CHANNEL, programme(NOW.getTime() - 2 * HOUR), NOW);
    const files = store({
      download: vi.fn(async (_url: string, _id: string, onProgress?: (n: number) => void) => {
        onProgress?.(1024);
        onProgress?.(4096);
        return { uri: 'file:///a.ts', bytes: 500_000 };
      }),
    });
    const seen: [string, number][] = [];

    await runRecordings(db, sources, files, NOW, undefined, (recordingId, bytes) => {
      seen.push([recordingId, bytes]);
    });

    expect(seen).toEqual([
      [id, 1024],
      [id, 4096],
    ]);
  });
});

describe('scheduleRecording', () => {
  it('bestiller den samme udsendelse én gang, uanset hvor mange tryk', async () => {
    const p = programme(NOW.getTime() - 2 * HOUR);
    await scheduleRecording(db, CHANNEL, p, NOW);
    await scheduleRecording(db, CHANNEL, p, NOW);
    expect(await listRecordings(db)).toHaveLength(1);
  });

  it('saetter ikke en igangvaerende hentning tilbage til bestilt', async () => {
    const p = programme(NOW.getTime() - 2 * HOUR);
    const id = await scheduleRecording(db, CHANNEL, p, NOW);
    await updateRecording(db, id, { state: 'done', fileUri: 'file:///a.ts' });

    await scheduleRecording(db, CHANNEL, p, NOW);

    expect((await getRecording(db, id))?.state).toBe('done');
  });
});

describe('svar der ikke er en udsendelse', () => {
  it('kasserer en hentning der er for lille til at vaere video', async () => {
    // Panelet svarede med en spilleliste eller en fejlside, og hentningen
    // *lykkedes*. Uden kontrollen stod der en faerdig optagelse i listen som
    // var tom naar den blev aabnet.
    const id = await scheduleRecording(db, CHANNEL, programme(NOW.getTime() - 2 * HOUR), NOW);
    const removed: string[] = [];
    const files = store({
      download: vi.fn(async () => ({ uri: 'file:///playlist.ts', bytes: 1200 })),
      remove: vi.fn(async (uri: string) => {
        removed.push(uri);
      }),
    });

    const result = await runRecordings(db, sources, files, NOW);

    expect(result).toEqual({ fetched: 0, failed: 1, expired: 0 });
    const recording = await getRecording(db, id);
    expect(recording?.state).toBe('failed');
    expect(recording?.fileUri).toBeNull();
    expect(recording?.bytes).toBe(0);
    // Og den ubrugelige fil bliver ikke liggende og fylder.
    expect(removed).toEqual(['file:///playlist.ts']);
  });

  it('henter arkivet som ts, ikke som spilleliste', async () => {
    // Sti-dialekten er den eneste der har et filnavn at aendre.
    await setTimeshiftDialect(db, 'path', SOURCE);
    await scheduleRecording(db, CHANNEL, programme(NOW.getTime() - 2 * HOUR), NOW);
    const files = store();

    await runRecordings(db, sources, files, NOW);

    expect(files.urls[0]).toContain('/247634.ts');
    expect(files.urls[0]).not.toContain('.m3u8');
  });
});
