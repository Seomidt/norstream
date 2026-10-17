import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { archiveQueueSource, archiveQueueSummary } from './archiveQueue.js';

const source = { uri: 'http://192.0.2.1/streaming/timeshift.php?start=test', headers: { Host: 'panel.invalid' } };
const segment = { segmentStart: Date.UTC(2026, 9, 16, 18), playbackStop: new Date('2026-10-16T18:35:00Z'), panelOffsetMinutes: 120, dialect: 'php', format: 'ts' };
describe('native arkivkoe', () => {
  it('bevarer DoH/Host og tilfoejer afgraenset tidsvindue uden at aendre URI', () => {
    expect(archiveQueueSource(source, segment, 7, true)).toEqual({
      ...source, norstreamArchive: { startMs: segment.segmentStart, stopMs: segment.playbackStop.getTime(), offsetMinutes: 120, token: 7, clipMs: 0 },
    });
    expect(source).not.toHaveProperty('norstreamArchive');
  });
  it('bevarer live, HLS og andre platforme uden at aktivere ekstra hentning', () => {
    expect(archiveQueueSource(source, null, 1, true)).toBe(source);
    expect(archiveQueueSource(source, segment, 1, false)).toBe(source);
    expect(archiveQueueSource(source, { ...segment, dialect: 'path', format: 'm3u8' }, 1, true)).toBe(source);
    expect(archiveQueueSource(null, segment, 1, true)).toBeNull();
    expect(archiveQueueSource(source.uri, segment, 1, true)).toMatchObject({ uri: source.uri });
  });
  it('logger kun faste faser og sikre tal', () => {
    expect(archiveQueueSummary({ phase: 'overgang', leadSeconds: 44, overlapSeconds: 59.34, transitions: 2 }))
      .toBe('arkivkoe v395: overgang; buffer 44.000 s; overlap 59.340 s; skift 2');
    expect(archiveQueueSummary({ phase: 'http://password.invalid' })).toBeNull();
    expect(archiveQueueSummary({ phase: 'koesat', leadSeconds: NaN, overlapSeconds: 0, transitions: 0 })).toBeNull();
  });
  it('installerer de validerede native udvidelser og afviser upstream-drift', async () => {
    const require = createRequire(import.meta.url);
    const root = require.resolve('expo-video/package.json').replace('package.json', 'android/src/main/java/expo/modules/video/');
    const { patchArchiveQueue } = await import('../../../../../scripts/patch-archive-queue.mjs');
    for (const path of ['records/VideoSource.kt', 'VideoModule.kt']) {
      const installed = readFileSync(root + path, 'utf8');
      expect(patchArchiveQueue(path, installed)).toBe(installed);
      expect(() => patchArchiveQueue(path, installed + '// drift')).toThrow('Ukendt');
    }
    expect(readFileSync(root + 'player/NorstreamArchiveQueue.kt', 'utf8'))
      .toBe(readFileSync(new URL('../../../../../scripts/native/NorstreamArchiveQueue.kt', import.meta.url), 'utf8'));
  });
});
