import { describe, expect, it } from 'vitest';
import type { VideoSource } from 'expo-video';
import { ARCHIVE_BUFFER, LIVE_BUFFER, PlaybackConnection } from './playbackConnection.js';
import type { PlaybackPort } from './playbackConnection.js';

function fixture() {
  const calls: string[] = [];
  const pending: Array<{ resolve: () => void; reject: () => void }> = [];
  const player: PlaybackPort = {
    currentTime: 0,
    bufferOptions: LIVE_BUFFER,
    pause: () => { calls.push('pause'); },
    play: () => { calls.push(`play@${player.currentTime}`); },
    replaceAsync: (source: VideoSource) => {
      calls.push(`replace:${typeof source === 'string' ? source : 'object'}`);
      player.currentTime = 0;
      return new Promise<void>((resolve, reject) => pending.push({ resolve, reject: () => reject(new Error('offline')) }));
    },
  };
  return { player, calls, pending, connection: new PlaybackConnection(player) };
}

describe('PlaybackConnection', () => {
  it('aabner kilden én gang og spoler foer afspilning, ogsaa naar ready kom foerst', async () => {
    const f = fixture();
    const loaded = f.connection.load('archive.ts', true, 42);
    await Promise.resolve();
    f.connection.status('readyToPlay');
    expect(f.connection.position(900)).toBe(false); // gammel kilde
    f.connection.sourceLoaded('old-live.ts');
    expect(f.connection.committed).toBe(false);
    f.connection.sourceLoaded({ uri: 'archive.ts' });
    f.pending[0]!.resolve();
    await loaded;
    expect(f.calls).toEqual(['pause', 'replace:archive.ts']);
    expect(f.player.bufferOptions).toEqual(ARCHIVE_BUFFER);
    expect(f.connection.position(0)).toBe(false);
    expect(f.connection.active).toBe(false);
    expect(f.connection.position(42.1)).toBe(true);
    expect(f.calls).toEqual(['pause', 'replace:archive.ts', 'play@42']);
    expect(f.connection.active).toBe(true);
    // Klargoerings- og bufferhaendelser maa ikke genindlaese kilden.
    f.connection.status('loading');
    f.connection.status('readyToPlay');
    for (let n = 43; n < 140; n += 1) {
      f.player.currentTime = n;
      expect(f.connection.position(n)).toBe(true);
    }
    expect(f.calls.filter((c) => c.startsWith('replace:'))).toHaveLength(1);
  });

  it('serialiserer asynkrone kildeskift og starter kun den seneste kanal', async () => {
    const f = fixture();
    const first = f.connection.load('first.ts', false);
    await Promise.resolve();
    const second = f.connection.load('second.ts', false);
    const third = f.connection.load('third.ts', false);
    await Promise.resolve();
    expect(f.pending).toHaveLength(1);
    f.pending[0]!.resolve();
    await first;
    await second;
    await Promise.resolve();
    expect(f.pending).toHaveLength(2);
    expect(f.calls).toEqual(['pause', 'replace:first.ts', 'pause', 'replace:third.ts']);
    f.pending[1]!.resolve();
    await third;
    expect(f.calls.at(-1)).toBe('play@0');
    expect(f.player.bufferOptions).toEqual(LIVE_BUFFER);
  });

  it('genindlaeser den samme URL med sin nye spoletid, uden en anden afspiller', async () => {
    const f = fixture();
    for (const seek of [0, 42, 59]) {
      const loaded = f.connection.load('same.ts', true, seek);
      await Promise.resolve();
      // Gammel tid kan ikke bekraefte det nye seek.
      expect(f.connection.position(42)).toBe(false);
      f.pending.at(-1)!.resolve();
      await loaded;
      f.connection.sourceLoaded('same.ts');
      f.connection.status('readyToPlay');
      expect(f.connection.position(seek)).toBe(true);
    }
    expect(f.calls.filter((c) => c.startsWith('replace:'))).toHaveLength(3);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toEqual(['play@0', 'play@42', 'play@59']);
  });

  it('Tilbage under indlaesning afviser sen metadata og starter ingen stream', async () => {
    const f = fixture();
    const loaded = f.connection.load('archive.ts', true, 17);
    await Promise.resolve();
    f.connection.dispose();
    f.pending[0]!.resolve();
    await loaded;
    f.connection.sourceLoaded('archive.ts');
    f.connection.status('readyToPlay');
    expect(f.connection.position(17)).toBe(false);
    expect(f.calls).toEqual(['pause', 'replace:archive.ts']);
  });

  it('effect-cleanup afviser gammel indlaesning men tillader Reacts kontrol-mount', async () => {
    const f = fixture();
    const old = f.connection.load('live.ts', false);
    await Promise.resolve();
    f.connection.cancel();
    const fresh = f.connection.load('live.ts', false);
    f.pending[0]!.resolve();
    await old;
    await Promise.resolve();
    f.pending[1]!.resolve();
    await fresh;
    expect(f.calls.filter((c) => c.startsWith('play@'))).toEqual(['play@0']);
  });

  it('et fejlet replace forgifter ikke koeen til naeste genforsoeg', async () => {
    const f = fixture();
    const old = f.connection.load('offline.ts', true);
    await Promise.resolve();
    const rejected = expect(old).rejects.toThrow('offline');
    f.pending[0]!.reject();
    await rejected;
    const retry = f.connection.load('online.ts', true);
    await Promise.resolve();
    f.pending[1]!.resolve();
    await retry;
    expect(f.calls.at(-1)).toBe('play@0');
  });

  it('en genindlaesning kan bevare pause uden automatisk at starte', async () => {
    const f = fixture();
    const loaded = f.connection.load('archive.ts', true, 320, false);
    await Promise.resolve();
    f.pending[0]!.resolve();
    await loaded;
    expect(f.player.currentTime).toBe(320);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
  });

  it('en pause valgt mens kilden indlaeses overskrives ikke af det sene promise', async () => {
    const f = fixture();
    const loaded = f.connection.load('archive.ts', true, 320);
    await Promise.resolve();
    f.connection.setPlayingIntent(false);
    f.pending[0]!.resolve();
    await loaded;
    expect(f.player.currentTime).toBe(320);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
  });

  it('spiller ingen gamle sekunder naar en TS-kilde ignorerer seek; en seekbar kilde kan genoptage', async () => {
    const f = fixture();
    let actual = 0;
    let seekable = false;
    Object.defineProperty(f.player, 'currentTime', {
      get: () => actual,
      set: (time: number) => { actual = seekable ? time : 0; },
    });
    const ts = f.connection.load('archive.ts', true, 42);
    await Promise.resolve(); f.pending[0]!.resolve(); await ts;
    f.connection.sourceLoaded('archive.ts');
    f.connection.status('readyToPlay');
    expect(f.connection.position(0)).toBe(false);
    expect(f.connection.active).toBe(false);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
    seekable = true;
    const hls = f.connection.load('archive.m3u8', true, 42);
    await Promise.resolve(); f.pending[1]!.resolve(); await hls;
    expect(f.calls.filter((c) => c.startsWith('play@'))).toHaveLength(0);
    f.connection.sourceLoaded('archive.m3u8');
    f.connection.status('readyToPlay');
    expect(f.connection.position(42)).toBe(true);
    expect(f.calls.filter((c) => c.startsWith('play@'))).toEqual(['play@42']);
  });
});
