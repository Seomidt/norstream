import { expect, it } from 'vitest';
import { buildTimeshiftUrl } from '@norstream/core';
import { archiveWindow } from './archiveContinuation.js';
import { archiveRequestTime } from './archiveTiming.js';

it('19 News korrigeres til 19, og arkivet aabnes klokken 19 med +60 paa begge ure', () => {
  // Klokken 19 dansk vintertid er klokken 18 UTC.
  const programme = { start: new Date('2026-10-25T18:00:00Z'), stop: new Date('2026-10-25T18:30:00Z') };
  const window = archiveWindow(programme, programme.start, 0, Date.parse('2026-10-25T18:15:00Z'))!;
  const from = archiveRequestTime(window.from, { epgMinutes: 60, archiveMinutes: 60 });
  expect(window.minutes).toBe(13);
  const url = buildTimeshiftUrl({ baseUrl: 'https://example.invalid', username: 'test', password: 'test' }, '1', from, window.minutes, 'path', 60, 'ts');
  expect(url).toContain('/13/2026-10-25:19-00/');
});

it('arkivets egen korrektion er uafhaengig af EPG og bevarer minut-overlap ved datoskift', () => {
  const from = new Date('2026-10-25T00:00:30Z');
  expect(archiveRequestTime(from, { epgMinutes: 60, archiveMinutes: 0 }).toISOString()).toBe('2026-10-24T23:00:30.000Z');
  expect(archiveRequestTime(from, { epgMinutes: 0, archiveMinutes: 60 }).toISOString()).toBe('2026-10-25T01:00:30.000Z');
  expect(from.toISOString()).toBe('2026-10-25T00:00:30.000Z');
});
