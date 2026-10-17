import { afterEach, describe, expect, it } from 'vitest';
import {
  parseWatchNextUri,
  registerWatchNextNative,
  removeWatchNext,
  updateWatchNext,
  watchNextAction,
  watchNextJson,
  watchNextUri,
} from './watchNext.js';
import type { WatchNextNative } from './watchNext.js';

function fakeNative(): WatchNextNative & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    upsert: async (json) => {
      calls.push(`upsert ${json}`);
      return true;
    },
    remove: async (key) => {
      calls.push(`remove ${key}`);
      return true;
    },
  };
}

afterEach(() => registerWatchNextNative(null));

describe('watchNextUri / parseWatchNextUri', () => {
  it('frem og tilbage, ogsaa med tegn der skal kodes', () => {
    const uri = watchNextUri('src 1:42', 'src 1:ep/7');
    expect(uri).toBe('norstream://vod/src%201%3A42?episode=src%201%3Aep%2F7');
    expect(parseWatchNextUri(uri)).toEqual({ itemKey: 'src 1:42', episodeKey: 'src 1:ep/7' });
    expect(parseWatchNextUri(watchNextUri('a:1', null))).toEqual({ itemKey: 'a:1', episodeKey: null });
  });

  it('afviser fremmede links', () => {
    expect(parseWatchNextUri('https://example.com/vod/1')).toBeNull();
    expect(parseWatchNextUri('norstream://vod/')).toBeNull();
    expect(parseWatchNextUri('norstream://other/1')).toBeNull();
  });
});

describe('watchNextAction', () => {
  it('kun naar man er i gang, og fjern ved slutningen', () => {
    expect(watchNextAction(30, 5400)).toBe('none');
    expect(watchNextAction(600, 5400)).toBe('upsert');
    expect(watchNextAction(5300, 5400)).toBe('remove');
    expect(watchNextAction(600, null)).toBe('upsert');
    expect(watchNextAction(Number.NaN, 5400)).toBe('none');
  });
});

describe('watchNextJson', () => {
  it('afsnit med saeson, nummer og titel; link til serien paa afsnittet', () => {
    const json = JSON.parse(
      watchNextJson({
        key: 's:9',
        title: 'Severance',
        posterUrl: 'https://img/p.jpg',
        positionS: 125.4,
        durationS: 3000,
        episode: { key: 's:e5', season: 2, number: 5, title: 'Trojan' },
      }),
    );
    expect(json).toMatchObject({
      key: 's:9',
      positionMs: 125400,
      durationMs: 3000000,
      uri: 'norstream://vod/s%3A9?episode=s%3Ae5',
      episode: true,
      season: 2,
      episodeNumber: 5,
      episodeTitle: 'Trojan',
    });
  });
});

describe('updateWatchNext', () => {
  const movie = { key: 'm:1', title: 'Dune', posterUrl: null, positionS: 600, durationS: 9000 };

  it('laegger ind, men hoejst én gang i minuttet — undtagen ved afgang', async () => {
    const native = fakeNative();
    registerWatchNextNative(native);
    await updateWatchNext(movie, false, 1_000_000);
    await updateWatchNext({ ...movie, positionS: 610 }, false, 1_010_000);
    await updateWatchNext({ ...movie, positionS: 620 }, true, 1_020_000);
    await updateWatchNext({ ...movie, positionS: 700 }, false, 1_090_000);
    expect(native.calls.filter((c) => c.startsWith('upsert'))).toHaveLength(3);
  });

  it('fjerner ved slutningen og ved "set", og goer intet uden modul', async () => {
    await updateWatchNext(movie);
    const native = fakeNative();
    registerWatchNextNative(native);
    await updateWatchNext({ ...movie, positionS: 8950 });
    await removeWatchNext('m:2');
    expect(native.calls).toEqual(['remove m:1', 'remove m:2']);
  });
});
